"use strict";

const { TableClient } = require("@azure/data-tables");
const config = require("../config");

const PK = {
  session: "EDA_session",
  dossier: "EDA_dossier",
  usageDaily: "EDA_usageDaily",
};

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

async function hydrateSession(client, sessionId) {
  if (!client || !sessionId) {
    return {
      threadEvents: [],
      updatedAt: null,
      sessionSeq: 0,
      userId: null,
      orchestrationRuntime: null,
    };
  }
  await ensureTable(client);
  const entity = await getEntity(client, PK.session, sessionId);
  if (!entity) {
    return {
      threadEvents: [],
      updatedAt: null,
      sessionSeq: 0,
      userId: null,
      orchestrationRuntime: null,
    };
  }
  return {
    threadEvents: safeJsonParse(entity.threadEventsJson, []),
    updatedAt: entity.updatedAt ? String(entity.updatedAt) : null,
    sessionSeq: Number(entity.sessionSeq || 0),
    userId: entity.userId ? String(entity.userId) : null,
    orchestrationRuntime: safeJsonParse(entity.orchestrationRuntimeJson, null),
  };
}

/** Azure Table entity property size budget (~1 MB row); keep orchestration JSON bounded. */
const ORCHESTRATION_RUNTIME_JSON_MAX_CHARS = 900_000;

async function saveSessionCheckpoint(client, payload) {
  if (!client || !payload || !payload.sessionId) return;
  await ensureTable(client);
  const nowIso = new Date().toISOString();
  let orchJson = "";
  if (payload.orchestrationRuntime != null && typeof payload.orchestrationRuntime === "object") {
    orchJson = JSON.stringify(payload.orchestrationRuntime);
    if (orchJson.length > ORCHESTRATION_RUNTIME_JSON_MAX_CHARS) {
      orchJson = JSON.stringify({
        v: payload.orchestrationRuntime.v,
        truncated: true,
        reason: "orchestration_runtime_oversize",
      });
    }
  }
  const entity = {
    partitionKey: PK.session,
    rowKey: String(payload.sessionId),
    updatedAt: nowIso,
    userId: payload.userId ? String(payload.userId) : "",
    sessionSeq: Number(payload.sessionSeq || 0),
    baselineCompleted: !!payload.baselineCompleted,
    detectiveIntroSent: !!payload.detectiveIntroSent,
    threadEventsJson: JSON.stringify(Array.isArray(payload.threadEvents) ? payload.threadEvents : []),
    conversationSummariesJson: JSON.stringify(payload.conversationSummaries || null),
    detectiveHistoryText: truncateDetectiveHistory(payload.detectiveHistoryText || ""),
    orchestrationRuntimeJson: orchJson || "",
  };
  await client.upsertEntity(entity, "Replace");
}

async function saveDossierByUserId(client, userId, dossier) {
  if (!client || !userId || !dossier) return;
  await ensureTable(client);
  const entity = {
    partitionKey: PK.dossier,
    rowKey: String(userId),
    updatedAt: new Date().toISOString(),
    dossierJson: JSON.stringify(dossier),
  };
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
  if (!entity || entity.dossierJson == null || String(entity.dossierJson).trim() === "") {
    return null;
  }
  return {
    dossierJson: String(entity.dossierJson),
    updatedAt: entity.updatedAt ? String(entity.updatedAt) : null,
  };
}

module.exports = {
  PK,
  getTableClient,
  ensureTable,
  getEntity,
  hydrateSession,
  saveSessionCheckpoint,
  saveDossierByUserId,
  getDossierByUserId,
};
