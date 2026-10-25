"use strict";

/**
 * Spend and abuse limits for the chat API. Every value is an app setting with a safe default, so a
 * deployment that forgets to configure them is still bounded.
 *
 * - MAX_USER_EXCHANGES: user turns per session before the closure sequence and then HTTP 204.
 * - MAX_DAILY_USAGE: LLM-backed user turns per UTC day across all visitors (a budget kill switch).
 * - MAX_MESSAGE_CHARS: longest accepted user message.
 * - MAX_REQUESTS_PER_MINUTE: chat requests per client (IP) per minute; 0 disables.
 */

const DEFAULT_MAX_USER_EXCHANGES = 40;
const DEFAULT_MAX_DAILY_USAGE = 300;
const DEFAULT_MAX_MESSAGE_CHARS = 2000;
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 30;

const DAILY_LIMIT_MESSAGE =
  "The Agency has closed its doors for today. Please come back tomorrow.";
const RATE_LIMIT_MESSAGE = "Too many requests. Please slow down and try again in a minute.";

/**
 * @param {unknown} raw
 * @param {number} fallback
 * @param {{ allowZero?: boolean }} [opts]
 * @returns {number}
 */
function parseLimit(raw, fallback, opts = {}) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  if (v > 0) return v;
  return v === 0 && opts.allowZero ? 0 : fallback;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveLimits(env = process.env) {
  return {
    maxUserExchanges: parseLimit(env.MAX_USER_EXCHANGES, DEFAULT_MAX_USER_EXCHANGES),
    maxDailyUsage: parseLimit(env.MAX_DAILY_USAGE, DEFAULT_MAX_DAILY_USAGE),
    maxMessageChars: parseLimit(env.MAX_MESSAGE_CHARS, DEFAULT_MAX_MESSAGE_CHARS),
    maxRequestsPerMinute: parseLimit(env.MAX_REQUESTS_PER_MINUTE, DEFAULT_MAX_REQUESTS_PER_MINUTE, {
      allowZero: true,
    }),
  };
}

module.exports = {
  DEFAULT_MAX_USER_EXCHANGES,
  DEFAULT_MAX_DAILY_USAGE,
  DEFAULT_MAX_MESSAGE_CHARS,
  DEFAULT_MAX_REQUESTS_PER_MINUTE,
  DAILY_LIMIT_MESSAGE,
  RATE_LIMIT_MESSAGE,
  parseLimit,
  resolveLimits,
};
