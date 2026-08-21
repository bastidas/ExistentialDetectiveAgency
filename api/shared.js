"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const chatService = require("./chatService");
const {
  getInitialChatEnvelope,
  getChatEnvelopeForSession,
  getOrchestrationUserTurnCountForSession,
} = require("./orchestration/chatMachine");
const { classifyTimeAway } = require("./orchestration/timeAwayClassification");
const apiConfig = require("./config");
const { createChatStateSnapshotBody } = require("./contracts/chatApiContract");
const { getDebugStateLevel } = require("./logger");
const durableTableStorage = require("./storage/durableTableStorage");
const threadEvents = require("./storage/threadEvents");

const DEV = /^(1|true|yes)$/i.test(process.env.DEV || "");
const OFFLINE = /^(1|true|yes)$/i.test(process.env.OFFLINE || "");
const DEBUG_LOGS = /^(1|true|yes)$/i.test(process.env.DEBUG_LOGS || "");
const DEBUG_LLM = /^(1|true|yes)$/i.test(process.env.DEBUG_LLM || "");
/** 0–3 from env DEBUG_STATE_LEVEL (see logger.getDebugStateLevel); truthy when any chat-machine state logging is on. */
const DEBUG_STATE_LEVEL = getDebugStateLevel();
const DEBUG_STATE = DEBUG_STATE_LEVEL >= 1;

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const SERVICE_TIER = process.env.OPENAI_SERVICE_TIER || "";
const MAX_USER_EXCHANGES = Number(process.env.MAX_USER_EXCHANGES || 1_000_000);
const MAX_DAILY_USAGE = Number(process.env.MAX_DAILY_USAGE || 1_000_000);

/** @deprecated Prefer `apiConfig.resolveDurableStorageMode()`; kept for legacy `/api/debug` and callers. */
const ENABLE_DURABLE_STORAGE = /^(1|true|yes)$/i.test(process.env.ENABLE_DURABLE_STORAGE || "");
const DOSSIER_TABLE_NAME = process.env.DOSSIER_TABLE_NAME || null;
const ENABLE_RETURN_POLICY = /^(1|true|yes)$/i.test(process.env.ENABLE_RETURN_POLICY || "");
const RETURN_POLICY_LOG_ONLY = /^(1|true|yes)$/i.test(process.env.RETURN_POLICY_LOG_ONLY || "");

const TIME_AWAY_DISABLE_MIN_GUARDS = /^(1|true|yes)$/i.test(
  process.env.TIME_AWAY_DISABLE_MIN_GUARDS || ""
);
const TIME_AWAY_BRIEF_MS = Number(process.env.TIME_AWAY_BRIEF_MS || 0);
const TIME_AWAY_MODERATE_MS = Number(process.env.TIME_AWAY_MODERATE_MS || 0);
const TIME_AWAY_LONG_MS = Number(process.env.TIME_AWAY_LONG_MS || 0);

const PROMPTS_DIR = apiConfig.PROMPTS_DIR;

const userExchangeCounts = new Map();
/** @type {Map<string, number>} sessionId -> last activity epoch ms (for time-away classification) */
const lastActivityAtBySession = new Map();
/** @type {Map<string, Array<object>>} */
const threadEventsBySession = new Map();
/** @type {Map<string, number>} */
const threadSeqBySession = new Map();
const hydratedDurableSessions = new Set();
const dirtyTurnsSinceCheckpoint = new Map();
const lastCheckpointMsBySession = new Map();
const SESSION_ID_COOKIE_NAME = "sessionId";
const USER_ID_COOKIE_NAME = "edaUserId";
const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const USER_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function createFileDailyUsageStore(dataDir) {
  const filePath = path.join(dataDir, "daily_usage.json");
  return {
    readDailyUsage() {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const j = JSON.parse(raw);
        return typeof j.count === "number" ? j.count : 0;
      } catch (_) {
        return 0;
      }
    },
    incrementDailyUsage() {
      const n = this.readDailyUsage() + 1;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ count: n }));
    },
  };
}

function createMemoryDailyUsageStore() {
  let count = 0;
  return {
    readDailyUsage() {
      return count;
    },
    incrementDailyUsage() {
      count += 1;
    },
  };
}

function parseCookieValue(cookieHeader, cookieName) {
  const h = typeof cookieHeader === "string" ? cookieHeader : "";
  const safeName = String(cookieName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|;\\s*)${safeName}=([^;]+)`).exec(h);
  return match ? decodeURIComponent(match[1].trim()) : null;
}

function buildCookieHeader(name, value, maxAgeSeconds) {
  return (
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ` +
    `HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`
  );
}

function sessionCookieHeader(sessionId) {
  return buildCookieHeader(SESSION_ID_COOKIE_NAME, sessionId, SESSION_COOKIE_MAX_AGE_SECONDS);
}

function userCookieHeader(userId) {
  return buildCookieHeader(USER_ID_COOKIE_NAME, userId, USER_COOKIE_MAX_AGE_SECONDS);
}

function getOrCreateIdentityFromCookieHeader(cookieHeader) {
  let sessionId = parseCookieValue(cookieHeader, SESSION_ID_COOKIE_NAME);
  let userId = parseCookieValue(cookieHeader, USER_ID_COOKIE_NAME);
  const created = { sessionId: false, userId: false };
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    created.sessionId = true;
  }
  if (!userId) {
    userId = crypto.randomUUID();
    created.userId = true;
  }
  return { sessionId, userId, created };
}

function identityCookieHeaders(identity) {
  const out = [];
  if (identity && identity.sessionId) out.push(sessionCookieHeader(identity.sessionId));
  if (identity && identity.userId) out.push(userCookieHeader(identity.userId));
  return out;
}

function ensureExpressIdentity(req, res) {
  const cookieHeader =
    req && req.headers && typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  const identity = getOrCreateIdentityFromCookieHeader(cookieHeader);
  if (identity.created.sessionId) {
    res.cookie(SESSION_ID_COOKIE_NAME, identity.sessionId, {
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS * 1000,
      sameSite: "lax",
    });
  }
  if (identity.created.userId) {
    res.cookie(USER_ID_COOKIE_NAME, identity.userId, {
      httpOnly: true,
      maxAge: USER_COOKIE_MAX_AGE_SECONDS * 1000,
      sameSite: "lax",
    });
  }
  return identity;
}

function isDurableStorageEnabled() {
  return apiConfig.resolveDurableStorageMode() !== "off";
}

async function hydrateSessionFromDurable(sessionId) {
  if (!isDurableStorageEnabled()) return null;
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id || hydratedDurableSessions.has(id)) return null;
  const client = durableTableStorage.getTableClient();
  if (!client) return null;
  const hydrated = await durableTableStorage.hydrateSession(client, id);
  if (Array.isArray(hydrated.threadEvents)) {
    threadEventsBySession.set(id, threadEvents.trimEvents(hydrated.threadEvents));
  }
  threadSeqBySession.set(id, Number(hydrated.sessionSeq || 0));
  if (hydrated.userId) {
    await chatService.mergeDossierFromTableIfNewer(id, hydrated.userId, client);
  }
  if (hydrated.orchestrationRuntime && typeof hydrated.orchestrationRuntime === "object") {
    chatService.restoreSessionRuntimeFromDurable(id, hydrated.orchestrationRuntime);
  }
  hydratedDurableSessions.add(id);
  return hydrated;
}

async function saveSessionCheckpointToDurable(sessionId, userId, envelope) {
  if (!isDurableStorageEnabled()) return;
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return;
  const client = durableTableStorage.getTableClient();
  if (!client) return;
  const orchestrationRuntime = chatService.exportSessionRuntimeForDurable(id);
  const payload = {
    sessionId: id,
    userId: userId || null,
    sessionSeq: threadSeqBySession.get(id) || 0,
    threadEvents: threadEventsBySession.get(id) || [],
    baselineCompleted: !!(envelope && envelope.baseline_completed),
    detectiveIntroSent: !!(envelope && envelope.active_agent === "detective"),
    conversationSummaries: null,
    detectiveHistoryText: "",
    orchestrationRuntime,
  };
  await durableTableStorage.saveSessionCheckpoint(client, payload);
}

/**
 * @param {import("@azure/functions").HttpRequest} request
 */
function getOrCreateSessionId(request) {
  return getOrCreateIdentity(request).sessionId;
}

/**
 * @param {import("@azure/functions").HttpRequest} request
 */
function getOrCreateIdentity(request) {
  const cookieHeader =
    request && typeof request.headers?.get === "function" ? request.headers.get("cookie") || "" : "";
  return getOrCreateIdentityFromCookieHeader(cookieHeader);
}

/**
 * Ms since last POST /api/chat activity (for time-away classification on GET /api/chat-state).
 *
 * @param {string|null|undefined} sessionId
 * @returns {number}
 */
function getMsSinceLastVisitForSession(sessionId) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return 0;
  const lastAt = lastActivityAtBySession.get(id);
  return lastAt == null ? 0 : Math.max(0, Date.now() - lastAt);
}

/**
 * Dev/lab: pretend the user last spoke `msSinceLastVisit` ago (next chat POST classifies that gap).
 *
 * @param {string} sessionId
 * @param {number} msSinceLastVisit
 */
function setMockLastActivityGapForSession(sessionId, msSinceLastVisit) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return;
  const ms =
    typeof msSinceLastVisit === "number" && Number.isFinite(msSinceLastVisit)
      ? Math.max(0, msSinceLastVisit)
      : 0;
  lastActivityAtBySession.set(id, Date.now() - ms);
}

/**
 * @param {string|null|undefined} sessionId
 * @param {string|null|undefined} [userId] — echoed for client cache invalidation (opaque; HttpOnly cookie).
 */
async function getChatStateForSession(sessionId, userId) {
  await hydrateSessionFromDurable(sessionId);
  const env =
    typeof sessionId === "string" && sessionId.length > 0
      ? getChatEnvelopeForSession(sessionId)
      : null;
  const envelope = env || getInitialChatEnvelope();
  const sid = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  const ms = sid != null ? getMsSinceLastVisitForSession(sid) : 0;
  const tier = classifyTimeAway(ms);
  const transcriptHidden = tier.bin === "long" || tier.bin === "stale";
  const hasChatSnapshot = sid != null && getChatEnvelopeForSession(sid) != null;
  const uid = typeof userId === "string" && userId.length > 0 ? userId : null;

  return createChatStateSnapshotBody({
    envelope,
    messages: threadEvents.toChatStateMessages(threadEventsBySession.get(sid) || []),
    serverSeq: sid != null ? threadSeqBySession.get(sid) || 0 : 0,
    resumeUi: {
      transcriptMode: transcriptHidden ? "hidden" : "full",
      skipEmptyChatBootstrap: transcriptHidden,
      serverRetainsHistory: true,
    },
    userProgress: {
      baselineCompleted: !!envelope.baseline_completed,
      pendingBaselineRefresh: false,
      returningPersisted: transcriptHidden || hasChatSnapshot,
    },
    edaUserIdEcho: uid || undefined,
    orchestration:
      sid != null
        ? {
            orchestration_user_turn_count: getOrchestrationUserTurnCountForSession(sid),
            detective_turn_count: chatService.getDetectiveTurnCountForSession(sid),
            attache_exchange_count: chatService.getAttacheExchangeCountForSession(sid),
          }
        : {
            orchestration_user_turn_count: 0,
            detective_turn_count: 0,
            attache_exchange_count: 0,
          },
  });
}

async function handleChatRequest(sessionId, trimmed, options) {
  await hydrateSessionFromDurable(sessionId);
  const prev = userExchangeCounts.get(sessionId) ?? 0;
  const exchangeCount = prev + 1;
  userExchangeCounts.set(sessionId, exchangeCount);

  const now = Date.now();
  const lastAt = lastActivityAtBySession.get(sessionId);
  const msSinceLastVisit = lastAt == null ? 0 : Math.max(0, now - lastAt);
  lastActivityAtBySession.set(sessionId, now);

  const dailyUsage =
    options && options.dailyUsageStore && typeof options.dailyUsageStore.readDailyUsage === "function"
      ? options.dailyUsageStore.readDailyUsage()
      : 0;

  const out = await chatService.composeChatResponse(sessionId, trimmed, {
    ...options,
    debug: !!(options && options.debug),
    userExchangeCount: exchangeCount,
    dailyUsage,
    maxUserExchanges: MAX_USER_EXCHANGES,
    maxDailyUsage: MAX_DAILY_USAGE,
    msSinceLastVisit,
  });
  if (out && out.status === 204) {
    return { status: 204, body: {} };
  }
  if (out && out.body) {
    const envelope = out.body && out.body.envelope ? out.body.envelope : null;
    const phase = envelope && envelope.active_agent === "attache" ? "baseline" : "detective";
    const prior = threadEventsBySession.get(sessionId) || [];
    const next = threadEvents.appendTurn(prior, {
      phase,
      userMessage: trimmed,
      reply: out.body.reply,
      lumenUserResponse: out.body.lumenUserResponse,
      umbraUserResponse: out.body.umbraUserResponse,
    });
    threadEventsBySession.set(sessionId, next);
    const nextSeq = (threadSeqBySession.get(sessionId) || 0) + 1;
    threadSeqBySession.set(sessionId, nextSeq);
    out.body.serverSeq = nextSeq;
    const dirty = (dirtyTurnsSinceCheckpoint.get(sessionId) || 0) + 1;
    dirtyTurnsSinceCheckpoint.set(sessionId, dirty);
    const now = Date.now();
    const last = lastCheckpointMsBySession.get(sessionId) || 0;
    const k = apiConfig.SESSION_CHECKPOINT_EVERY_K_TURNS;
    const minMs = apiConfig.SESSION_CHECKPOINT_MIN_INTERVAL_MS;
    const forceCheckpoint = dirty >= k || now - last >= minMs;
    if (forceCheckpoint) {
      await saveSessionCheckpointToDurable(
        sessionId,
        options && options.userId ? options.userId : null,
        envelope
      );
      dirtyTurnsSinceCheckpoint.set(sessionId, 0);
      lastCheckpointMsBySession.set(sessionId, now);
    }
  }
  return { status: 200, body: out.body };
}

async function handleChatStream(sessionId, trimmed, options, onEvent) {
  const result = await handleChatRequest(sessionId, trimmed, options);
  if (result.status === 204) {
    await onEvent({ type: "final", status: 204, body: {} });
    return;
  }
  await onEvent({ type: "final", status: result.status, body: result.body });
}

async function handleChatSync(sessionId, userId, payload) {
  await hydrateSessionFromDurable(sessionId);
  const localMessages = payload && Array.isArray(payload.messages) ? payload.messages : [];
  const clientSeq =
    payload && typeof payload.clientSeq === "number" && Number.isFinite(payload.clientSeq)
      ? Math.max(0, Math.floor(payload.clientSeq))
      : 0;
  const currentSeq = threadSeqBySession.get(sessionId) || 0;
  if (clientSeq <= currentSeq || localMessages.length === 0) {
    return { ok: true, serverSeq: currentSeq };
  }
  const normalizedEvents = [];
  for (let i = 0; i < localMessages.length; i += 1) {
    const m = localMessages[i];
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const kind = role === "user" ? "user" : m.kind || "detective";
    normalizedEvents.push({
      ts: Date.now(),
      phase: "detective",
      kind: String(kind),
      text: String(m.text || ""),
      agent: role === "user" ? "user" : m.agent || "detective",
    });
  }
  const merged = threadEvents.trimEvents(normalizedEvents);
  threadEventsBySession.set(sessionId, merged);
  threadSeqBySession.set(sessionId, clientSeq);
  await saveSessionCheckpointToDurable(sessionId, userId, getChatEnvelopeForSession(sessionId));
  return { ok: true, serverSeq: clientSeq };
}

module.exports = {
  DEV,
  OFFLINE,
  ALLOW_TEST_SEED: apiConfig.ALLOW_TEST_SEED,
  DEBUG_LOGS,
  DEBUG_LLM,
  DEBUG_STATE,
  DEBUG_STATE_LEVEL,
  MODEL,
  SERVICE_TIER,
  MAX_USER_EXCHANGES,
  MAX_DAILY_USAGE,
  ENABLE_DURABLE_STORAGE,
  DOSSIER_TABLE_NAME,
  ENABLE_RETURN_POLICY,
  RETURN_POLICY_LOG_ONLY,
  TIME_AWAY_DISABLE_MIN_GUARDS,
  TIME_AWAY_BRIEF_MS,
  TIME_AWAY_MODERATE_MS,
  TIME_AWAY_LONG_MS,
  PROMPTS_DIR,
  userExchangeCounts,
  threadEventsBySession,
  createFileDailyUsageStore,
  createMemoryDailyUsageStore,
  SESSION_ID_COOKIE_NAME,
  USER_ID_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  USER_COOKIE_MAX_AGE_SECONDS,
  sessionCookieHeader,
  userCookieHeader,
  identityCookieHeaders,
  ensureExpressIdentity,
  getOrCreateIdentity,
  getOrCreateSessionId,
  hydrateSessionFromDurable,
  reloadSessionFromDurable: hydrateSessionFromDurable,
  saveSessionCheckpointToDurable,
  getMsSinceLastVisitForSession,
  setMockLastActivityGapForSession,
  getChatStateForSession,
  handleChatRequest,
  handleChatStream,
  handleChatSync,
  resolveDurableStorageMode: apiConfig.resolveDurableStorageMode,
};
