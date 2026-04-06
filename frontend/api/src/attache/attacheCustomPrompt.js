"use strict";

const { buildAgentTurn } = require("../prompts/turnBuilderRegistry");

/**
 * Legacy helper: per-turn custom segment string only (no metadata).
 * Prefer `buildAgentTurn({ agentKey: 'attache', ... })` from `prompts/turnBuilderRegistry`.
 *
 * @param {{ state: import("./attacheMachine").AttacheState|null|undefined, context?: Record<string, unknown> }} input
 * @returns {string}
 */
function buildAttacheCustomPrompt(input) {
  return buildAgentTurn({ agentKey: "attache", state: input.state, context: input.context }).custom;
}

module.exports = {
  buildAttacheCustomPrompt,
};
