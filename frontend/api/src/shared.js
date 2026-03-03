"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const API_DIR = path.join(__dirname, "..");
const PROMPTS_DIR = path.join(API_DIR, "prompts");
const PROMPT_FILE = path.join(PROMPTS_DIR, "prompt.md");
const CLOSERS_FILE = path.join(PROMPTS_DIR, "closers.md");
const EASTER_EGG_PROMPT_FILE = path.join(PROMPTS_DIR, "easter_egg_prompt.md");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const SERVICE_TIER = process.env.OPENAI_SERVICE_TIER || null;
const MAX_USER_EXCHANGES = parseInt(process.env.MAX_USER_EXCHANGES, 10) || 5;
const MAX_DAILY_USAGE = parseInt(process.env.MAX_DAILY_USAGE, 10) || 100;
const DEBUG = /^(1|true|yes)$/i.test(process.env.DEBUG || "");

const userExchangeCounts = new Map();
const sessionHistories = new Map();
let dailyUsageCount = 0;
let dailyUsageDate = null;

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function readDailyUsage() {
  const today = getToday();
  if (dailyUsageDate === today) return dailyUsageCount;
  dailyUsageDate = today;
  dailyUsageCount = 0;
  return 0;
}

function writeDailyUsage(count) {
  dailyUsageDate = getToday();
  dailyUsageCount = count;
}

function loadEasterEggPrompt() {
  try {
    if (fs.existsSync(EASTER_EGG_PROMPT_FILE)) {
      return fs.readFileSync(EASTER_EGG_PROMPT_FILE, "utf8").trim();
    }
  } catch (err) {
    console.warn("Could not load easter egg prompt", err.message);
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

function loadAgentPrompt() {
  try {
    if (fs.existsSync(PROMPT_FILE)) {
      return fs.readFileSync(PROMPT_FILE, "utf8").trim();
    }
  } catch (err) {
    console.warn("Could not load agent prompt", err.message);
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
    console.warn("Could not load closers", err.message);
  }
  return [
    "I find this line of questioning overwhelming.",
    "Ahh I think our time is up.",
  ];
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach((part) => {
    const [key, ...v] = part.trim().split("=");
    if (key) out[key.trim()] = decodeURIComponent((v.join("=") || "").trim());
  });
  return out;
}

function getOrCreateSessionId(request) {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookieHeader(cookieHeader);
  let sessionId = cookies.sessionId;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  return sessionId;
}

function sessionCookieHeader(sessionId) {
  const value = encodeURIComponent(sessionId);
  return `sessionId=${value}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`;
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

module.exports = {
  MODEL,
  SERVICE_TIER,
  MAX_USER_EXCHANGES,
  MAX_DAILY_USAGE,
  DEBUG,
  userExchangeCounts,
  sessionHistories,
  readDailyUsage,
  writeDailyUsage,
  loadEasterEggPrompt,
  getOrCreateSessionHistory,
  loadAgentPrompt,
  getPromptFirstLines,
  loadClosers,
  parseCookieHeader,
  getOrCreateSessionId,
  sessionCookieHeader,
  extractOutputText,
};
