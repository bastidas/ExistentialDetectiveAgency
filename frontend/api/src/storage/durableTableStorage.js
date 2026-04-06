"use strict";

const { TableClient } = require("@azure/data-tables");
const config = require("../config");
const logger = require("../logger");
const { normalizeDossier } = require("../dossier");


/** Greenfield partition keys (single table). */
const PK = {
  // Azure Table PartitionKey/RowKey cannot include: / \ # ? or control chars.
  session: "EDA_session",
  dossier: "EDA_dossier",
  usageSession: "EDA_usageSession",
  usageDaily: "EDA_usageDaily",
};

let _client = null;
let _tableReady = false;

function getTodayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function safeJsonParse(s, fallback) {
  if (s == null || s === "") return fallback;
  try {
    return JSON.parse(String(s));
  } catch (_) {
    return fallback;
  }
}

function hasCompatibleMainState(state) {
  if (!state || typeof state !== "object") return false;
  if (!state.mainStateSnapshots || typeof state.mainStateSnapshots !== "object") return false;
  return isUsableMainStateSnapshot(state.mainStateSnapshots.root);
}

function truncateDetectiveHistory(text) {
  const h = String(text || "");
  // Table Storage string property limit is ~64 KiB; keep safe margin.
  const max = Math.min(config.MAX_DETECTIVE_HISTORY_CHARS, 60_000);
  if (h.length <= max) return h;
  return h.slice(-max);
}

function utf8ByteLength(text) {
  return Buffer.byteLength(String(text || ""), "utf8");
}

/**
 * Omit chat_history from persisted baseline runtime (thread events are canonical).
 * This keeps baselineRuntimeJson bounded for Table Storage property limits.
 * @param {object} session
 * @returns {object|null}
 */
function baselineRuntimeForPersist(session) {
  const rt = session && session.attacheState;
  if (rt == null) return null;
  try {
    const o = JSON.parse(JSON.stringify(rt));
    if (o && typeof o === "object" && Array.isArray(o.chat_history)) {
      delete o.chat_history;
    }
    return o;
  } catch (_) {
    return rt;
  }
}

function getTableClient() {
  const conn = String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim();
  const tableName = config.DOSSIER_TABLE_NAME;
  if (!conn || !tableName) return null;
  if (!_client) {
    _client = TableClient.fromConnectionString(conn, tableName);
  }
  return _client;
}

async function ensureTable(client) {
  if (_tableReady) return;
  try {
    await client.createTable();
  } catch (err) {
    if (err && err.statusCode === 409) {
      // already exists
    } else {
      throw err;
    }
  }
  _tableReady = true;
}

async function getEntity(client, partitionKey, rowKey) {
  try {
    const ent = await client.getEntity(partitionKey, rowKey);
    return ent;
  } catch (err) {
    if (err && err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * @param {TableClient} client
 * @param {string} sessionId
 * @param {() => object} getSessionEntry
 * @param {Map<string, number>} userExchangeCounts
 * @returns {Promise<{ dailyCount: number | null }>}
 */
async function hydrateSession(client, sessionId, getSessionEntry, userExchangeCounts) {
  await ensureTable(client);
