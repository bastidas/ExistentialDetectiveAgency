"use strict";

/**
 * @deprecated Prefer loading copy from `prompts/attache/prompt_catalog.json` and
 * `prompts/attache/attache_phase_transition_instructions.json` at the call site; this module remains
 * the shared template helper for `{baselineN_*}` tokens until call sites migrate.
 *
 * Shared template context for attaché prompts: baseline question pools and `{baselineN_*}` tokens.
 * Used by `attacheRuntime` and `buildAttacheTurnInstructionBlock`.
 */

const {
  computeCurrentPhaseId,
  getBaselineNumberFromPhase,
} = require("./attacheMachine");

const ATTACHE_QUESTIONS_BANK = require("../../prompts/attache/attache_questions.json");
const PHASE_TRANSITION = require("../../prompts/attache/attache_phase_transition_instructions.json");
const ADMINISTER_BASELINE_KEYS = {
  1: "administerBaseline1",
  2: "administerBaseline2",
  3: "administerBaseline3",
};

/**
 * @param {string} s
 * @returns {string}
 */
function stripOuterBackticks(s) {
  const t = typeof s === "string" ? s.trim() : "";
  if (t.length >= 2 && t.startsWith("`") && t.endsWith("`")) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * @param {1|2|3} baselineNumber
 * @returns {string}
 */
function baselineInstructionsFromPhaseJson(baselineNumber) {
  const key = ADMINISTER_BASELINE_KEYS[baselineNumber];
  if (!key) return "";
  const raw =
    PHASE_TRANSITION.phase_intro_sentences &&
    typeof PHASE_TRANSITION.phase_intro_sentences === "object"
      ? PHASE_TRANSITION.phase_intro_sentences[key]
      : null;
  return raw != null ? stripOuterBackticks(String(raw)) : "";
}

/** Per-baseline introductory instructions (from `attache_phase_transition_instructions.json`). */
const BASELINE1_INSTRUCTIONS = baselineInstructionsFromPhaseJson(1);
const BASELINE2_INSTRUCTIONS = baselineInstructionsFromPhaseJson(2);
const BASELINE3_INSTRUCTIONS = baselineInstructionsFromPhaseJson(3);

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
 * Which baseline (1–3) applies for `{baselineN_instructions}` / `{baselineN_questionQ}`.
 * For `phase === "explore"`, `getBaselineNumberFromPhase(phase)` is null and some snapshots omit
 * `baseline_number`—then derive from `previous_phase` or `potential_next_phase` (interrupted baseline).
 *
 * @param {import("./attacheMachine").AttacheState|null|undefined} state
 * @param {number|null|undefined} baselineNumberHint — from `getPromptPattern` when phase is baseline*
 * @param {number|null|undefined} patternBaselineNumber
 * @returns {1|2|3|null}
 */
function resolveBaselineNumberForTemplates(state, baselineNumberHint, patternBaselineNumber) {
  if (!state || typeof state !== "object") return null;

  const ok = (n) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    const t = Math.trunc(n);
    return t >= 1 && t <= 3 ? /** @type {1|2|3} */ (t) : null;
  };

  let n = ok(baselineNumberHint != null ? Number(baselineNumberHint) : NaN);
  if (n != null) return n;

  n = ok(state.baseline_number != null ? Number(state.baseline_number) : NaN);
  if (n != null) return n;

  n = ok(patternBaselineNumber != null ? Number(patternBaselineNumber) : NaN);
  if (n != null) return n;

  if (state.phase === "explore") {
    const prev = state.previous_phase != null ? String(state.previous_phase) : "";
    if (prev.startsWith("baseline")) {
      n = getBaselineNumberFromPhase(prev);
      if (n != null) return n;
    }
    const pot = state.potential_next_phase != null ? String(state.potential_next_phase) : "";
    if (pot.startsWith("baseline")) {
      n = getBaselineNumberFromPhase(pot);
      if (n != null) return n;
    }
  }

  return null;
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

  const baselineNumber = resolveBaselineNumberForTemplates(
    state,
    baselineNumberHint,
    pattern.baselineNumber
  );

  const qIndex =
    typeof state.question_index === "number" && state.question_index >= 0
      ? state.question_index
      : 0;

  if (baselineNumber == null) return {};
  const entry = getBaselineQuestionPoolEntry(baselineNumber);
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
  resolveBaselineNumberForTemplates,
  buildPromptContextFromState,
};
