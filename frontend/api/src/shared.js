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
const { createChatStateSnapshotBody } = require("../../contracts/chatApiContract");
const { getDebugStateLevel } = require("./logger");

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

const PROMPTS_DIR = path.resolve(__dirname, "..", "prompts");

const userExchangeCounts = new Map();
/** @type {Map<string, number>} sessionId -> last activity epoch ms (for time-away classification) */
const lastActivityAtBySession = new Map();

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

function sessionCookieHeader(sessionId) {
  const maxAge = 7 * 24 * 60 * 60;
  return `sessionId=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

/**
 * @param {import("@azure/functions").HttpRequest} request
 */
function getOrCreateSessionId(request) {
  let cookieHeader = "";
  if (request && typeof request.headers?.get === "function") {
    cookieHeader = request.headers.get("cookie") || "";
  }
  const match = /(?:^|;\s*)sessionId=([^;]+)/.exec(cookieHeader);
  let sessionId = match ? decodeURIComponent(match[1].trim()) : null;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  return sessionId;
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

async function getChatStateForSession(sessionId) {
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

  return createChatStateSnapshotBody({
    envelope,
    messages: [],
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
  createFileDailyUsageStore,
  createMemoryDailyUsageStore,
  sessionCookieHeader,
  getOrCreateSessionId,
  getMsSinceLastVisitForSession,
  setMockLastActivityGapForSession,
  getChatStateForSession,
  handleChatRequest,
  handleChatStream,
};
