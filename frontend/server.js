"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const OpenAI = require("openai");

const shared = require("./api/src/shared");

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

const client = apiKey ? new OpenAI({ apiKey }) : null;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

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
    debugState: !!shared.DEBUG_STATE,
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
    debugState: !!shared.DEBUG_STATE,
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
    timeAwayLongMs: shared.TIME_AWAY_LONG_MS,
    timeAwayStaleMs: shared.TIME_AWAY_STALE_MS,
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
