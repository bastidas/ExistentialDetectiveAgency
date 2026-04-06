"use strict";

const { classifyTimeAway } = require("../orchestration/timeAwayClassification");
const { isDossierStaleByAge } = require("../dossier_and_summarize/dossierRecency");

/**
 * @typedef {Object} ReturnClassification
 * @property {'JUST_STEPPED_AWAY'|'DAY_OR_SO'|'LONG_GONE'|'UNKNOWN'} returnCategory
 * @property {boolean} needsBaselineRefresh
 * @property {number|null} timeAwayMs
 */

/**
 * Classify return / time-away for detective orchestration facts.
 * Aligns return categories with `classifyTimeAway` bins (same thresholds as chat orchestrator).
 *
 * @param {object|null|undefined} session
 * @param {object|null|undefined} dossier
 * @param {Date} [now]
 * @returns {ReturnClassification}
 */
function classifyFromSessionAndDossier(session, dossier, now) {
  const s = session && typeof session === "object" ? session : {};
  const ms =
    typeof s.msSinceLastVisit === "number" && Number.isFinite(s.msSinceLastVisit)
      ? Math.max(0, s.msSinceLastVisit)
      : 0;
  const tier = classifyTimeAway(ms);
  const when = now instanceof Date ? now : new Date();

  let returnCategory = "UNKNOWN";
  if (tier.bin === "brief") returnCategory = "JUST_STEPPED_AWAY";
  else if (tier.bin === "moderate") returnCategory = "DAY_OR_SO";
  else if (tier.bin === "long") returnCategory = "LONG_GONE";
  else if (tier.bin === "stale") returnCategory = "LONG_GONE";

  const hasBaseline =
    dossier &&
    typeof dossier === "object" &&
    dossier.meta &&
    typeof dossier.meta === "object" &&
    dossier.meta.lastBaselineCompletedAt != null;

  const needsBaselineRefresh = !!hasBaseline && isDossierStaleByAge(dossier, when.getTime());

  return {
    returnCategory,
    needsBaselineRefresh,
    timeAwayMs: ms,
  };
}

module.exports = {
  classifyFromSessionAndDossier,
};
