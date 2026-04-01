"use strict";

const {
  classifyFromSessionAndDossier,
} = require("../session/returnClassification");

/**
 * @typedef {import("../session/returnClassification").ReturnClassification} ReturnClassification
 */

/**
 * @param {'JUST_STEPPED_AWAY'|'DAY_OR_SO'|'LONG_GONE'|'UNKNOWN'} returnCategory
 * @returns {'brief'|'mid'|'long'|'unknown'}
 */
function mapReturnCategoryToSessionRecency(returnCategory) {
  switch (returnCategory) {
    case "JUST_STEPPED_AWAY":
      return "brief";
    case "DAY_OR_SO":
      return "mid";
    case "LONG_GONE":
      return "long";
    default:
      return "unknown";
  }
}

/**
 * @param {object|null|undefined} dossier
 * @returns {'named'|'unnamed'|'no_dossier'}
 */
function computeKnownName(dossier) {
  if (dossier == null || typeof dossier !== "object") {
    return "no_dossier";
  }
  const raw =
    dossier.explicit && dossier.explicit.name != null
      ? String(dossier.explicit.name).trim()
      : "";
  if (raw.length > 0) return "named";
  return "unnamed";
}

/**
 * Uses the same policy signal as return classification (no duplicated thresholds).
 *
 * @param {boolean} baselineCompleted - session.attacheCompleted (handoff to detective)
 * @param {ReturnClassification} classification
 * @returns {'fresh'|'stale'|'not_applicable'}
 */
function computeBaselineVintage(baselineCompleted, classification) {
  if (!baselineCompleted) return "not_applicable";
  if (classification.needsBaselineRefresh) return "stale";
  return "fresh";
}

/**
 * Pure facts consumed by the detective XState machine and prompt layer.
 *
 * @param {object|null} session
 * @param {object|null} dossier
 * @param {ReturnClassification|null} [classification] - if null, computed via classifyFromSessionAndDossier
 * @param {Date} [now]
 * @returns {{
 *   sessionRecency: 'brief'|'mid'|'long'|'unknown',
 *   baselineHandoff: 'completed'|'not_completed',
 *   knownName: 'named'|'unnamed'|'no_dossier',
 *   baselineVintage: 'fresh'|'stale'|'not_applicable',
 *   returnCategory: string,
 *   timeAwayMs: number|null
 * }}
 */
function buildDetectiveOrchestrationFacts(session, dossier, classification, now) {
  const when = now instanceof Date ? now : new Date();
  const c =
    classification != null
      ? classification
      : classifyFromSessionAndDossier(session, dossier, when);

  const baselineCompleted = !!(session && session.attacheCompleted);

  return {
    sessionRecency: mapReturnCategoryToSessionRecency(c.returnCategory),
    baselineHandoff: baselineCompleted ? "completed" : "not_completed",
    knownName: computeKnownName(dossier),
    baselineVintage: computeBaselineVintage(baselineCompleted, c),
    returnCategory: c.returnCategory,
    timeAwayMs: c.timeAwayMs,
  };
}

module.exports = {
  buildDetectiveOrchestrationFacts,
  mapReturnCategoryToSessionRecency,
  computeKnownName,
  computeBaselineVintage,
};
