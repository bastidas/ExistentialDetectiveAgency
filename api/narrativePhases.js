"use strict";

/**
 * Canonical narrative arc labels for `narrative_phase` (Lumen/Umbra session state).
 * Order follows classic dramatic structure; `narrativeTurn` maps by index (mod length).
 */

const NARRATIVE_PHASE_OPTIONS = Object.freeze([
  "Exposition",
  "Rising Action",
  "Climax",
  "Falling Action",
  "Denouement",
  "Coda",
]);

/**
 * @param {number} turn — non-negative turn index from philosophers narrative machine
 * @returns {string}
 */
function narrativePhaseFromTurn(turn) {
  const t =
    typeof turn === "number" && Number.isFinite(turn) && turn >= 0 ? Math.floor(turn) : 0;
  return NARRATIVE_PHASE_OPTIONS[t % NARRATIVE_PHASE_OPTIONS.length];
}

/**
 * Lab preset: valid option or default to first stage.
 *
 * @param {object} preset
 * @returns {string}
 */
function pickNarrativePhaseForLab(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  const v = p.narrativePhase != null ? String(p.narrativePhase).trim() : NARRATIVE_PHASE_OPTIONS[0];
  return NARRATIVE_PHASE_OPTIONS.includes(v) ? v : NARRATIVE_PHASE_OPTIONS[0];
}

/**
 * Smallest non-negative `narrativeTurn` whose `narrativePhaseFromTurn(n)` matches the label (same index mod 6).
 *
 * @param {string} phaseLabel
 * @returns {number}
 */
function narrativeTurnForPhaseLabel(phaseLabel) {
  const v = phaseLabel != null ? String(phaseLabel).trim() : NARRATIVE_PHASE_OPTIONS[0];
  const idx = NARRATIVE_PHASE_OPTIONS.indexOf(v);
  return idx >= 0 ? idx : 0;
}

module.exports = {
  NARRATIVE_PHASE_OPTIONS,
  narrativePhaseFromTurn,
  pickNarrativePhaseForLab,
  narrativeTurnForPhaseLabel,
};
