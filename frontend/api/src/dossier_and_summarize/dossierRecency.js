"use strict";

const { getTimeAwayThresholds } = require("../orchestration/timeAwayClassification");

/**
 * Baseline/dossier age vs `TIME_AWAY_LONG` boundary (same ms as visit "stale" bin).
 * In normal use this aligns with time away, but routing uses explicit age from `lastBaselineCompletedAt`.
 *
 * @param {object|null|undefined} dossier
 * @param {number} [now] — epoch ms
 * @returns {boolean}
 */
function isDossierStaleByAge(dossier, now) {
  if (dossier == null || typeof dossier !== "object") {
    return false;
  }
  const meta = dossier.meta;
  if (!meta || typeof meta !== "object" || meta.lastBaselineCompletedAt == null) {
    return false;
  }
  const t = meta.lastBaselineCompletedAt;
  const completedAt = typeof t === "number" ? t : Number(t);
  if (!Number.isFinite(completedAt)) {
    return false;
  }
  const n = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  const { longMs } = getTimeAwayThresholds();
  return n - completedAt > longMs;
}

/**
 * Whether the dossier’s first creation (`meta.createdAt`) is older than the long/stale boundary (`longMs`).
 * Used to gate advancing existential therapy to the **final** phase (same threshold as visit “stale or longer”).
 *
 * @param {object|null|undefined} dossier
 * @param {number} [now] — epoch ms
 * @returns {boolean}
 */
function isDossierCreatedAtStaleEnoughForFinal(dossier, now) {
  if (dossier == null || typeof dossier !== "object") {
    return false;
  }
  const meta = dossier.meta;
  if (!meta || typeof meta !== "object" || meta.createdAt == null) {
    return false;
  }
  const t = meta.createdAt;
  const createdAt = typeof t === "number" ? t : Number(t);
  if (!Number.isFinite(createdAt)) {
    return false;
  }
  const n = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  const { longMs } = getTimeAwayThresholds();
  return n - createdAt > longMs;
}

module.exports = {
  isDossierStaleByAge,
  isDossierCreatedAtStaleEnoughForFinal,
};
