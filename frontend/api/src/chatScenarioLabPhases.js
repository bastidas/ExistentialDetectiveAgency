"use strict";

/**
 * Lab-only allowed values for detective existential therapy phase in scenario preview.
 * Production uses the same vocabulary via `buildLlmConversationState` + `detectiveExistentialSession`.
 */

const EXISTENTIAL_THERAPY_PHASE_OPTIONS = ["", "initial", "middle", "final"];

const {
  NARRATIVE_PHASE_OPTIONS,
  pickNarrativePhaseForLab,
} = require("./narrativePhases");

/**
 * @param {object} preset
 * @returns {string}
 */
function pickExistentialTherapyPhase(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  const v =
    p.existentialTherapyPhase != null
      ? String(p.existentialTherapyPhase).trim()
      : p.existential_therapy_phase != null
        ? String(p.existential_therapy_phase).trim()
        : "";
  return EXISTENTIAL_THERAPY_PHASE_OPTIONS.includes(v) ? v : "";
}

/**
 * @param {object} preset
 * @returns {string}
 */
function pickNarrativePhase(preset) {
  return pickNarrativePhaseForLab(preset);
}

module.exports = {
  EXISTENTIAL_THERAPY_PHASE_OPTIONS,
  NARRATIVE_PHASE_OPTIONS,
  pickExistentialTherapyPhase,
  pickNarrativePhase,
};
