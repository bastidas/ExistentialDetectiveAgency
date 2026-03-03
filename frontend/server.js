"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const OpenAI = require("openai");

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const SERVICE_TIER = process.env.OPENAI_SERVICE_TIER || null; // "flex" = ~50% cheaper, slower
const MAX_USER_EXCHANGES = parseInt(process.env.MAX_USER_EXCHANGES, 10) || 5;
const MAX_DAILY_USAGE = parseInt(process.env.MAX_DAILY_USAGE, 10) || 100;
const DATA_DIR = path.join(__dirname, "data");
const DAILY_USAGE_FILE = path.join(DATA_DIR, "daily_usage.json");
const PROMPTS_DIR = path.join(__dirname, "api", "prompts");
const PROMPT_FILE =
  process.env.AGENT_PROMPT_FILE ||
  path.join(PROMPTS_DIR, "prompt.md");
const CLOSERS_FILE =
  process.env.CLOSERS_FILE ||
  path.join(PROMPTS_DIR, "closers.md");
const EASTER_EGG_PROMPT_FILE =
  process.env.EASTER_EGG_PROMPT_FILE ||
  path.join(PROMPTS_DIR, "easter_egg_prompt.md");
const DEBUG = /^(1|true|yes)$/i.test(process.env.DEBUG || "");

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Missing OPENAI_API_KEY. Set it in .env or the environment.");
  process.exit(1);
}

const client = new OpenAI({ apiKey });

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const userExchangeCounts = new Map();
const sessionHistories = new Map();

function loadEasterEggPrompt() {
  try {
    if (fs.existsSync(EASTER_EGG_PROMPT_FILE)) {
      return fs.readFileSync(EASTER_EGG_PROMPT_FILE, "utf8").trim();
    }
  } catch (err) {
    console.warn("Could not load easter egg prompt from", EASTER_EGG_PROMPT_FILE, err.message);
  }
  return null;
}

function getOrCreateSessionHistory(sessionId) {
  let h = sessionHistories.get(sessionId);
  if (!h) {
    h = {
      messages: [],
      usedCloserIndexes: new Set(),
      closerCount: 0,
      noReplyTarget: null,
      noReplyCount: 0,
      bonusResponseGiven: false,
    };
    sessionHistories.set(sessionId, h);
  }
  return h;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function readDailyUsage() {
  try {
    if (fs.existsSync(DAILY_USAGE_FILE)) {
      const data = JSON.parse(fs.readFileSync(DAILY_USAGE_FILE, "utf8"));
      if (data.date === getToday()) return data.count;
    }
  } catch (_) {}
  return 0;
}

function writeDailyUsage(count) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      DAILY_USAGE_FILE,
      JSON.stringify({ date: getToday(), count }, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Failed to write daily usage:", err.message);
  }
}

function loadAgentPrompt() {
  try {
    if (fs.existsSync(PROMPT_FILE)) {
      return fs.readFileSync(PROMPT_FILE, "utf8").trim();
    }
  } catch (err) {
    console.warn("Could not load agent prompt from", PROMPT_FILE, err.message);
  }
  return null;
}

function getPromptFirstLines(maxLines = 5) {
  try {
    if (fs.existsSync(PROMPT_FILE)) {
      const text = fs.readFileSync(PROMPT_FILE, "utf8");
      return text.split(/\r?\n/).slice(0, maxLines);
    }
  } catch (_) {}
  return [];
}

function loadClosers() {
  try {
    if (fs.existsSync(CLOSERS_FILE)) {
      const text = fs.readFileSync(CLOSERS_FILE, "utf8");
      return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
  } catch (err) {
    console.warn("Could not load closers from", CLOSERS_FILE, err.message);
  }
  return [
    "I find this line of questioning overwhelming.",
    "Ahh I think our time is up.",
  ];
}

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

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  if (!response.output || !Array.isArray(response.output)) return "";
  for (const item of response.output) {
    if (item.content && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" && c.text) return c.text;
      }
    }
  }
  return "";
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/debug", (req, res) => {
  if (!DEBUG) return res.status(404).end();
  const sessionId = getOrCreateSessionId(req, res);
  const userExchangeCount = userExchangeCounts.get(sessionId) ?? 0;
  const dailyCount = readDailyUsage();
  res.json({
    model: MODEL,
    serviceTier: SERVICE_TIER || "(default)",
    promptPreview: getPromptFirstLines(5),
    userExchangeCount,
    maxUserExchanges: MAX_USER_EXCHANGES,
    dailyCount,
    maxDailyUsage: MAX_DAILY_USAGE,
  });
});

app.post("/api/chat", async (req, res) => {
  const sessionId = getOrCreateSessionId(req, res);
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing or invalid message." });
  }
  const trimmed = message.trim();

  const userCount = userExchangeCounts.get(sessionId) ?? 0;
  const history = getOrCreateSessionHistory(sessionId);
  let dailyCount = readDailyUsage();
  if (DEBUG) {
    console.log("[DEBUG] user exchanges:", userCount + "/" + MAX_USER_EXCHANGES);
    console.log("[DEBUG] daily usage:", dailyCount + "/" + MAX_DAILY_USAGE);
  }
  if (userCount >= MAX_USER_EXCHANGES) {
    // 1) Send a random closer at most twice.
    if (history.closerCount < 2) {
      history.messages.push({ role: "user", content: trimmed });
      const closers = loadClosers();
      const available = closers.length
        ? closers.map((_, i) => i).filter((i) => !history.usedCloserIndexes.has(i))
        : [];
      const index = available.length
        ? available[Math.floor(Math.random() * available.length)]
        : Math.floor(Math.random() * closers.length);
      const closer = closers[index] ?? "I think our time is up.";
      history.messages.push({ role: "assistant", content: closer, isCloser: true });
      history.usedCloserIndexes.add(index);
      history.closerCount += 1;
      if (DEBUG) console.log("[DEBUG] user limit reached: replying with closer, stored user message and closer in history");
      const body = { reply: closer };
      if (DEBUG) body.debug = { userExchanges: userCount, maxUserExchanges: MAX_USER_EXCHANGES, dailyUsage: dailyCount, maxDailyUsage: MAX_DAILY_USAGE };
      return res.json(body);
    }
    // 2) No reply for 3–5 times (random per session), then 3) one bonus full OpenAI response, then 4) no reply forever.
    if (history.noReplyTarget === null) {
      history.noReplyTarget = 3 + Math.floor(Math.random() * 3);
      if (DEBUG) console.log("[DEBUG] noReplyTarget set to", history.noReplyTarget);
    }
    if (history.bonusResponseGiven) {
      history.messages.push({ role: "user", content: trimmed });
      if (DEBUG) console.log("[DEBUG] no response (bonus already given), stored user message in history");
      return res.status(204).end();
    }
    if (history.noReplyCount < history.noReplyTarget) {
      history.messages.push({ role: "user", content: trimmed });
      history.noReplyCount += 1;
      if (DEBUG) console.log("[DEBUG] no response", history.noReplyCount + "/" + history.noReplyTarget, ", stored user message in history");
      return res.status(204).end();
    }
    // 3) One bonus response: use easter egg prompt only, include only real Q&A (no closers), then 4) never again.
    history.messages.push({ role: "user", content: trimmed });
    if (dailyCount >= MAX_DAILY_USAGE) {
      return res.status(429).json({
        error: "Daily system limit reached. Try again tomorrow.",
      });
    }
    const easterEggPrompt = loadEasterEggPrompt();
    if (!easterEggPrompt) {
      console.warn("[DEBUG] No easter egg prompt found, using fallback");
    }
    const realMessages = history.messages.filter(
      (m) => m.role !== "assistant" || !m.isCloser
    );
    const bonusInput = [
      { type: "message", role: "developer", content: easterEggPrompt || "Answer all the user's questions from the conversation below. Then close the conversation." },
      ...realMessages.map((m) => ({
        type: "message",
        role: m.role,
        content: m.content,
      })),
    ];
    if (DEBUG) {
      console.log("[DEBUG] Easter egg: using easter_egg_prompt, history has", realMessages.length, "messages (real Q&A only, no closers)");
      console.log("[DEBUG] Sending to OpenAI (bonus turn):");
      console.log(JSON.stringify(bonusInput, null, 2));
    }
    const createParams = {
      model: MODEL,
      input: bonusInput,
      ...(SERVICE_TIER === "flex" && { service_tier: "flex" }),
    };
    const requestOptions = SERVICE_TIER === "flex"
      ? { timeout: 15 * 60 * 1000 }
      : undefined;
    try {
      const response = await client.responses.create(createParams, requestOptions);
      const reply = extractOutputText(response);
      const replyText = reply || "(No text in response.)";
      history.messages.push({ role: "assistant", content: replyText });
      history.bonusResponseGiven = true;
      dailyCount += 1;
      writeDailyUsage(dailyCount);
      if (DEBUG) console.log("[DEBUG] Easter egg bonus response sent, will not reply again for this session");
      const body = { reply: replyText };
      if (DEBUG) body.debug = { userExchanges: userCount, maxUserExchanges: MAX_USER_EXCHANGES, dailyUsage: dailyCount, maxDailyUsage: MAX_DAILY_USAGE };
      return res.json(body);
    } catch (err) {
      const status = err.status ?? 500;
      const apiCode = err.code || null;
      const errMessage = err.message || "Something went wrong talking to the model.";
      console.error("OpenAI error (bonus):", status, apiCode, errMessage);
      return res.status(status).json({
        error: errMessage,
        errorKind: status >= 500 ? "server_error" : "bad_request",
        code: apiCode,
      });
    }
  }

  if (dailyCount >= MAX_DAILY_USAGE) {
    return res.status(429).json({
      error: "Daily system limit reached. Try again tomorrow.",
    });
  }

  const agentPrompt = loadAgentPrompt();
  const input = agentPrompt
    ? [
        { type: "message", role: "developer", content: agentPrompt },
        ...history.messages.map((m) => ({
          type: "message",
          role: m.role,
          content: m.content,
        })),
        { type: "message", role: "user", content: trimmed },
      ]
    : trimmed;

  if (DEBUG) {
    console.log("[DEBUG] Sending to OpenAI:");
    console.log(JSON.stringify(input, null, 2));
  }

  const createParams = {
    model: MODEL,
    input,
    ...(SERVICE_TIER === "flex" && { service_tier: "flex" }),
  };
  const requestOptions = SERVICE_TIER === "flex"
    ? { timeout: 15 * 60 * 1000 }
    : undefined;

  try {
    const response = await client.responses.create(createParams, requestOptions);
    const reply = extractOutputText(response);
    const replyText = reply || "(No text in response.)";
    history.messages.push({ role: "user", content: trimmed });
    history.messages.push({ role: "assistant", content: replyText });
    userExchangeCounts.set(sessionId, userCount + 1);
    dailyCount += 1;
    writeDailyUsage(dailyCount);
    const body = { reply: replyText };
    if (DEBUG) body.debug = { userExchanges: userCount + 1, maxUserExchanges: MAX_USER_EXCHANGES, dailyUsage: dailyCount, maxDailyUsage: MAX_DAILY_USAGE };
    return res.json(body);
  } catch (err) {
    const status = err.status ?? 500;
    const apiCode = err.code || null;
    const message = err.message || "Something went wrong talking to the model.";
    console.error("OpenAI error:", status, apiCode, message);
    if (status === 400 && err.error) {
      console.error("OpenAI 400 body:", JSON.stringify(err.error, null, 2));
    }

    let errorKind = "server_error";
    if (status === 400 || status === 422) {
      errorKind = "bad_request";
    } else if (status === 429) {
      errorKind = apiCode === "resource_unavailable" ? "flex_busy" : "rate_limit";
    } else if (status >= 500 || !status) {
      errorKind = "server_error";
    }

    return res.status(status).json({
      error: message,
      errorKind,
      code: apiCode,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Chat server running at http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
  if (SERVICE_TIER) console.log(`Service tier: ${SERVICE_TIER}`);
  if (DEBUG) {
    console.log("[DEBUG] Service tier:", SERVICE_TIER || "(default)");
    const lines = getPromptFirstLines(5);
    console.log("[DEBUG] Prompt file first 5 lines:");
    lines.forEach((line, i) => console.log(`  ${i + 1}: ${line}`));
    try {
      if (fs.existsSync(DAILY_USAGE_FILE)) {
        const raw = fs.readFileSync(DAILY_USAGE_FILE, "utf8");
        console.log("[DEBUG] Daily usage file:", raw);
      } else {
        console.log("[DEBUG] Daily usage file: (none)");
      }
    } catch (err) {
      console.log("[DEBUG] Daily usage file: (read error)", err.message);
    }
  }
});
