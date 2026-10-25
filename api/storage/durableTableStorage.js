"use strict";

const { TableClient } = require("@azure/data-tables");
const config = require("../config");
const logger = require("../logger");

const PK = {
  session: "EDA_session",
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

/** The orchestration blob may use at most this share of the entity budget before it is shrunk. */
const MAX_ORCHESTRATION_CHARS = 200_000;

const HISTORY_KEYS = ["detectiveChatHistory", "lumenChatHistory", "umbraChatHistory"];

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
 * Decide what actually gets written, and say so when something had to give. Nothing here throws on
 * size: an oversized session degrades (older events or orchestration history are not persisted) and
 * the reasons are returned and stored on the row instead of failing the checkpoint.
 *
 * @param {object} payload
 * @returns {{ threadJson: string, orchJson: string, summariesJson: string, detectiveText: string, degraded: string[] }}
 */
function planSessionWrite(payload) {
  const degraded = [];
  const summariesJson = JSON.stringify(payload.conversationSummaries || null);
  const detectiveText = truncateDetectiveHistory(payload.detectiveHistoryText || "");

  let orchJson = "";
  const orch = payload.orchestrationRuntime;
  if (orch != null && typeof orch === "object") {
    const fitted = fitOrchestration(orch, MAX_ORCHESTRATION_CHARS);
    if (fitted) {
      orchJson = fitted.json;
      if (fitted.shrunk) degraded.push("orchestration_history_trimmed");
    } else {
      degraded.push("orchestration_not_persisted");
    }
  }

  const threadBudget = Math.max(
    10_000,
    MAX_ENTITY_CHARS - orchJson.length - summariesJson.length - detectiveText.length
  );
  const thread = fitThreadEvents(payload.threadEvents, threadBudget);
  if (thread.dropped > 0) degraded.push(`thread_oldest_${thread.dropped}_events_not_persisted`);

  return { threadJson: thread.json, orchJson, summariesJson, detectiveText, degraded };
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
  if (!entity) return empty;
  const problems = [];
  const schemaV = entity.schemaV == null ? null : Number(entity.schemaV);
  const threadEvents = parseChunked(entity, "threadEventsJson", [], problems);
  const orchestrationRuntime = parseChunked(entity, "orchestrationRuntimeJson", null, problems);
  if (problems.length > 0) {
    logger.warn("durableTableStorage", "hydrateSession", `session row has unreadable values: ${problems.join(", ")}`);
  }
  return {
    threadEvents: Array.isArray(threadEvents) ? threadEvents : [],
    updatedAt: entity.updatedAt ? String(entity.updatedAt) : null,
    sessionSeq: Number(entity.sessionSeq || 0),
    userId: entity.userId ? String(entity.userId) : null,
    orchestrationRuntime,
    schemaV,
    problems,
  };
}

/**
 * Upsert the session row. Large values are written as chunked properties within the per-entity
 * budget. Returns `{ degraded }` so the caller can surface a lossy write; throws only on a real
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
  writeChunked(entity, "threadEventsJson", plan.threadJson);
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
  saveDossierByUserId,
  getDossierByUserId,
  splitIntoChunks,
  writeChunked,
  readChunked,
  planSessionWrite,
};
