"use strict";

/**
 * Sliding-window request limiter, in memory and per process. On a scaled-out deployment each
 * instance keeps its own window, so the effective limit is `max` per instance: this slows abuse, it
 * is not a global quota (the daily cap in `dailyUsageStore.js` is the budget backstop).
 *
 * @param {{ windowMs?: number, max: number, maxKeys?: number, now?: () => number }} opts
 */
function createRateLimiter(opts) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max;
  const maxKeys = opts.maxKeys ?? 10_000;
  const now = opts.now || Date.now;
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  return {
    /**
     * @param {string} key
     * @returns {{ allowed: boolean, retryAfterMs: number }}
     */
    check(key) {
      if (!max || max <= 0 || !key) return { allowed: true, retryAfterMs: 0 };
      const t = now();
      const cutoff = t - windowMs;
      const recent = (hits.get(key) || []).filter((x) => x > cutoff);
      if (recent.length >= max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: Math.max(1, recent[0] + windowMs - t) };
      }
      recent.push(t);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        hits.delete(oldest);
      }
      return { allowed: true, retryAfterMs: 0 };
    },
    size() {
      return hits.size;
    },
  };
}

/**
 * Best-effort client identity for rate limiting: the platform-provided client IP when present,
 * otherwise the first `x-forwarded-for` hop, otherwise the fallback (for example the socket address).
 *
 * @param {(name: string) => string|null|undefined} getHeader
 * @param {string} [fallback]
 * @returns {string}
 */
function clientKeyFromHeaders(getHeader, fallback = "") {
  for (const name of ["x-azure-clientip", "x-forwarded-for"]) {
    const raw = getHeader(name);
    if (raw) {
      const first = String(raw).split(",")[0].trim();
      const ip = first.replace(/^\[([^\]]+)\](?::\d+)?$/, "$1").replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1");
      if (ip) return ip;
    }
  }
  return fallback;
}

module.exports = { createRateLimiter, clientKeyFromHeaders };
