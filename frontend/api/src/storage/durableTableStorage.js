"use strict";

const { TableClient } = require("@azure/data-tables");
const config = require("../config");
const logger = require("../logger");
const { normalizeDossier } = require("../dossier");
const {
  parseThreadEventsJson,
  serializeThreadEventsForStorage,
  threadEventsToMainChatMessages,
  threadEventsToPhilosopherMessages,
  parseConversationSummariesJson,
  serializeConversationSummaries,
} = require("./threadEvents");
const { classifySessionReturn } = require("../session/returnClassification");
const {
  MAIN_STATE_SCHEMA_VERSION,
  isUsablePersistedSnapshot: isUsableMainStateSnapshot,
  transitionMainState,
} = require("../orchestration/mainStateMachine");

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

  const entry = getSessionEntry();
  // Mark that we attempted durable hydration this process, even if no row exists.
  // This prevents repeated hydrate calls on empty-message requests for first-time users.
  entry._hydratedFromStorage = true;
  entry.threadEvents = [];

  const sessionRow = await getEntity(client, PK.session, sessionId);
  if (sessionRow) {
    entry.history = String(sessionRow.detectiveHistoryText || "");
    const parsedState = safeJsonParse(sessionRow.detectiveStateJson, null);
    if (hasCompatibleMainState(parsedState)) {
      entry.state = parsedState;
    } else {
      const boot = transitionMainState(null, {
        rehydrated: false,
        attache: { completed: false, closingDelivered: false },
      });
      entry.state = {
        mainStateSnapshots: boot.snapshots,
        mainState: boot.view,
      };
      entry.history = "";
      entry.attacheState = null;
      entry.attacheCompleted = false;
      entry.attacheIntroSent = false;
      entry.detectiveIntroSent = false;
      entry.threadEvents = [];
      entry.conversationSummaries = null;
      entry.returnPolicyLastActivityAt = null;
    }
    entry.attacheState = safeJsonParse(sessionRow.baselineRuntimeJson, null);
    entry.attacheCompleted = !!sessionRow.baselineCompleted;
    entry.attacheIntroSent = !!sessionRow.baselineIntroSent;
    entry.detectiveIntroSent = !!sessionRow.detectiveIntroSent;
    entry.threadEvents = parseThreadEventsJson(sessionRow.threadEventsJson);
    entry.conversationSummaries = parseConversationSummariesJson(
      sessionRow.conversationSummariesJson
    );
    entry.returnPolicyLastActivityAt =
      sessionRow.updatedAt != null ? String(sessionRow.updatedAt) : null;
    entry._hydratedFromStorage = true;
  }

  const dossierRow = await getEntity(client, PK.dossier, `user_${sessionId}`);
  if (dossierRow && dossierRow.dossierJson) {
    const raw = safeJsonParse(dossierRow.dossierJson, null);
    if (raw && typeof raw === "object") {
      entry.dossier = normalizeDossier(raw, sessionId);
    }
  }

  const usageRow = await getEntity(client, PK.usageSession, sessionId);
  if (usageRow && usageRow.userExchangeCount != null) {
    const n = Number(usageRow.userExchangeCount);
    if (Number.isFinite(n) && n >= 0) {
      userExchangeCounts.set(sessionId, n);
    }
  }

  const today = getTodayUtc();
  const dailyRow = await getEntity(client, PK.usageDaily, today);
  let dailyCount = null;
  if (dailyRow && dailyRow.count != null) {
    const c = Number(dailyRow.count);
    if (Number.isFinite(c) && c >= 0) dailyCount = c;
  }

  return { dailyCount };
}

/**
 * @param {TableClient} client
 * @param {object} args
 */
async function persistBundle(client, args) {
  const {
    sessionId,
    session,
    dossier,
    userExchangeCount,
    dailyCount,
    persistProfile,
  } = args;

  await ensureTable(client);

  const threadEventsJson = serializeThreadEventsForStorage(session.threadEvents || []);
  const baselineJson = JSON.stringify(baselineRuntimeForPersist(session));
  const summariesJson = serializeConversationSummaries(session.conversationSummaries);
  const detectiveHistoryText = truncateDetectiveHistory(session.history || "");

  if (config.DEBUG_LOGS) {
    logger.info("durableTableStorage", "persist payload sizes", {
      sessionId,
      bytes: {
        threadEventsJson: utf8ByteLength(threadEventsJson),
        baselineRuntimeJson: utf8ByteLength(baselineJson),
        conversationSummariesJson: utf8ByteLength(summariesJson),
        detectiveHistoryText: utf8ByteLength(detectiveHistoryText),
      },
      approxMaxPerStringPropertyBytes: 64 * 1024,
    });
  }

  const sessionEntity = {
    partitionKey: PK.session,
    rowKey: sessionId,
    detectiveStateJson: JSON.stringify(session.state != null ? session.state : null),
    baselineRuntimeJson: baselineJson,
    threadEventsJson,
    conversationSummariesJson: summariesJson,
    detectiveHistoryText,
    baselineCompleted: !!session.attacheCompleted,
    baselineIntroSent: !!session.attacheIntroSent,
    detectiveIntroSent: !!session.detectiveIntroSent,
    updatedAt: new Date().toISOString(),
  };

  await client.upsertEntity(sessionEntity, "Replace");

  if (persistProfile === true && dossier && typeof dossier === "object") {
    const dossierEntity = {
      partitionKey: PK.dossier,
      rowKey: `user_${sessionId}`,
      dossierJson: JSON.stringify(dossier),
      updatedAt: new Date().toISOString(),
    };
    await client.upsertEntity(dossierEntity, "Replace");
  }

  const usageEntity = {
    partitionKey: PK.usageSession,
    rowKey: sessionId,
    userExchangeCount: Number(userExchangeCount) || 0,
    updatedAt: new Date().toISOString(),
  };
  await client.upsertEntity(usageEntity, "Replace");

  if (dailyCount != null && Number.isFinite(Number(dailyCount))) {
    const today = getTodayUtc();
    const dailyEntity = {
      partitionKey: PK.usageDaily,
      rowKey: today,
      count: Number(dailyCount),
      updatedAt: new Date().toISOString(),
    };
    await client.upsertEntity(dailyEntity, "Replace");
  }
}

/**
 * @param {string} sessionId
 */
async function getPersistedChatState(sessionId) {
  const client = getTableClient();
  const empty = {
    messages: [],
    sideTranscripts: { philosophers: [] },
    returnClassification: null,
    envelope: null,
    userProgress: {},
    summaries: null,
    lastActivityAt: null,
    detectiveIntroSent: false,
    baselineIntroSent: false,
  };
  if (!client) {
    return empty;
  }
  await ensureTable(client);
  const sessionRow = await getEntity(client, PK.session, sessionId);
  if (!sessionRow) {
    return {
      ...empty,
      userProgress: {
        baselineCompleted: false,
        baselineDossierRecorded: false,
      },
    };
  }

  const threadEvents = parseThreadEventsJson(sessionRow.threadEventsJson);
  const messages = threadEventsToMainChatMessages(threadEvents);
  const philosopherMessages = threadEventsToPhilosopherMessages(threadEvents);
  const baselineCompleted = !!sessionRow.baselineCompleted;
  const state = safeJsonParse(sessionRow.detectiveStateJson, {});
  const compatible = hasCompatibleMainState(state);
  const effectiveState = compatible
    ? state
    : {
        mainState: {
          schemaVersion: MAIN_STATE_SCHEMA_VERSION,
          attache: { baselineCompleted: false },
          detective: { mode: "normal", turnCount: 0, shouldBeginClosure: false },
        },
      };
  const summaries = parseConversationSummariesJson(
    sessionRow.conversationSummariesJson
  );

  let dossierRow = null;
  try {
    dossierRow = await getEntity(client, PK.dossier, `user_${sessionId}`);
  } catch (_) {}

  let dossier = null;
  if (dossierRow && dossierRow.dossierJson) {
    const raw = safeJsonParse(dossierRow.dossierJson, null);
    if (raw && typeof raw === "object") {
      dossier = normalizeDossier(raw, sessionId);
    }
  }

  const baselineDossierRecorded = !!(
    dossier &&
    dossier.meta &&
    typeof dossier.meta.baselineQuestionsAnswered === "number" &&
    dossier.meta.baselineQuestionsAnswered > 0
  );

  const lastBaselineCompletedAtMs =
    dossier &&
    dossier.meta &&
    typeof dossier.meta.lastBaselineCompletedAt === "number" &&
    Number.isFinite(dossier.meta.lastBaselineCompletedAt)
      ? dossier.meta.lastBaselineCompletedAt
      : null;

  const lastActivityAtIso =
    sessionRow.updatedAt != null ? String(sessionRow.updatedAt) : null;

  const returnClassification = config.ENABLE_RETURN_POLICY
    ? classifySessionReturn({
        lastActivityAtIso,
        lastBaselineCompletedAtMs,
        baselineCompleted,
        baselineDossierRecorded,
      })
    : null;

  // Next POST will run maybeApplyReturnBaselineTransition and hand control back
  // to the Attaché, but storage still shows baselineCompleted until then. Align
  // the snapshot envelope so reload/hydration does not default the UI to
  // Detective labels while the next reply will be Attaché.
  const pendingBaselineRefresh = !!(
    returnClassification &&
    returnClassification.needsBaselineRefresh &&
    !config.RETURN_POLICY_LOG_ONLY
  );
  const effectiveBaselineCompleted =
    baselineCompleted && !pendingBaselineRefresh;
  const effectiveBaselineActive = !effectiveBaselineCompleted;

  const envelope = {
    active_agent: effectiveBaselineCompleted ? "detective" : "attache",
    baseline_active: effectiveBaselineActive,
    baseline_completed: effectiveBaselineCompleted,
    last_user_message: "",
    state_version: compatible ? MAIN_STATE_SCHEMA_VERSION : 0,
    mode:
      effectiveBaselineCompleted &&
      effectiveState.mainState &&
      effectiveState.mainState.detective &&
      effectiveState.mainState.detective.mode === "closure"
        ? "closure"
        : effectiveBaselineCompleted
          ? "normal"
          : "baseline",
  };

  return {
    messages,
    sideTranscripts: {
      philosophers: philosopherMessages,
    },
    returnClassification,
    envelope,
    userProgress: {
      baselineCompleted,
      baselineDossierRecorded,
      returningPersisted: true,
      pendingBaselineRefresh,
    },
    summaries,
    lastActivityAt:
      sessionRow.updatedAt != null ? String(sessionRow.updatedAt) : null,
    detectiveIntroSent: !!sessionRow.detectiveIntroSent,
    baselineIntroSent: !!sessionRow.baselineIntroSent,
  };
}

function createStorage() {
  const client = getTableClient();
  if (!client) return null;

  return {
    async hydrate(sessionId, getSessionEntry, userExchangeCounts) {
      return hydrateSession(client, sessionId, getSessionEntry, userExchangeCounts);
    },
    async persist(args) {
      return persistBundle(client, args);
    },
    async getChatState(sessionId) {
      return getPersistedChatState(sessionId);
    },
  };
}

module.exports = {
  createStorage,
  PK,
};

