"use strict";

/**
 * Maps attaché domain phase to orchestrator state node id (see `attacheOrchestratorMachine`).
 *
 * @param {string} [phase]
 * @returns {string}
 */
function phaseToOrchestratorStateId(phase) {
  if (phase === "start") return "intro";
  if (phase === "explore") return "exploring";
  if (phase === "baseline1") return "baseline1";
  if (phase === "baseline2") return "baseline2";
  if (phase === "baseline3") return "baseline3";
  if (phase === "close") return "closing";
  return "intro";
}

/**
 * Placeholder per orchestrator state until real copy exists.
 *
 * @param {string} [phase]
 * @returns {string}
 */
function getAttacheCustomStateInstructionsPlaceholder(phase) {
  const id = phaseToOrchestratorStateId(phase);
  return `state ${id} instructions`;
}

/**
 * Joined segments for attaché mock diagnostics (no `mockQuery=` prefix — use in `buildMockAgentReply` + `input.mock_query`).
 *
 * @param {{ customStateInstructions?: string, baselineQuestion?: string|null }} input
 * @returns {string}
 */
function formatAttacheMockQueryBody({ customStateInstructions, baselineQuestion }) {
  const stateInstr =
    String(customStateInstructions || "").trim() || getAttacheCustomStateInstructionsPlaceholder("start");
  const bq = baselineQuestion == null ? "" : String(baselineQuestion).trim();
  const parts = [
    "attache_persona.md",
    "attache_instructions.md",
    "attache_turn.schema.json",
    stateInstr,
    bq,
  ];
  return parts.join(" + ");
}

/**
 * Full `mockQuery=…` line for logs and `input.mock_query`.
 *
 * @param {{ customStateInstructions?: string, baselineQuestion?: string|null }} input
 * @returns {string}
 */
function formatAttacheMockQueryLine(input) {
  return `mockQuery=${formatAttacheMockQueryBody(input)}`;
}

module.exports = {
  phaseToOrchestratorStateId,
  getAttacheCustomStateInstructionsPlaceholder,
  formatAttacheMockQueryBody,
  formatAttacheMockQueryLine,
};
