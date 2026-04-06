"use strict";

/**
 * Fixed mock attaché LLM JSON (see `prompts/attache/attache_turn.schema.json`).
 * The first attaché response in a session uses `asked_baseline_question: false`;
 * subsequent turns use `true`.
 *
 * @param {{ turnNumber?: number }} [opts] `turnNumber` is `attache_turn_count` before this turn (0 = first response).
 * @returns {{ user_response: string, user_intends_explore: boolean, user_intends_close: boolean, asked_baseline_question: boolean }}
 */
function buildMockAttacheLlmOutput({ turnNumber = 0 } = {}) {
  const isFirstResponse = turnNumber === 0;
  return {
    user_response: "mock",
    user_intends_explore: false,
    user_intends_close: false,
    asked_baseline_question: !isFirstResponse,
  };
}

module.exports = {
  buildMockAttacheLlmOutput,
};
