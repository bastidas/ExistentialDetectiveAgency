"use strict";

/**
 * Shared template context for attaché prompts: baseline question pools and `{baselineN_*}` tokens.
 * Used by `attacheRuntime` and `buildAttacheTurnInstructionBlock` (single source of truth).
 */

const {
  computeCurrentPhaseId,
  getBaselineNumberFromPhase,
} = require("./attacheMachine");

const ATTACHE_QUESTIONS_BANK = require("../../prompts/attache/attache_questions.json");
const ADMINISTER_BASELINE_KEYS = {
  1: "administerBaseline1",
  2: "administerBaseline2",
  3: "administerBaseline3",
};

/** Per-baseline introductory instructions (same text as legacy `attachePrompts.js`). */
const BASELINE1_INSTRUCTIONS = [
  "This is Phase 1, this is a sort of baseline.",
  "It is just warming you up, that's all.",
  "In this phase you don't answer the question; you just repeat what is in the brackets as fast as possible.",
  "So just repetition.",
].join(" ");

const BASELINE2_INSTRUCTIONS = [
  "Despite the numerous anomalies we have detected, you are doing quite well.",
  "And we can continue.",
  "In this section just answer these questions genuinely.",
  "Feel free to be as brief as you like; just move through the questions like water.",
].join(" ");

const BASELINE3_INSTRUCTIONS = [
  "In this phase we will go deeper.",
  "We will ask some questions that may be more difficult to answer, but please just do your best.",
  "Actually, these are not even questions, just ideas, and there are no right or wrong answers.",
  "Just reply with whatever comes to mind, and try to keep moving through them.",
].join(" ");

/**
 * @param {1|2|3} baselineNumber
 * @returns {{ questions: string[] }|null}
 */
function getBaselineQuestionPoolEntry(baselineNumber) {
  const k = ADMINISTER_BASELINE_KEYS[baselineNumber];
  if (!k) return null;
  const entry = ATTACHE_QUESTIONS_BANK[k];
  if (!entry || !Array.isArray(entry.questions)) return null;
  return entry;
}

/**
 * @param {import("./attacheMachine").AttacheState|null|undefined} state
 * @returns {{ key: string, baselineNumber: number|null }}
 */
function getPromptPattern(state) {
  if (!state || typeof state !== "object") {
    return { key: "unknown", baselineNumber: null };
  }
  const phaseId = state.current_phase_id || computeCurrentPhaseId(state);
  const baselineNumber = getBaselineNumberFromPhase(state.phase);
  return {
    key: phaseId || state.phase || "unknown",
    baselineNumber,
  };
}

/**
 * Build the prompt context object for catalog templates from the current AttacheState
 * plus optional session-level info (baseline shuffle order).
 *
 * @param {import("./attacheMachine").AttacheState|null} state
 * @param {object|null} sessionState
 * @param {number|null} baselineNumberHint
 * @returns {{ baselineN_questionQ?: string, baselineN_instructions?: string }}
 */
function buildPromptContextFromState(state, sessionState, baselineNumberHint) {
  if (!state) return {};

  const pattern = getPromptPattern(state);

  const baselineNumber =
    typeof baselineNumberHint === "number" && baselineNumberHint
      ? baselineNumberHint
      : state.baseline_number != null
        ? state.baseline_number
        : pattern.baselineNumber;

  const qIndex =
    typeof state.question_index === "number" && state.question_index >= 0
      ? state.question_index
      : 0;

  if (!baselineNumber && baselineNumber !== 0) return {};
  const entry = getBaselineQuestionPoolEntry(
    /** @type {1|2|3} */ (baselineNumber)
  );
  if (!entry || !Array.isArray(entry.questions)) return {};

  let effectiveIndex = qIndex;
  if (sessionState && sessionState.baseline_question_order && baselineNumber != null) {
    const order = sessionState.baseline_question_order[baselineNumber];
    if (Array.isArray(order) && qIndex >= 0 && qIndex < order.length) {
      effectiveIndex = order[qIndex];
    }
  }

  const question = entry.questions[effectiveIndex];
  if (!question) return {};

  let baselineInstructions;
  if (baselineNumber === 1) baselineInstructions = BASELINE1_INSTRUCTIONS;
  else if (baselineNumber === 2) baselineInstructions = BASELINE2_INSTRUCTIONS;
  else if (baselineNumber === 3) baselineInstructions = BASELINE3_INSTRUCTIONS;

  const ctx = { baselineN_questionQ: question };
  if (baselineInstructions) {
    ctx.baselineN_instructions = baselineInstructions;
  }
  return ctx;
}

module.exports = {
  BASELINE1_INSTRUCTIONS,
  BASELINE2_INSTRUCTIONS,
  BASELINE3_INSTRUCTIONS,
  getBaselineQuestionPoolEntry,
  getPromptPattern,
  buildPromptContextFromState,
};
