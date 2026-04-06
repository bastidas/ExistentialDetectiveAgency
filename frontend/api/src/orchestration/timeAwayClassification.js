"use strict";

const MS_PER_HOUR = 60 * 60 * 1000;

/** @type {boolean} */
let loggedThresholdWarning = false;

/**
 * Resolves ms from explicit TIME_AWAY_*_MS or hours env (see frontend/.env).
 * @param {string} hoursEnv
 * @param {string} msEnv
 * @param {number} defaultHours
 */
function resolveMs(hoursEnv, msEnv, defaultHours) {
  const fromMs = Number(process.env[msEnv] || 0);
  if (Number.isFinite(fromMs) && fromMs > 0) {
    return fromMs;
  }
  const raw = process.env[hoursEnv];
  const h = raw === undefined || raw === "" ? defaultHours : Number(raw);
  if (!Number.isFinite(h) || h < 0) {
    return defaultHours * MS_PER_HOUR;
  }
  return h * MS_PER_HOUR;
}

/**
 * Enforce briefMs < moderateMs < longMs. If invalid, nudge upward and log once.
 * @param {number} briefMs
 * @param {number} moderateMs
 * @param {number} longMs
 * @returns {{ briefMs: number, moderateMs: number, longMs: number }}
 */
function normalizeOrderedThresholds(briefMs, moderateMs, longMs) {
  let b = briefMs;
  let m = moderateMs;
  let l = longMs;
  const minGap = 1;
  let ok = b > 0 && m > 0 && l > 0 && b < m && m < l;
  if (!ok) {
    if (!loggedThresholdWarning) {
      loggedThresholdWarning = true;
      console.warn(
        "[timeAwayClassification] TIME_AWAY_* thresholds must satisfy brief < moderate < long (ms). " +
          `Got briefMs=${briefMs}, moderateMs=${moderateMs}, longMs=${longMs}. Normalizing.`
      );
    }
    const defB = 0.25 * MS_PER_HOUR;
    const defM = 32 * MS_PER_HOUR;
    const defL = 64 * MS_PER_HOUR;
    b = Number.isFinite(b) && b > 0 ? b : defB;
    m = Number.isFinite(m) && m > 0 ? m : defM;
    l = Number.isFinite(l) && l > 0 ? l : defL;
    if (b >= m) m = b + minGap;
    if (m >= l) l = m + minGap;
  }
  return { briefMs: b, moderateMs: m, longMs: l };
}

/**
 * Thresholds from `frontend/.env` (`TIME_AWAY_BRIEF_*`, `TIME_AWAY_MODERATE_*`, `TIME_AWAY_LONG_*`).
 * Deprecated: `TIME_AWAY_STALE_*` — ignored; use `TIME_AWAY_MODERATE_*` for the moderate upper bound.
 *
 * @returns {{ briefMs: number, moderateMs: number, longMs: number }}
 */
function getTimeAwayThresholds() {
  const rawBrief = resolveMs("TIME_AWAY_BRIEF_HOURS", "TIME_AWAY_BRIEF_MS", 0.25);
  const rawModerate = resolveMs("TIME_AWAY_MODERATE_HOURS", "TIME_AWAY_MODERATE_MS", 32);
  const rawLong = resolveMs("TIME_AWAY_LONG_HOURS", "TIME_AWAY_LONG_MS", 64);
  return normalizeOrderedThresholds(rawBrief, rawModerate, rawLong);
}

/**
 * @typedef {"brief"|"moderate"|"long"|"stale"} TimeAwayBin
 */

/**
 * @param {number} msSinceLastVisit — non-negative ms since last user activity (or 0 = same visit)
 * @returns {{ bin: TimeAwayBin, description: string, msSinceLastVisit: number }}
 */
function classifyTimeAway(msSinceLastVisit) {
  const ms = Math.max(0, Number(msSinceLastVisit) || 0);
  const { briefMs, moderateMs, longMs } = getTimeAwayThresholds();

  if (ms < briefMs) {
    return {
      bin: "brief",
      description: "same visit / just stepped away (under brief threshold)",
      msSinceLastVisit: ms,
    };
  }
  if (ms < moderateMs) {
    return {
      bin: "moderate",
      description: "away beyond brief, below moderate threshold",
      msSinceLastVisit: ms,
    };
  }
  if (ms < longMs) {
    return {
      bin: "long",
      description: "long absence window (between moderate and long thresholds)",
      msSinceLastVisit: ms,
    };
  }
  return {
    bin: "stale",
    description: "stale absence (at or past long threshold — longest time-away bin)",
    msSinceLastVisit: ms,
  };
}

module.exports = {
  getTimeAwayThresholds,
  classifyTimeAway,
  normalizeOrderedThresholds,
  MS_PER_HOUR,
};
