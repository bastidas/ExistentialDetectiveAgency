"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Spend guards for the public site.
 *
 * - `MAX_USER_EXCHANGES`: attaché + detective turns per session before the closure sequence
 *   (penultimate reply, ultimate reply, then HTTP 204).
 * - `MAX_DAILY_USAGE`: chat turns that may reach the LLM per UTC day, across all sessions on
 *   this instance. One turn can fan out to several LLM calls (detective + Lumen + Umbra, plus
 *   periodic dossier/summary calls), so size this against cost per turn, not per API call.
 */
const DEFAULT_MAX_USER_EXCHANGES = 40;
const DEFAULT_MAX_DAILY_USAGE = 300;

const DAILY_LIMIT_MESSAGE = "Daily system limit reached. Try again tomorrow.";

/**
 * @param {string|number|undefined|null} raw
 * @param {number} fallback
 * @returns {number} positive integer
 */
function parsePositiveInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function resolveMaxUserExchanges(env = process.env) {
  return parsePositiveInt(env.MAX_USER_EXCHANGES, DEFAULT_MAX_USER_EXCHANGES);
}

function resolveMaxDailyUsage(env = process.env) {
  return parsePositiveInt(env.MAX_DAILY_USAGE, DEFAULT_MAX_DAILY_USAGE);
}

function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Daily counter persisted to `<dataDir>/daily_usage.json` as `{ date, count }`.
 * A stored date other than today (UTC) reads as 0, so the count resets at midnight.
 *
 * @param {string} dataDir
 * @param {{ now?: () => number }} [opts]
 */
function createFileDailyUsageStore(dataDir, opts = {}) {
  const now = opts.now || Date.now;
  const filePath = path.join(dataDir, "daily_usage.json");
  return {
    readDailyUsage() {
      try {
        const j = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (j && j.date === utcDay(now()) && typeof j.count === "number") return j.count;
      } catch (_) {
        /* missing or unreadable file counts as zero */
      }
      return 0;
    },
    incrementDailyUsage() {
      const n = this.readDailyUsage() + 1;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ date: utcDay(now()), count: n }));
      return n;
    },
  };
}

/**
 * In-process daily counter (per Functions instance), resetting at midnight UTC.
 *
 * @param {{ now?: () => number }} [opts]
 */
function createMemoryDailyUsageStore(opts = {}) {
  const now = opts.now || Date.now;
  let day = null;
  let count = 0;
  function roll() {
    const today = utcDay(now());
    if (day !== today) {
      day = today;
      count = 0;
    }
  }
  return {
    readDailyUsage() {
      roll();
      return count;
    },
    incrementDailyUsage() {
      roll();
      count += 1;
      return count;
    },
  };
}

/**
 * Reserve one LLM-capable turn against the daily cap.
 * Increments before the turn runs so concurrent requests cannot overshoot the cap.
 *
 * @param {{ readDailyUsage: () => number, incrementDailyUsage: () => number }|null|undefined} store
 * @param {number} maxDailyUsage
 * @returns {{ allowed: boolean, dailyUsage: number }}
 */
function reserveDailyTurn(store, maxDailyUsage) {
  if (!store || typeof store.readDailyUsage !== "function") {
    return { allowed: true, dailyUsage: 0 };
  }
  const used = store.readDailyUsage();
  if (used >= maxDailyUsage) return { allowed: false, dailyUsage: used };
  if (typeof store.incrementDailyUsage === "function") {
    return { allowed: true, dailyUsage: store.incrementDailyUsage() };
  }
  return { allowed: true, dailyUsage: used };
}

module.exports = {
  DEFAULT_MAX_USER_EXCHANGES,
  DEFAULT_MAX_DAILY_USAGE,
  DAILY_LIMIT_MESSAGE,
  parsePositiveInt,
  resolveMaxUserExchanges,
  resolveMaxDailyUsage,
  createFileDailyUsageStore,
  createMemoryDailyUsageStore,
  reserveDailyTurn,
};
