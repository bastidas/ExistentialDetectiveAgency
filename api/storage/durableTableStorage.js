"use strict";

const { TableClient, odata } = require("@azure/data-tables");
const config = require("../config");
const logger = require("../logger");

const PK = {
  session: "EDA_session",
  /** Prefix only: each session's chat history lives in partition `EDA_thread_<sessionId>`, one row per exchange. */
  thread: "EDA_thread",
  dossier: "EDA_dossier",
  usageDaily: "EDA_usageDaily",
};

/**
 * Version stamped on every session row. Rows written by an older layout (no `schemaV`) can still be
 * read for their transcript, but their orchestration blob is ignored by `restoreSessionRuntimeFromDurable`.
 */
const SESSION_SCHEMA_V = 2;

/** Azure Table limit is 32,768 UTF-16 characters per string property; stay under it. */
const MAX_PROPERTY_CHARS = 30_000;

/**
 * Azure Table entity limit is 1 MiB, counted in UTF-16 (2 bytes per character). Budget the chunked
 * session fields to well under it, leaving room for the small scalar properties and OData overhead.
 */
const MAX_ENTITY_CHARS = 400_000;

/** The orchestration blob may use at most this much of the entity budget before it is shrunk. */
const MAX_ORCHESTRATION_CHARS = 300_000;

/** Azure caps a partition key at 1,024 characters; stay well under it. */
const MAX_PARTITION_KEY_CHARS = 900;

const HISTORY_KEYS = ["detectiveChatHistory"];

let _client = null;
let _tableReady = false;

function getTableClient() {
  const conn = String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim();
  const tableName = String(config.DOSSIER_TABLE_NAME || "").trim();
  if (!conn || !tableName) return null;
  if (!_client) {
    _client = TableClient.fromConnectionString(conn, tableName);
  }
  return _client;
}

async function ensureTable(client) {
  if (!client || _tableReady) return;
  try {
    await client.createTable();
  } catch (err) {
    if (!(err && err.statusCode === 409)) throw err;
  }
  _tableReady = true;
}

async function getEntity(client, partitionKey, rowKey) {
  try {
    return await client.getEntity(partitionKey, rowKey);
  } catch (err) {
    if (err && err.statusCode === 404) return null;
    throw err;
  }
}

function safeJsonParse(text, fallback) {
  if (text == null || text === "") return fallback;
  try {
    return JSON.parse(String(text));
  } catch (_) {
    return fallback;
  }
}

function truncateDetectiveHistory(text) {
  const h = String(text || "");
  const max = Math.min(config.DETECTIVE_HISTORY_STORAGE_CHAR_LIMIT, 60_000);
  return h.length <= max ? h : h.slice(-max);
}

/**
 * Split a string into pieces of at most `size` UTF-16 units without cutting a surrogate pair
 * (a lone surrogate would be corrupted when the property is encoded).
 *
 * @param {string} text
 * @param {number} [size]
 * @returns {string[]}
 */
function splitIntoChunks(text, size = MAX_PROPERTY_CHARS) {
  const s = String(text == null ? "" : text);
  if (s.length <= size) return [s];
  const out = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + size, s.length);
    if (end < s.length) {
      const last = s.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}

/**
 * Write `text` into `target` as `name`, `name__1`, `name__2`, ... and record the piece count in
 * `<name>Chunks`. The first piece keeps the plain property name so a reader that predates chunking
 * still sees the start of the value.
 *
 * @param {Record<string, unknown>} target
 * @param {string} name
 * @param {string} text
 */
function writeChunked(target, name, text) {
  const parts = splitIntoChunks(text);
  target[name] = parts[0];
  for (let i = 1; i < parts.length; i += 1) target[`${name}__${i}`] = parts[i];
  target[`${name}Chunks`] = parts.length;
}

/**
 * Inverse of `writeChunked`. Rows written before chunking (no `<name>Chunks`) are a single property.
 * A row with a missing piece is reported as corrupt rather than silently returning a partial value.
 *
 * @param {Record<string, unknown>} entity
 * @param {string} name
 * @returns {{ text: string, corrupt: boolean }}
 */
function readChunked(entity, name) {
  const n = Number(entity[`${name}Chunks`] || 1);
  if (!Number.isFinite(n) || n <= 1) {
    const v = entity[name];
    return { text: v == null ? "" : String(v), corrupt: false };
  }
  let text = String(entity[name] == null ? "" : entity[name]);
  for (let i = 1; i < n; i += 1) {
    const piece = entity[`${name}__${i}`];
    if (piece == null) return { text: "", corrupt: true };
    text += String(piece);
  }
  return { text, corrupt: false };
}

function parseChunked(entity, name, fallback, problems) {
  const { text, corrupt } = readChunked(entity, name);
  if (corrupt) {
    problems.push(`${name}_missing_chunk`);
    return fallback;
  }
  if (text === "") return fallback;
  try {
    return JSON.parse(text);
  } catch (_) {
    problems.push(`${name}_unparseable`);
    return fallback;
  }
}

/**
 * Shrink an orchestration blob that is over budget by halving its chat-history tails, newest kept.
 * Returns `null` when even empty histories do not fit.
 *
 * @param {object} blob
 * @param {number} maxChars
 * @returns {{ json: string, shrunk: boolean } | null}
 */
function fitOrchestration(blob, maxChars) {
  let json = JSON.stringify(blob);
  if (json.length <= maxChars) return { json, shrunk: false };
  const work = { ...blob };
  for (let round = 0; round < 12; round += 1) {
    let changed = false;
    for (const key of HISTORY_KEYS) {
      const arr = work[key];
      if (Array.isArray(arr) && arr.length > 0) {
        work[key] = arr.slice(Math.floor(arr.length / 2));
        changed = true;
      }
    }
    json = JSON.stringify(work);
    if (json.length <= maxChars) return { json, shrunk: true };
    if (!changed) break;
  }
  return null;
}

/**
 * Drop the oldest thread events until the serialized array fits `maxChars`.
 *
 * @param {unknown[]} events
 * @param {number} maxChars
 * @returns {{ json: string, dropped: number }}
 */
function fitThreadEvents(events, maxChars) {
  const arr = Array.isArray(events) ? events : [];
  let start = 0;
  let json = JSON.stringify(arr);
  while (json.length > maxChars && start < arr.length) {
    start += Math.max(1, Math.ceil((arr.length - start) / 10));
    json = JSON.stringify(arr.slice(start));
  }
  return { json, dropped: start };
}

/**
 * Decide what the full state checkpoint writes (orchestration, summaries, detective text), and say
 * so when something had to give. Nothing here throws on size: an oversized blob degrades (older
 * history is not persisted) and the reasons are returned and stored on the row instead of failing.
 * The chat history is not part of this row; it is written per exchange (see `saveThreadTurn`).
 *
 * @param {object} payload
 * @returns {{ orchJson: string, summariesJson: string, detectiveText: string, degraded: string[] }}
 */
function planSessionWrite(payload) {
  const degraded = [];
  const summariesJson = JSON.stringify(payload.conversationSummaries || null);
  const detectiveText = truncateDetectiveHistory(payload.detectiveHistoryText || "");

  let orchJson = "";
  const orch = payload.orchestrationRuntime;
  if (orch != null && typeof orch === "object") {
    const budget = Math.min(
      MAX_ORCHESTRATION_CHARS,
      MAX_ENTITY_CHARS - summariesJson.length - detectiveText.length
    );
    const fitted = fitOrchestration(orch, budget);
    if (fitted) {
      orchJson = fitted.json;
      if (fitted.shrunk) degraded.push("orchestration_history_trimmed");
    } else {
      degraded.push("orchestration_not_persisted");
    }
  }

  return { orchJson, summariesJson, detectiveText, degraded };
}

function threadPartitionKey(sessionId) {
  const pk = `${PK.thread}_${encodeURIComponent(String(sessionId))}`;
  return pk.length <= MAX_PARTITION_KEY_CHARS ? pk : null;
}

function threadRowKey(seq) {
  return String(Math.max(0, Math.floor(Number(seq) || 0))).padStart(8, "0");
}

/**
 * Write one exchange to the session's history: the user's message and every agent reply for that
 * turn (attaché, detective, Lumen, Umbra), plus the minimum needed to read it back (session in the
 * partition key, sequence in the row key, user id, timestamp, schema version). Idempotent per
 * sequence number, so a retry is safe. Throws on a storage error; the caller keeps the exchange
 * queued and retries.
 *
 * @param {import("@azure/data-tables").TableClient} client
 * @param {{ sessionId: string, userId?: string|null, seq: number, events: Array<object> }} turn
 * @returns {Promise<{ degraded: string[] } | undefined>}
 */
async function saveThreadTurn(client, turn) {
  if (!client || !turn || !turn.sessionId) return undefined;
  const partitionKey = threadPartitionKey(turn.sessionId);
  if (!partitionKey) return undefined;
  await ensureTable(client);
  const events = Array.isArray(turn.events) ? turn.events : [];
  const fitted = fitThreadEvents(events, MAX_ENTITY_CHARS);
  const degraded = fitted.dropped > 0 ? [`turn_oldest_${fitted.dropped}_events_not_persisted`] : [];
  const entity = {
    partitionKey,
    rowKey: threadRowKey(turn.seq),
    schemaV: SESSION_SCHEMA_V,
    userId: turn.userId ? String(turn.userId) : "",
    ts: new Date().toISOString(),
  };
  writeChunked(entity, "eventsJson", fitted.json);
  await client.upsertEntity(entity, "Replace");
  if (degraded.length > 0) {
    logger.warn("durableTableStorage", "saveThreadTurn", `session ${turn.sessionId} turn ${turn.seq}: ${degraded.join(", ")}`);
  }
  return { degraded };
}

/**
 * Read a session's whole chat history back, oldest exchange first.
 *
 * @param {import("@azure/data-tables").TableClient} client
 * @param {string} sessionId
 * @returns {Promise<{ events: Array<object>, lastSeq: number, userId: string|null, rows: number, problems: string[] }>}
 */
async function loadThread(client, sessionId) {
  const out = { events: [], lastSeq: 0, userId: null, rows: 0, problems: [] };
  const partitionKey = threadPartitionKey(sessionId);
  if (!client || !partitionKey) return out;
  await ensureTable(client);
  const rows = [];
  const iter = client.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${partitionKey}` } });
  for await (const entity of iter) rows.push(entity);
  rows.sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0));
  for (const row of rows) {
    const events = parseChunked(row, "eventsJson", [], out.problems);
    if (Array.isArray(events)) out.events.push(...events);
    out.lastSeq = Math.max(out.lastSeq, Number(row.rowKey) || 0);
    if (row.userId) out.userId = String(row.userId);
  }
  out.rows = rows.length;
  return out;
}

async function hydrateSession(client, sessionId) {
  const empty = {
    threadEvents: [],
    updatedAt: null,
    sessionSeq: 0,
    userId: null,
    orchestrationRuntime: null,
    schemaV: null,
    problems: [],
  };
  if (!client || !sessionId) return empty;
  await ensureTable(client);
  const entity = await getEntity(client, PK.session, sessionId);
  const thread = await loadThread(client, sessionId);
  if (!entity && thread.rows === 0) return empty;
  const problems = thread.problems.slice();
  const row = entity || {};
  const orchestrationRuntime = entity ? parseChunked(row, "orchestrationRuntimeJson", null, problems) : null;
  // Rows written before the per-exchange thread rows kept the history inside the session row.
  const legacyThread = thread.rows === 0 && entity ? parseChunked(row, "threadEventsJson", [], problems) : [];
  const threadEvents = thread.rows > 0 ? thread.events : Array.isArray(legacyThread) ? legacyThread : [];
  if (problems.length > 0) {
    logger.warn("durableTableStorage", "hydrateSession", `session has unreadable values: ${problems.join(", ")}`);
  }
  return {
    threadEvents,
    updatedAt: row.updatedAt ? String(row.updatedAt) : null,
    sessionSeq: Math.max(Number(row.sessionSeq || 0), thread.lastSeq),
    userId: row.userId ? String(row.userId) : thread.userId,
    orchestrationRuntime,
    schemaV: row.schemaV == null ? null : Number(row.schemaV),
    problems,
  };
}

/**
 * Upsert the session state row (orchestration, summaries, flags). Large values are written as
 * chunked properties within the per-entity budget. The chat history is written separately, every
 * exchange, by `saveThreadTurn`. Returns `{ degraded }` so the caller can surface a lossy write; throws only on a real
 * storage error (the caller decides whether that is fatal; in the chat path it is not).
 *
 * @returns {Promise<{ degraded: string[] } | undefined>}
 */
async function saveSessionCheckpoint(client, payload) {
  if (!client || !payload || !payload.sessionId) return undefined;
  await ensureTable(client);
  const plan = planSessionWrite(payload);
  const entity = {
    partitionKey: PK.session,
    rowKey: String(payload.sessionId),
    schemaV: SESSION_SCHEMA_V,
    updatedAt: new Date().toISOString(),
    userId: payload.userId ? String(payload.userId) : "",
    sessionSeq: Number(payload.sessionSeq || 0),
    baselineCompleted: !!payload.baselineCompleted,
    detectiveIntroSent: !!payload.detectiveIntroSent,
    detectiveHistoryText: plan.detectiveText,
    degradedReason: plan.degraded.join(";"),
  };
  writeChunked(entity, "conversationSummariesJson", plan.summariesJson);
  writeChunked(entity, "orchestrationRuntimeJson", plan.orchJson);
  await client.upsertEntity(entity, "Replace");
  if (plan.degraded.length > 0) {
    logger.warn(
      "durableTableStorage",
      "saveSessionCheckpoint",
      `session ${payload.sessionId} saved with reduced content: ${plan.degraded.join(", ")}`
    );
  }
  return { degraded: plan.degraded };
}

async function saveDossierByUserId(client, userId, dossier) {
  if (!client || !userId || !dossier) return;
  await ensureTable(client);
  const entity = {
    partitionKey: PK.dossier,
    rowKey: String(userId),
    updatedAt: new Date().toISOString(),
  };
  writeChunked(entity, "dossierJson", JSON.stringify(dossier));
  await client.upsertEntity(entity, "Replace");
}

/**
 * @param {import("@azure/data-tables").TableClient} client
 * @param {string} userId
 * @returns {Promise<{ dossierJson: string, updatedAt: string | null } | null>}
 */
async function getDossierByUserId(client, userId) {
  if (!client || !userId) return null;
  await ensureTable(client);
  const entity = await getEntity(client, PK.dossier, String(userId));
  if (!entity) return null;
  const { text, corrupt } = readChunked(entity, "dossierJson");
  if (corrupt || text.trim() === "") return null;
  return {
    dossierJson: text,
    updatedAt: entity.updatedAt ? String(entity.updatedAt) : null,
  };
}

module.exports = {
  PK,
  SESSION_SCHEMA_V,
  MAX_PROPERTY_CHARS,
  MAX_ENTITY_CHARS,
  getTableClient,
  ensureTable,
  getEntity,
  hydrateSession,
  saveSessionCheckpoint,
  saveThreadTurn,
  loadThread,
  threadPartitionKey,
  saveDossierByUserId,
  getDossierByUserId,
  splitIntoChunks,
  writeChunked,
  readChunked,
  planSessionWrite,
};
