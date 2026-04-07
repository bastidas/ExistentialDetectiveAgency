"use strict";

const { getTimeAwayThresholds } = require("../orchestration/timeAwayClassification");

/** Same buffer as `buildStaleMinimalDossier` in chatTestSeed — past `longMs` for `isDossierStaleByAge`. */
const STALE_BUFFER_MS = 60_000;

/**
 * Resolve `meta.lastBaselineCompletedAt` for chat scenario lab presets (preview + seed).
 * When `hasDossier` is not true, returns `null`.
 *
 * Preset fields:
 * - `dossierBaselineAge`: optional `"fresh"` | `"stale"` | `"custom"`. When omitted, uses legacy behavior:
 *   attaché target → stale-by-threshold timestamp; detective target → fresh (`nowMs`).
 * - `dossierLastBaselineCompletedAtOffsetMs`: non-negative ms **before** `nowMs`; used when `dossierBaselineAge === "custom"`.
 *
 * @param {object} preset
 * @param {number} nowMs
 * @returns {number|null}
 */
function resolveLabLastBaselineCompletedAt(preset, nowMs) {
  const p = preset && typeof preset === "object" ? preset : {};
  if (p.hasDossier !== true) return null;
  const { longMs } = getTimeAwayThresholds();
  const age = p.dossierBaselineAge;
  if (age === "custom") {
    const off = p.dossierLastBaselineCompletedAtOffsetMs;
    if (typeof off !== "number" || !Number.isFinite(off) || off < 0) {
      return nowMs;
    }
    return nowMs - off;
  }
  if (age === "fresh") return nowMs;
  if (age === "stale") return nowMs - longMs - STALE_BUFFER_MS;

  let activeAgent;
  if (typeof p.baselineCompleted === "boolean") {
    activeAgent = p.baselineCompleted ? "detective" : "attache";
  } else {
    activeAgent = p.activeAgent === "detective" ? "detective" : "attache";
  }
  return activeAgent === "attache" ? nowMs - longMs - STALE_BUFFER_MS : nowMs;
}

/**
 * Validate optional lab fields for baseline-completion age (dev preset / HTTP body).
 *
 * @param {object} preset
 * @returns {{ error: string }|null}
 */
function validateLabDossierBaselinePreset(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  if (p.dossierBaselineAge != null && String(p.dossierBaselineAge).trim() !== "") {
    const a = String(p.dossierBaselineAge).trim();
    if (a !== "fresh" && a !== "stale" && a !== "custom") {
      return { error: "Invalid dossierBaselineAge (use fresh, stale, or custom)." };
    }
    if (a === "custom") {
      const off = p.dossierLastBaselineCompletedAtOffsetMs;
      if (typeof off !== "number" || !Number.isFinite(off) || off < 0) {
        return {
          error:
            "dossierLastBaselineCompletedAtOffsetMs must be a non-negative number when dossierBaselineAge is custom.",
        };
      }
    }
  } else if (p.dossierLastBaselineCompletedAtOffsetMs != null) {
    const off = p.dossierLastBaselineCompletedAtOffsetMs;
    if (typeof off === "number" && Number.isFinite(off) && off < 0) {
      return { error: "dossierLastBaselineCompletedAtOffsetMs must be >= 0." };
    }
  }
  return null;
}

module.exports = {
  resolveLabLastBaselineCompletedAt,
  validateLabDossierBaselinePreset,
  STALE_BUFFER_MS,
};
