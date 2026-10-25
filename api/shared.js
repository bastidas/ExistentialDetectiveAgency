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
const { createChatStateSnapshotBody, buildChatPostErrorBody } = require("./contracts/chatApiContract");
const logger = require("./logger");
const { getDebugStateLevel } = logger;
const durableTableStorage = require("./storage/durableTableStorage");
const threadEvents = require("./storage/threadEvents");
const conversationSummary = require("./dossier/conversationSummary");
const summarization = require("./dossier/summarization");
const usageLimits = require("./usage/usageLimits");
const dailyUsageStores = require("./usage/dailyUsageStore");
const { createRateLimiter, clientKeyFromHeaders } = require("./usage/rateLimiter");

const DEV = /^(1|true|yes)$/i.test(process.env.DEV || "");
const OFFLINE = /^(1|true|yes)$/i.test(process.env.OFFLINE || "");
const DEBUG_LOGS = /^(1|true|yes)$/i.test(process.env.DEBUG_LOGS || "");
const DEBUG_LLM = /^(1|true|yes)$/i.test(process.env.DEBUG_LLM || "");
/** 0–3 from env DEBUG_STATE_LEVEL (see logger.getDebugStateLevel); truthy when any chat-machine state logging is on. */
const DEBUG_STATE_LEVEL = getDebugStateLevel();
const DEBUG_STATE = DEBUG_STATE_LEVEL >= 1;

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const SERVICE_TIER = process.env.OPENAI_SERVICE_TIER || "";
const LIMITS = usageLimits.resolveLimits();
const MAX_USER_EXCHANGES = LIMITS.maxUserExchanges;
const MAX_DAILY_USAGE = LIMITS.maxDailyUsage;
const MAX_MESSAGE_CHARS = LIMITS.maxMessageChars;
const burstLimiter = createRateLimiter({ max: LIMITS.maxRequestsPerMinute, windowMs: 60_000 });

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
/**
 * Exchanges of each session's log that the summarizer may still need, oldest first (`seq` is the
 * thread row key). Seeded from the thread rows on hydrate and appended every exchange.
 *
 * @type {Map<string, Array<{ seq: number, events: Array<object> }>>}
 */
const logTurnsBySession = new Map();
const MAX_LOG_TURNS_KEPT = 200;
/**
 * `own` is this session's summary record (its `fromSeq`/`throughSeq` are rows of this session's log);
 * `inherited` is the user's latest summary from an earlier session, carried over until `own` exists.
 *
 * @type {Map<string, { own: object|null, inherited: object|null }>}
 */
const summaryStateBySession = new Map();
/**
 * Process-wide view of durable storage health. A failed read or write never fails a chat turn; it
 * flips `degraded` so operators and `/api/config` can see that state is only in memory, and the
 * next successful write clears it.
 */
const durableHealth = {
  degraded: false,
  consecutiveFailures: 0,
  lastOperation: null,
  lastError: null,
  lastErrorAt: null,
  lastOkAt: null,
  lastReducedContent: [],
};

/**
 * Exchanges not yet written to the thread table, per session, oldest first. A turn stays here until
 * its row is written, so a failed write is retried on the next turn and nothing is skipped.
 *
 * @type {Map<string, Array<{ seq: number, events: Array<object> }>>}
 */
const pendingThreadTurnsBySession = new Map();
const MAX_PENDING_THREAD_TURNS = 200;

const failingDurableOperations = new Set();
/** What each kind of write last had to leave out, so a clean thread write cannot hide a lossy checkpoint. */
const reducedContentByOperation = new Map();

function recordDurableFailure(operation, err) {
  failingDurableOperations.add(operation);
  durableHealth.degraded = true;
  durableHealth.consecutiveFailures =
    durableHealth.lastOperation === operation ? durableHealth.consecutiveFailures + 1 : 1;
  durableHealth.lastOperation = operation;
  durableHealth.lastError = err && err.message ? String(err.message).slice(0, 500) : String(err).slice(0, 500);
  durableHealth.lastErrorAt = new Date().toISOString();
  logger.warn(
    "shared",
    "durableStorage",
    `${operation} failed (${durableHealth.consecutiveFailures} in a row); continuing with in-memory state: ${durableHealth.lastError}`
  );
}

function recordDurableOk(operation, reducedContent) {
  failingDurableOperations.delete(operation);
  if (failingDurableOperations.size === 0) {
    durableHealth.degraded = false;
    durableHealth.consecutiveFailures = 0;
  }
  durableHealth.lastOkAt = new Date().toISOString();
  reducedContentByOperation.set(operation, Array.isArray(reducedContent) ? reducedContent.slice() : []);
  durableHealth.lastReducedContent = [...reducedContentByOperation.values()].flat();
}

function recordLogTurn(sessionId, seq, events) {
  const turns = logTurnsBySession.get(sessionId) || [];
  turns.push({ seq, events });
  if (turns.length > MAX_LOG_TURNS_KEPT) turns.splice(0, turns.length - MAX_LOG_TURNS_KEPT);
  logTurnsBySession.set(sessionId, turns);
}

function publishConversationSummary(sessionId) {
  const state = summaryStateBySession.get(sessionId);
  const record = state && (state.own || state.inherited);
  chatService.setConversationSummaryForSession(sessionId, record ? record.text : "");
}

/**
 * Pick this session's summary and the one carried over from the user's earlier sessions from what
 * hydrate found: the row's `conversationSummariesJson` and the per-user summary row. For the same
 * session the record covering more of the log wins (the user row is written as soon as a summary is
 * made, the session row only at a checkpoint).
 */
function adoptStoredSummaries(sessionId, sessionRecord, userRecord) {
  const sameSessionUser = userRecord && userRecord.sessionId === sessionId ? userRecord : null;
  let own = sessionRecord || null;
  if (sameSessionUser && (!own || sameSessionUser.throughSeq > own.throughSeq)) own = sameSessionUser;
  const inherited = !own && userRecord && userRecord.sessionId !== sessionId ? userRecord : null;
  summaryStateBySession.set(sessionId, { own, inherited });
  publishConversationSummary(sessionId);
}

/**
 * Extend the session's summary with exchanges it does not cover yet, once enough of them have piled up.
 * Costs one extra model call and only when the uncovered text passes
 * `CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY`. Never throws; a failure leaves the old summary and the
 * exchanges stay in the log for the next try.
 */
async function maybeExtendConversationSummary(sessionId, userId, options) {
  if (!apiConfig.ENABLE_CONVERSATION_SUMMARY || apiConfig.OFFLINE) return;
  const summarizer = options && typeof options.summarizeConversation === "function" ? options.summarizeConversation : null;
  const openai = options && options.openaiClient;
  if (!summarizer && !openai) return;
  const state = summaryStateBySession.get(sessionId) || { own: null, inherited: null };
  try {
    const next = await conversationSummary.extendSummary({
      turns: logTurnsBySession.get(sessionId) || [],
      previous: state.own,
      priorText: state.inherited ? state.inherited.text : "",
      userId: userId || "",
      sessionId,
      thresholdChars: apiConfig.CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY,
      summarize: summarizer || ((input) => summarization.summarizeHistory(openai, input, { fallbackToTruncation: false })),
    });
    if (!next) return;
    summaryStateBySession.set(sessionId, { own: next, inherited: null });
    publishConversationSummary(sessionId);
    if (userId && isDurableStorageEnabled() && hydratedDurableSessions.has(sessionId)) {
      const client = durableTableStorage.getTableClient();
      if (client) {
        try {
          await durableTableStorage.saveUserSummary(client, userId, next);
          recordDurableOk("summary_write", []);
        } catch (err) {
          recordDurableFailure("summary_write", err);
        }
      }
    }
  } catch (err) {
    logger.warn("shared", "conversationSummary", err && err.message ? err.message : String(err));
  }
}

function getDurableHealth() {
  return { ...durableHealth, lastReducedContent: durableHealth.lastReducedContent.slice() };
}
const dirtyTurnsSinceCheckpoint = new Map();
const lastCheckpointMsBySession = new Map();
const SESSION_ID_COOKIE_NAME = "sessionId";
const USER_ID_COOKIE_NAME = "edaUserId";
const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const USER_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

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

/**
 * Apply what `hydrateSession` read to the in-memory session. Pure memory work: no storage calls, so a
 * throw here is a bug, not an outage.
 */
function restoreSessionMemoryFromRows(id, hydrated, userRecord) {
  const blob = hydrated.orchestrationRuntime;
  if (blob && typeof blob === "object") {
    chatService.restoreSessionRuntimeFromDurable(id, blob);
    const ref = blob.historyRef;
    if (ref && Number(ref.toSeq) > Number(hydrated.sessionSeq || 0)) {
      logger.warn(
        "shared",
        "durableStorage",
        `session ${id}: checkpoint points at log rows through seq ${ref.toSeq}, but the log ends at ${hydrated.sessionSeq}`
      );
    }
  }
  chatService.restoreTurnState(id, hydrated.agentState, hydrated.threadEvents);
  chatService.restoreSessionFromRowColumns(id, hydrated);
  chatService.restoreCountersFromLog(id, hydrated.threadEvents);
  chatService.restorePhilosopherHistoriesFromThread(id, hydrated.threadEvents);
  if (hydrated.lastActivityAt && !lastActivityAtBySession.has(id)) {
    const at = Date.parse(hydrated.lastActivityAt);
    if (Number.isFinite(at)) lastActivityAtBySession.set(id, at);
  }
  logTurnsBySession.set(id, (hydrated.threadTurns || []).slice(-MAX_LOG_TURNS_KEPT));
  adoptStoredSummaries(id, hydrated.conversationSummary, userRecord);
}

async function hydrateSessionFromDurable(sessionId, userIdHint) {
  if (!isDurableStorageEnabled()) return null;
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id || hydratedDurableSessions.has(id)) return null;
  const client = durableTableStorage.getTableClient();
  if (!client) return null;
  let hydrated;
  let userRecord = null;
  try {
    hydrated = await durableTableStorage.hydrateSession(client, id);
    if (Array.isArray(hydrated.threadEvents)) {
      threadEventsBySession.set(id, threadEvents.trimEvents(hydrated.threadEvents));
    }
    threadSeqBySession.set(id, Number(hydrated.sessionSeq || 0));
    if (hydrated.userId) {
      await chatService.mergeDossierFromTableIfNewer(id, hydrated.userId, client);
    }
    const summaryUserId = hydrated.userId || (typeof userIdHint === "string" && userIdHint ? userIdHint : null);
    if (summaryUserId) {
      try {
        userRecord = await durableTableStorage.getUserSummary(client, summaryUserId);
      } catch (err) {
        logger.warn("shared", "conversationSummary", `could not read the user's summary: ${err && err.message ? err.message : err}`);
      }
    }
  } catch (err) {
    // Not marked hydrated: it is retried on the next request, and checkpoints are held back until it
    // succeeds so an empty in-memory session can never overwrite the stored one.
    recordDurableFailure("hydrate", err);
    return null;
  }
  const reasons = (hydrated.degraded || []).map((reason) => `stored_checkpoint_${reason}`);
  try {
    restoreSessionMemoryFromRows(id, hydrated, userRecord);
  } catch (err) {
    // A restore bug must not loop forever as a failed hydrate; the session continues from what was applied.
    logger.warn("shared", "durableStorage", `session ${id}: restoring stored state failed: ${err && err.message ? err.message : err}`);
    reasons.push("restore_failed");
  }
  hydratedDurableSessions.add(id);
  recordDurableOk("hydrate", reasons);
  return hydrated;
}

function queueThreadTurn(sessionId, seq, events, state) {
  if (!isDurableStorageEnabled() || !Array.isArray(events) || events.length === 0) return;
  const queue = pendingThreadTurnsBySession.get(sessionId) || [];
  queue.push({ seq, events, state: state || null });
  if (queue.length > MAX_PENDING_THREAD_TURNS) {
    queue.splice(0, queue.length - MAX_PENDING_THREAD_TURNS);
    logger.warn("shared", "durableStorage", `session ${sessionId}: pending thread writes capped at ${MAX_PENDING_THREAD_TURNS}`);
  }
  pendingThreadTurnsBySession.set(sessionId, queue);
}

/**
 * Write every queued exchange to the thread table, oldest first. Runs on every turn. Never throws:
 * on a storage error the failed exchange and the ones after it stay queued for the next turn.
 *
 * @returns {Promise<{ ok: boolean, written: number, skipped?: string }>}
 */
async function flushThreadTurnsToDurable(sessionId, userId) {
  if (!isDurableStorageEnabled()) return { ok: false, written: 0, skipped: "disabled" };
  const queue = pendingThreadTurnsBySession.get(sessionId);
  if (!queue || queue.length === 0) return { ok: true, written: 0 };
  const client = durableTableStorage.getTableClient();
  if (!client) return { ok: false, written: 0, skipped: "no_client" };
  if (!hydratedDurableSessions.has(sessionId)) return { ok: false, written: 0, skipped: "not_hydrated" };
  let written = 0;
  while (queue.length > 0) {
    const turn = queue[0];
    try {
      const result = await durableTableStorage.saveThreadTurn(client, {
        sessionId,
        userId: userId || null,
        seq: turn.seq,
        events: turn.events,
        state: turn.state,
      });
      recordDurableOk("thread_write", result && result.degraded);
    } catch (err) {
      recordDurableFailure("thread_write", err);
      return { ok: false, written };
    }
    queue.shift();
    written += 1;
  }
  pendingThreadTurnsBySession.delete(sessionId);
  return { ok: true, written };
}

/**
 * Best-effort checkpoint: never throws. Resolves `{ ok: true }` when the row was written and
 * `{ ok: false }` when it was skipped or failed, so the caller keeps the session marked dirty and
 * retries on the next turn.
 *
 * @returns {Promise<{ ok: boolean, skipped?: string, error?: string }>}
 */
async function saveSessionCheckpointToDurable(sessionId, userId, envelope) {
  if (!isDurableStorageEnabled()) return { ok: false, skipped: "disabled" };
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return { ok: false, skipped: "no_session" };
  const client = durableTableStorage.getTableClient();
  if (!client) return { ok: false, skipped: "no_client" };
  if (!hydratedDurableSessions.has(id)) return { ok: false, skipped: "not_hydrated" };
  const exported = chatService.exportSessionRuntimeForDurable(id);
  // Lumen and Umbra history is not copied into the checkpoint; this points at the log rows it is
  // rebuilt from (partition `EDA_thread_<sessionId>`, row keys `fromSeq`..`toSeq`).
  const orchestrationRuntime = exported
    ? { ...exported, historyRef: { sessionId: id, fromSeq: 1, toSeq: threadSeqBySession.get(id) || 0 } }
    : exported;
  const payload = {
    sessionId: id,
    userId: userId || null,
    sessionSeq: threadSeqBySession.get(id) || 0,
    baselineCompleted: !!(envelope && envelope.baseline_completed),
    detectiveIntroSent: chatService.getDetectiveIntroSentForSession(id),
    conversationSummary: (summaryStateBySession.get(id) || {}).own || null,
    detectiveHistoryText: chatService.exportDetectiveHistoryText(id),
    orchestrationRuntime,
  };
  try {
    const written = await durableTableStorage.saveSessionCheckpoint(client, payload);
    recordDurableOk("checkpoint", written && written.degraded);
    if (!written || !written.degraded || written.degraded.length === 0) {
      // The row was rewritten in full, so a reduced checkpoint noticed at hydrate no longer applies.
      reducedContentByOperation.delete("hydrate");
      durableHealth.lastReducedContent = [...reducedContentByOperation.values()].flat();
    }
    return { ok: true };
  } catch (err) {
    recordDurableFailure("checkpoint", err);
    return { ok: false, error: durableHealth.lastError };
  }
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
  await hydrateSessionFromDurable(sessionId, userId);
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
    detectiveIntroSent: sid != null && chatService.getDetectiveIntroSentForSession(sid),
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

/**
 * @param {string} message
 * @returns {{ status: number, body: object }|null}
 */
function rejectMessageLength(message) {
  if (message.length <= MAX_MESSAGE_CHARS) return null;
  return {
    status: 400,
    body: buildChatPostErrorBody({
      error: `That message is too long (limit ${MAX_MESSAGE_CHARS} characters).`,
      errorKind: "bad_request",
    }),
  };
}

/**
 * Per-client burst check. Callers pass `options.clientKey` (see `clientKeyFromHeaders`); without a
 * key the check is skipped.
 *
 * @param {{ clientKey?: string }|undefined} options
 * @returns {{ status: number, body: object }|null}
 */
function rejectBurst(options) {
  const key = options && options.clientKey;
  if (!key) return null;
  const verdict = burstLimiter.check(key);
  if (verdict.allowed) return null;
  return {
    status: 429,
    body: buildChatPostErrorBody({ error: usageLimits.RATE_LIMIT_MESSAGE, errorKind: "rate_limit" }),
  };
}

async function handleChatRequest(sessionId, trimmed, options) {
  const tooLong = rejectMessageLength(trimmed);
  if (tooLong) return tooLong;
  const burst = rejectBurst(options);
  if (burst) return burst;

  await hydrateSessionFromDurable(sessionId, options && options.userId);

  const dailyStore = options && options.dailyUsageStore;
  const spendsModelTurn = !apiConfig.OFFLINE && !!(options && options.openaiClient);
  const sessionClosed = chatService.isSessionPastFinalExchange(sessionId, MAX_USER_EXCHANGES);
  let reservedCount = null;
  if (spendsModelTurn && !sessionClosed && dailyStore && typeof dailyStore.reserveTurn === "function") {
    const reservation = await dailyStore.reserveTurn(MAX_DAILY_USAGE);
    if (!reservation.allowed) {
      return {
        status: 429,
        body: buildChatPostErrorBody({
          error: usageLimits.DAILY_LIMIT_MESSAGE,
          errorKind: "rate_limit",
        }),
      };
    }
    reservedCount = reservation.count;
  }

  const prev = userExchangeCounts.get(sessionId) ?? 0;
  const exchangeCount = prev + 1;
  userExchangeCounts.set(sessionId, exchangeCount);

  const now = Date.now();
  const lastAt = lastActivityAtBySession.get(sessionId);
  const msSinceLastVisit = lastAt == null ? 0 : Math.max(0, now - lastAt);
  lastActivityAtBySession.set(sessionId, now);

  const dailyUsage =
    reservedCount != null
      ? reservedCount
      : dailyStore && typeof dailyStore.readDailyUsage === "function"
        ? await dailyStore.readDailyUsage()
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
    const turnEvents = threadEvents.buildTurnEvents({
      phase,
      userMessage: trimmed,
      reply: out.body.reply,
      lumenUserResponse: out.body.lumenUserResponse,
      umbraUserResponse: out.body.umbraUserResponse,
    });
    threadEventsBySession.set(sessionId, threadEvents.trimEvents(prior.concat(turnEvents)));
    const nextSeq = (threadSeqBySession.get(sessionId) || 0) + 1;
    threadSeqBySession.set(sessionId, nextSeq);
    out.body.serverSeq = nextSeq;
    queueThreadTurn(sessionId, nextSeq, turnEvents, chatService.exportTurnState(sessionId));
    recordLogTurn(sessionId, nextSeq, turnEvents);
    await flushThreadTurnsToDurable(sessionId, options && options.userId ? options.userId : null);
    await maybeExtendConversationSummary(
      sessionId,
      options && options.userId ? options.userId : null,
      options
    );
    const dirty = (dirtyTurnsSinceCheckpoint.get(sessionId) || 0) + 1;
    dirtyTurnsSinceCheckpoint.set(sessionId, dirty);
    const now = Date.now();
    const last = lastCheckpointMsBySession.get(sessionId) || 0;
    const k = apiConfig.SESSION_CHECKPOINT_EVERY_K_TURNS;
    const minMs = apiConfig.SESSION_CHECKPOINT_MIN_INTERVAL_MS;
    const forceCheckpoint = dirty >= k || now - last >= minMs;
    if (forceCheckpoint) {
      const saved = await saveSessionCheckpointToDurable(
        sessionId,
        options && options.userId ? options.userId : null,
        envelope
      );
      if (saved.ok || saved.skipped === "disabled" || saved.skipped === "no_client") {
        dirtyTurnsSinceCheckpoint.set(sessionId, 0);
        lastCheckpointMsBySession.set(sessionId, now);
      }
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

/**
 * Recovery path for a client whose local transcript is ahead of what the server holds (for example
 * after a restart that lost in-memory state). It can only append events beyond the ones the server
 * already has: it never rewrites or removes stored events, only whitelisted event kinds are
 * accepted, sizes are capped, and `serverSeq` advances by the number of user turns appended rather
 * than to whatever number the client sends.
 *
 * @param {string} sessionId
 * @param {string|null} userId
 * @param {{ clientSeq?: number, messages?: unknown[] }} payload
 * @param {{ clientKey?: string }} [options]
 */
async function handleChatSync(sessionId, userId, payload, options) {
  if (rejectBurst(options)) return { ok: false, reason: "rate_limited" };
  await hydrateSessionFromDurable(sessionId, userId);
  const clientSeq =
    payload && typeof payload.clientSeq === "number" && Number.isFinite(payload.clientSeq)
      ? Math.max(0, Math.floor(payload.clientSeq))
      : 0;
  const currentSeq = threadSeqBySession.get(sessionId) || 0;
  const current = threadEventsBySession.get(sessionId) || [];
  const incoming = payload && Array.isArray(payload.messages) ? payload.messages : [];
  if (clientSeq <= currentSeq || incoming.length === 0) {
    return { ok: true, serverSeq: currentSeq };
  }
  const tail = threadEvents.sanitizeSyncedMessages(incoming.slice(current.length), {
    maxEvents: 4 * (MAX_USER_EXCHANGES + 2),
    maxChars: Math.max(MAX_MESSAGE_CHARS, 8000),
  });
  const userTurnsAppended = tail.filter((e) => e.kind === "user").length;
  if (userTurnsAppended === 0) {
    return { ok: true, serverSeq: currentSeq };
  }
  const nextSeq = Math.min(clientSeq, currentSeq + userTurnsAppended);
  threadEventsBySession.set(sessionId, threadEvents.trimEvents(current.concat(tail)));
  threadSeqBySession.set(sessionId, nextSeq);
  queueThreadTurn(sessionId, nextSeq, tail);
  recordLogTurn(sessionId, nextSeq, tail);
  await flushThreadTurnsToDurable(sessionId, userId);
  return { ok: true, serverSeq: nextSeq };
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
  createFileDailyUsageStore: dailyUsageStores.createFileDailyUsageStore,
  createMemoryDailyUsageStore: dailyUsageStores.createMemoryDailyUsageStore,
  createDailyUsageStore: dailyUsageStores.createDailyUsageStore,
  clientKeyFromHeaders,
  MAX_MESSAGE_CHARS,
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
  getDurableHealth,
  flushThreadTurnsToDurable,
  getMsSinceLastVisitForSession,
  setMockLastActivityGapForSession,
  getChatStateForSession,
  handleChatRequest,
  handleChatStream,
  handleChatSync,
  resolveDurableStorageMode: apiConfig.resolveDurableStorageMode,
};
