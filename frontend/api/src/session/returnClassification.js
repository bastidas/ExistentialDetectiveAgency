"use strict";

const config = require("../config");

/**
 * @typedef {Object} ReturnClassificationInput
 * @property {string|null} [lastActivityAtIso] - Last persisted session activity (e.g. row updatedAt).
 * @property {Date} [now]
 * @property {number|null} [lastBaselineCompletedAtMs] - From dossier.meta.lastBaselineCompletedAt
 * @property {boolean} [baselineCompleted] - Session handed off to detective (attacheCompleted).
 * @property {boolean} [baselineDossierRecorded] - Dossier shows baseline answers.
 */

/**
 * @typedef {Object} ReturnClassification
 * @property {'JUST_STEPPED_AWAY'|'DAY_OR_SO'|'LONG_GONE'|'UNKNOWN'} returnCategory
 * @property {number|null} timeAwayMs
 * @property {boolean} needsBaselineRefresh
 * @property {string|null} baselineReason
 * @property {string|null} lastActivityAtIso
 */

/**
 * Classify how long the user has been away and whether baseline refresh is needed.
 * Conservative: UNKNOWN / missing activity → no forced refresh.
 *
 * @param {ReturnClassificationInput} input
 * @returns {ReturnClassification}
 */
function classifySessionReturn(input) {
  const now = input && input.now instanceof Date ? input.now : new Date();
  const lastActivityAtIso =
    input && input.lastActivityAtIso != null
      ? String(input.lastActivityAtIso).trim() || null
      : null;

  let lastActivityMs = null;
  if (lastActivityAtIso) {
    const t = Date.parse(lastActivityAtIso);
    if (Number.isFinite(t)) lastActivityMs = t;
  }

  const timeAwayMs =
    lastActivityMs != null ? Math.max(0, now.getTime() - lastActivityMs) : null;

  const baselineCompleted = !!(input && input.baselineCompleted);
  const baselineDossierRecorded = !!(input && input.baselineDossierRecorded);
  const lastBaselineCompletedAtMs =
    input &&
    typeof input.lastBaselineCompletedAtMs === "number" &&
    Number.isFinite(input.lastBaselineCompletedAtMs)
      ? input.lastBaselineCompletedAtMs
      : null;

  /** @type {'JUST_STEPPED_AWAY'|'DAY_OR_SO'|'LONG_GONE'|'UNKNOWN'} */
  let returnCategory = "UNKNOWN";
  if (timeAwayMs == null) {
    returnCategory = "UNKNOWN";
  } else if (timeAwayMs <= config.TIME_AWAY_BRIEF_MS) {
    returnCategory = "JUST_STEPPED_AWAY";
  } else if (timeAwayMs < config.TIME_AWAY_LONG_MS) {
    returnCategory = "DAY_OR_SO";
  } else {
    returnCategory = "LONG_GONE";
  }

  let needsBaselineRefresh = false;
  /** @type {string|null} */
  let baselineReason = null;

  if (returnCategory === "UNKNOWN" || returnCategory === "JUST_STEPPED_AWAY") {
    needsBaselineRefresh = false;
    baselineReason =
      returnCategory === "UNKNOWN" ? "no_last_activity_or_unparsed" : "quick_return";
  } else if (returnCategory === "LONG_GONE") {
    if (!baselineCompleted) {
      needsBaselineRefresh = false;
      baselineReason = "long_gone_still_in_baseline";
    } else if (!baselineDossierRecorded) {
      needsBaselineRefresh = true;
      baselineReason = "long_gone_no_dossier_baseline";
    } else {
      needsBaselineRefresh = true;
      baselineReason = "long_gone_refresh_baseline";
    }
  } else {
    // DAY_OR_SO
    if (!baselineCompleted) {
      needsBaselineRefresh = false;
      baselineReason = "day_or_so_still_in_baseline";
    } else if (!baselineDossierRecorded) {
      needsBaselineRefresh = true;
      baselineReason = "day_or_so_no_dossier_baseline";
    } else if (lastBaselineCompletedAtMs == null) {
      needsBaselineRefresh = true;
      baselineReason = "day_or_so_missing_baseline_timestamp";
    } else {
      const ageMs = now.getTime() - lastBaselineCompletedAtMs;
      if (ageMs > config.TIME_AWAY_STALE_MS) {
        needsBaselineRefresh = true;
        baselineReason = "day_or_so_stale_baseline";
      } else {
        needsBaselineRefresh = false;
        baselineReason = "day_or_so_fresh_baseline";
      }
    }
  }

  return {
    returnCategory,
    timeAwayMs,
    needsBaselineRefresh,
    baselineReason,
    lastActivityAtIso,
  };
}

/**
 * @param {object|null} session
 * @param {object|null} dossier
 * @param {Date} [now]
 */
function classifyFromSessionAndDossier(session, dossier, now) {
  const lastActivityAtIso =
    session && session.returnPolicyLastActivityAt != null
      ? String(session.returnPolicyLastActivityAt)
      : null;
  const baselineCompleted = !!(session && session.attacheCompleted);
  const baselineDossierRecorded = !!(
    dossier &&
    dossier.meta &&
    typeof dossier.meta.baselineQuestionsAnswered === "number" &&
    dossier.meta.baselineQuestionsAnswered > 0
  );
  const lastBaselineCompletedAtMs =
    dossier &&
    dossier.meta &&
    typeof dossier.meta.lastBaselineCompletedAt === "number" &&
    Number.isFinite(dossier.meta.lastBaselineCompletedAt)
      ? dossier.meta.lastBaselineCompletedAt
      : null;

  return classifySessionReturn({
    lastActivityAtIso,
    now,
    lastBaselineCompletedAtMs,
    baselineCompleted,
    baselineDossierRecorded,
  });
}

module.exports = {
  classifySessionReturn,
  classifyFromSessionAndDossier,
};
