"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const OpenAI = require("openai");

const shared = require("./api/shared");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const dailyUsageStore = shared.createFileDailyUsageStore(DATA_DIR);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey && !shared.DEV_MODE) {
  console.error(
    "Missing OPENAI_API_KEY. Set it in .env or the environment (or use MODE=dev to skip the AI)."
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

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (req.method !== "GET") return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/debug", (req, res) => {
  if (!shared.DEBUG) return res.status(404).end();
  const sessionId = getOrCreateSessionId(req, res);
  const userExchangeCount = shared.userExchangeCounts.get(sessionId) ?? 0;
  const dailyCount = dailyUsageStore.readDailyUsage();
  const promptPreview = shared.getPromptFirstLines(5);
  res.json({
    devMode: shared.DEV_MODE,
    model: shared.MODEL,
    serviceTier: shared.SERVICE_TIER || "(default)",
    promptPreview,
    promptFilePath: shared.PROMPT_FILE,
    promptPreviewFound: promptPreview.length > 0,
    userExchangeCount,
    maxUserExchanges: shared.MAX_USER_EXCHANGES,
    dailyCount,
    maxDailyUsage: shared.MAX_DAILY_USAGE,
  });
});

app.get("/api/philosopher-notes", (req, res) => {
  const rules = shared.loadPhilAnnotations();
  console.log(
    "[phil-annotations] GET /api/philosopher-notes →",
    rules.length,
    "rules"
  );
  res.json({ rules });
});

app.post("/api/chat", async (req, res) => {
  const sessionId = getOrCreateSessionId(req, res);
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing or invalid message." });
  }
  const trimmed = message.trim();
  const raw = req.body?.contentWidthChars;
  const contentWidthChars =
    typeof raw === "number" && raw > 0 ? Math.round(raw) : undefined;

  const result = await shared.handleChatRequest(sessionId, trimmed, {
    openaiClient: client,
    dailyUsageStore,
    debug: shared.DEBUG,
    contentWidthChars,
  });
  const status = result.status;
  const body = result.body;
  if (status === 204) {
    return res.status(204).end();
  }
  return res.status(status).json(body);
});

app.post("/api/philosopher-dialog", async (req, res) => {
  const sessionId = getOrCreateSessionId(req, res);
  const result = await shared.handlePhilosopherDialogRequest(sessionId, req.body || {}, {
    openaiClient: client,
    debug: shared.DEBUG,
  });
  const status = result.status;
  const body = result.body;
  return res.status(status).json(body);
});

app.listen(PORT, () => {
  console.log(`Chat server running at http://localhost:${PORT}`);
  console.log(`Prompts dir: ${shared.PROMPTS_DIR}`);
  console.log(
    `  prompt.md: ${fs.existsSync(shared.PROMPT_FILE) ? "found" : "NOT FOUND"}`,
    `| closers.md: ${fs.existsSync(shared.CLOSERS_FILE) ? "found" : "NOT FOUND"}`,
    `| phil_annotations.json: ${fs.existsSync(shared.PHIL_ANNOTATIONS_FILE) ? "found" : "NOT FOUND"}`
  );
  if (shared.DEV_MODE) {
    console.log("MODE=dev: AI backend disabled, returning generic replies.");
  } else {
    console.log(`Model: ${shared.MODEL}`);
    if (shared.SERVICE_TIER)
      console.log(`Service tier: ${shared.SERVICE_TIER}`);
  }
  if (shared.DEBUG) {
    console.log(
      "[DEBUG] Service tier:",
      shared.SERVICE_TIER || "(default)"
    );
    const lines = shared.getPromptFirstLines(5);
    console.log("[DEBUG] Prompt file first 5 lines:");
    lines.forEach((line, i) => console.log(`  ${i + 1}: ${line}`));
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
