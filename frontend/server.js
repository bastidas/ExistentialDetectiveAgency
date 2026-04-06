"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const OpenAI = require("openai");

const apiConfig = require("./api/src/config");
const shared = require("./api/src/shared");
const { seedSessionScenario } = require("./api/src/chatTestSeed");
const {
  buildPromptPreviewFromPreset,
  validateAttachePresetOverrides,
  previewChatMachineRouting,
} = require("./api/src/chatScenarioPreview");
const {
  buildOrchestrationLabSnapshot,
  runOrchestrationLabStep,
} = require("./api/src/orchestration/orchestrationLabSnapshot");
const {
  EXISTENTIAL_THERAPY_PHASE_OPTIONS,
  NARRATIVE_PHASE_OPTIONS,
} = require("./api/src/chatScenarioLabPhases");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const dailyUsageStore = shared.createFileDailyUsageStore(DATA_DIR);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey && !shared.OFFLINE) {
  console.error(
    "Missing OPENAI_API_KEY. Set it in .env or the environment (or use OFFLINE=1 to skip the AI)."
  );
  process.exit(1);
}

const client = apiKey
  ? new OpenAI({
      apiKey,
      timeout: apiConfig.OPENAI_TIMEOUT_MS,
      maxRetries: 1,
    })
  : null;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.get("/contracts/chat-http.contract.json", (req, res) => {
  res.type("application/json");
  res.sendFile(path.join(__dirname, "contracts", "chat-http.contract.json"));
});

function getOrCreateSessionId(req, res) {
  let sessionId = req.cookies?.sessionId;
  if (shared.DEBUG_LOGS) {
    console.log(
      "[server] sessionId cookie present:",
      !!sessionId,
      sessionId || "(none)"
    );
  }
  if (!sessionId) {
    sessionId = require("crypto").randomUUID();
    res.cookie("sessionId", sessionId, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });
  }
  return sessionId;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/notedebug", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "notedebug.html"));
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (req.method !== "GET") return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/config", (req, res) => {
  res.json({
    devMode: !!shared.DEV,
    debugLogs: !!shared.DEBUG_LOGS,
    debugLlm: !!shared.DEBUG_LLM,
    debugState: shared.DEBUG_STATE_LEVEL,
  });
});

app.get("/api/debug", async (req, res) => {
  if (!shared.DEBUG_LOGS) return res.status(404).end();
  const sessionId = getOrCreateSessionId(req, res);
  let dailyCount = dailyUsageStore.readDailyUsage();
  if (shared.ENABLE_DURABLE_STORAGE && shared.reloadSessionFromDurable) {
    try {
      const h = await shared.reloadSessionFromDurable(sessionId);
      if (h && h.dailyCount != null) dailyCount = h.dailyCount;
    } catch (_) {}
  }
  const userExchangeCount = shared.userExchangeCounts.get(sessionId) ?? 0;
  res.json({
    devMode: shared.DEV,
    offline: shared.OFFLINE,
    debugLogs: !!shared.DEBUG_LOGS,
    debugLlm: !!shared.DEBUG_LLM,
    debugState: shared.DEBUG_STATE_LEVEL,
    model: shared.MODEL,
    serviceTier: shared.SERVICE_TIER || "(default)",
    userExchangeCount,
    maxUserExchanges: shared.MAX_USER_EXCHANGES,
    dailyCount,
    maxDailyUsage: shared.MAX_DAILY_USAGE,
    durableStorage: !!shared.ENABLE_DURABLE_STORAGE,
    dossierTable: shared.DOSSIER_TABLE_NAME || null,
    returnPolicy: !!shared.ENABLE_RETURN_POLICY,
    returnPolicyLogOnly: !!shared.RETURN_POLICY_LOG_ONLY,
    timeAwayDisableMinGuards: !!shared.TIME_AWAY_DISABLE_MIN_GUARDS,
    timeAwayBriefMs: shared.TIME_AWAY_BRIEF_MS,
    timeAwayModerateMs: shared.TIME_AWAY_MODERATE_MS,
    timeAwayLongMs: shared.TIME_AWAY_LONG_MS,
  });
});

app.get("/api/chat-state", async (req, res) => {
  const sessionId = getOrCreateSessionId(req, res);
  try {
    const snapshot = await shared.getChatStateForSession(sessionId);
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({
      messages: [],
      envelope: null,
      userProgress: {},
      error: err && err.message,
    });
  }
});

/** Dev only: seed chat orchestration state (`ALLOW_TEST_SEED=1`). See `/dev/chat-scenario.html`. */
app.post("/api/dev/chat-scenario", (req, res) => {
  if (!apiConfig.ALLOW_TEST_SEED) {
    return res.status(404).end();
  }
  const sessionId = getOrCreateSessionId(req, res);
  const raw = req.body && typeof req.body === "object" ? req.body : {};
  const preset = raw.preset && typeof raw.preset === "object" ? raw.preset : raw;
  const allowedBins = new Set(["brief", "moderate", "long", "stale"]);
  const allowedAgents = new Set(["attache", "detective"]);
  if (preset.timeAwayBin != null && !allowedBins.has(String(preset.timeAwayBin))) {
    return res.status(400).json({ error: "Invalid timeAwayBin." });
  }
  if (preset.activeAgent != null && !allowedAgents.has(String(preset.activeAgent))) {
    return res.status(400).json({ error: "Invalid activeAgent." });
  }
  if (
    preset.baselineCompleted != null &&
    typeof preset.baselineCompleted !== "boolean"
  ) {
    return res.status(400).json({ error: "baselineCompleted must be a boolean when set." });
  }
  if (
    preset.msSinceLastVisit != null &&
    (typeof preset.msSinceLastVisit !== "number" || !Number.isFinite(preset.msSinceLastVisit))
  ) {
    return res.status(400).json({ error: "Invalid msSinceLastVisit." });
  }
  const allowedAttachePhases = new Set([
    "start",
    "explore",
    "baseline1",
    "baseline2",
    "baseline3",
    "close",
    "close_final",
  ]);
  if (
    preset.attachePhase != null &&
    String(preset.attachePhase).trim() !== "" &&
    !allowedAttachePhases.has(String(preset.attachePhase).trim())
  ) {
    return res.status(400).json({ error: "Invalid attachePhase." });
  }
  const attInv = validateAttachePresetOverrides(preset);
  if (attInv) {
    return res.status(400).json({ error: attInv.error });
  }
  try {
    const { envelope, tier } = seedSessionScenario(sessionId, preset);
    const orchestration = buildOrchestrationLabSnapshot(sessionId);
    return res.json({
      ok: true,
      envelope,
      timeAwayTier: tier,
      orchestration,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? String(err.message) : "seed failed",
    });
  }
});

/** Dev only: dropdown option lists for scenario lab (`chatScenarioLabPhases.js` + `narrativePhases.js`). */
app.get("/api/dev/chat-scenario-lab-options", (req, res) => {
  if (!apiConfig.ALLOW_TEST_SEED) {
    return res.status(404).end();
  }
  return res.json({
    existentialTherapyPhaseOptions: EXISTENTIAL_THERAPY_PHASE_OPTIONS,
    narrativePhaseOptions: NARRATIVE_PHASE_OPTIONS,
  });
});

/** Dev only: preview composed system prompt for current form values (no mutation). */
app.post("/api/dev/chat-scenario-preview", (req, res) => {
  if (!apiConfig.ALLOW_TEST_SEED) {
    return res.status(404).end();
  }
  const sessionId = getOrCreateSessionId(req, res);
  const raw = req.body && typeof req.body === "object" ? req.body : {};
  const preset = raw.preset && typeof raw.preset === "object" ? raw.preset : raw;
  const allowedBins = new Set(["brief", "moderate", "long", "stale"]);
  const allowedAgents = new Set(["attache", "detective"]);
  if (preset.timeAwayBin != null && !allowedBins.has(String(preset.timeAwayBin))) {
    return res.status(400).json({ error: "Invalid timeAwayBin." });
  }
  if (preset.activeAgent != null && !allowedAgents.has(String(preset.activeAgent))) {
    return res.status(400).json({ error: "Invalid activeAgent." });
  }
  if (
    preset.baselineCompleted != null &&
    typeof preset.baselineCompleted !== "boolean"
  ) {
    return res.status(400).json({ error: "baselineCompleted must be a boolean when set." });
  }
  const allowedAttachePhases = new Set([
    "start",
    "explore",
    "baseline1",
    "baseline2",
    "baseline3",
    "close",
    "close_final",
  ]);
  if (
    preset.attachePhase != null &&
    String(preset.attachePhase).trim() !== "" &&
    !allowedAttachePhases.has(String(preset.attachePhase).trim())
  ) {
    return res.status(400).json({ error: "Invalid attachePhase." });
  }
  const attInvPrev = validateAttachePresetOverrides(preset);
  if (attInvPrev) {
    return res.status(400).json({ error: attInvPrev.error });
  }
  try {
    const preview = buildPromptPreviewFromPreset(preset);
    const orchestration = buildOrchestrationLabSnapshot(sessionId);
    const derivedRouting = previewChatMachineRouting(sessionId, preset);
    return res.json({ ok: true, preview, orchestration, derivedRouting });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? String(err.message) : "preview failed",
    });
  }
});

/** Dev only: set last activity so the next POST /api/chat sees a synthetic time-away gap (ms). */
app.post("/api/dev/chat-scenario-mock-return", (req, res) => {
  if (!apiConfig.ALLOW_TEST_SEED) {
    return res.status(404).end();
  }
  const sessionId = getOrCreateSessionId(req, res);
  const raw = req.body && typeof req.body === "object" ? req.body : {};
  const ms = raw.msSinceLastVisit;
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return res.status(400).json({ error: "msSinceLastVisit required (number)." });
  }
  const gap = Math.max(0, ms);
  shared.setMockLastActivityGapForSession(sessionId, gap);
  return res.json({ ok: true, msSinceLastVisit: gap });
});

/** Dev only: synthetic XState-style step (detective policy, phase advance, philosopher narrative). */
app.post("/api/dev/orchestration-step", (req, res) => {
  if (!apiConfig.ALLOW_TEST_SEED) {
    return res.status(404).end();
  }
  const sessionId = getOrCreateSessionId(req, res);
  const raw = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const orchestration = runOrchestrationLabStep(sessionId, {
      type: raw.type,
      payload: raw.payload,
    });
    return res.json({ ok: true, orchestration });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err && err.message ? String(err.message) : "step failed",
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const sessionId = getOrCreateSessionId(req, res);
  const message = req.body?.message;
  if (typeof message !== "string") {
    return res.status(400).json({ error: "Missing or invalid message." });
  }
  const trimmed = message.trim();

  const result = await shared.handleChatRequest(sessionId, trimmed, {
    openaiClient: client,
    dailyUsageStore,
    debug: shared.DEBUG_LOGS,
  });
  const status = result.status;
  const body = result.body;
  if (status === 204) {
    return res.status(204).end();
  }
  return res.status(status).json(body);
});

// Streaming variant for local development only. Returns NDJSON events:
// { type: "delta", agent: "detective", text }
// { type: "final", status, body }
app.post("/api/chat-stream", async (req, res) => {
  const sessionId = getOrCreateSessionId(req, res);
  const message = req.body?.message;
  if (typeof message !== "string") {
    res.status(400);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.write(
      JSON.stringify({
        type: "final",
        status: 400,
        body: { error: "Missing or invalid message.", errorKind: "bad_request" },
      }) + "\n"
    );
    return res.end();
  }
  const trimmed = message.trim();

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const onEvent = async (evt) => {
    try {
      res.write(JSON.stringify(evt) + "\n");
    } catch (err) {
      console.warn("/api/chat-stream write error:", err && err.message);
    }
  };

  try {
    await shared.handleChatStream(sessionId, trimmed, {
      openaiClient: client,
      dailyUsageStore,
      debug: shared.DEBUG_LOGS,
    }, onEvent);
  } catch (err) {
    console.error("/api/chat-stream handler error:", err && err.message);
    try {
      res.write(
        JSON.stringify({
          type: "final",
          status: 500,
          body: { error: "Server error.", errorKind: "server_error" },
        }) + "\n"
      );
    } catch (_) {}
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Chat server running at http://localhost:${PORT}`);
  console.log(`Prompts dir: ${shared.PROMPTS_DIR}`);
  if (shared.OFFLINE) {
    console.log("OFFLINE=1: AI backend disabled, returning generic replies.");
  } else {
    console.log(`Model: ${shared.MODEL}`);
    console.log(`OpenAI request timeout: ${apiConfig.OPENAI_TIMEOUT_MS}ms (set OPENAI_TIMEOUT_MS in .env)`);
    if (shared.SERVICE_TIER)
      console.log(`Service tier: ${shared.SERVICE_TIER}`);
  }
  if (shared.DEBUG_LOGS) {
    console.log(
      "[DEBUG] Service tier:",
      shared.SERVICE_TIER || "(default)"
    );
    const dailyUsageFile = path.join(DATA_DIR, "daily_usage.json");
    try {
      if (fs.existsSync(dailyUsageFile)) {
        const raw = fs.readFileSync(dailyUsageFile, "utf8");
        console.log("[DEBUG] Daily usage file:", raw);
      } else {
        console.log("[DEBUG] Daily usage file: (none)");
      }
    } catch (err) {
      console.log("[DEBUG] Daily usage file: (read error)", err.message);
    }
  }
});
