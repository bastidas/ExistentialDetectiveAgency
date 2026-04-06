"use strict";

const { buildAgentTurn } = require("../prompts/turnBuilderRegistry");

/**
 * Per-turn custom segment for the detective (same as `buildAgentTurn({ agentKey: 'detective', ... }).custom`).
 *
 * @param {object} [input]
 * @param {object} [input.session]
 * @param {object} [input.internalState]
 * @param {"detective"} [input.agentKey]
 * @returns {string}
 */
function buildDetectiveCustomPrompt({
  session,
  internalState,
  agentKey = "detective",
} = {}) {
  return buildAgentTurn({
    agentKey,
    session: session && typeof session === "object" ? session : {},
    internalState: internalState && typeof internalState === "object" ? internalState : {},
  }).custom;
}

module.exports = {
  buildDetectiveCustomPrompt,
};
