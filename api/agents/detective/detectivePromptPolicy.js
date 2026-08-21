"use strict";

/**
 * Pure policy: which detective `prompt_catalog.json` instruction ids apply to this turn.
 * **Time-away tier (`visit_bin`) is the primary selector** — each bin maps to exactly one catalog
 * entry id; `resolveSpecialInstructionEntries` injects that entry’s `title` + `body` when non-empty.
 * `DETECTIVE_RETURN_BRIEF` is intentionally empty (under ~15m / brief threshold): act like nothing happened—no return block.
 *
 * Used by `detectiveMachine` (`POLICY_TURN` → `instructionIds`) and `instructionSelection` (detective).
 *
 * @typedef {Object} DetectivePromptPolicyPayload
 * @property {string} [visit_bin] — from `classifyTimeAway` / chat orchestrator: `brief` | `moderate` | `long` | `stale`
 * @property {string} [temporal_greeting_mode]
 * @property {boolean} [dossier_stale_by_age]
 * @property {string} [returnCategory] — fallback when `visit_bin` is missing
 * @property {"penultimate"|"ultimate"|null} [closure_phase] — session exchange cap (overrides return rows)
 */

/** Maps chat time-away bin → single `prompt_catalog.json` entry id (`brief` → empty body, no injected return block). */
const DETECTIVE_CATALOG_ID_BY_VISIT_BIN = Object.freeze({
  brief: "DETECTIVE_RETURN_BRIEF",
  moderate: "DETECTIVE_RETURN_CONTINUATION",
  long: "DETECTIVE_RETURN_LONG_ABSENCE",
  stale: "DETECTIVE_RETURN_LONG_GONE",
});

/**
 * @param {DetectivePromptPolicyPayload} payload
 * @returns {string[]}
 */
function computeDetectiveCatalogInstructionIds(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const closure = p.closure_phase != null ? String(p.closure_phase).trim().toLowerCase() : "";
  if (closure === "ultimate") return ["DETECTIVE_CLOSURE_ULTIMATE"];
  if (closure === "penultimate") return ["DETECTIVE_CLOSURE_PENULTIMATE"];

  const visitBinRaw = p.visit_bin != null ? String(p.visit_bin).trim().toLowerCase() : "";

  if (visitBinRaw && Object.prototype.hasOwnProperty.call(DETECTIVE_CATALOG_ID_BY_VISIT_BIN, visitBinRaw)) {
    return [DETECTIVE_CATALOG_ID_BY_VISIT_BIN[visitBinRaw]];
  }

  /** Legacy / preview callers without `visit_bin`: derive from return classification. */
  const cat = p.returnCategory != null ? String(p.returnCategory) : "";
  if (cat === "JUST_STEPPED_AWAY") return ["DETECTIVE_RETURN_BRIEF"];
  if (cat === "DAY_OR_SO" || cat === "moderate" || cat === "day_or_so") {
    return ["DETECTIVE_RETURN_DAY_OR_SO"];
  }
  if (cat === "LONG_GONE" || cat === "long" || cat === "long_gone") {
    return ["DETECTIVE_RETURN_LONG_GONE"];
  }
  if (cat) return ["DETECTIVE_RETURN_UNKNOWN"];
  return [];
}

module.exports = {
  computeDetectiveCatalogInstructionIds,
  DETECTIVE_CATALOG_ID_BY_VISIT_BIN,
};
