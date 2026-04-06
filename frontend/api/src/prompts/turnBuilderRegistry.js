"use strict";

const { getPromptPattern } = require("../attache/attachePrompts");
const { buildDetectiveTurnInstructionBlock } = require("./orchestration/buildAgentTurnInstructions");

/**
 * @typedef {Object} TurnBuilderResult
 * @property {string} custom — passed to `composeAgentPrompt` as `custom` (attaché: empty; catalog tail from `buildAttacheTurnInstructionBlock`)
 * @property {{ promptFamilyKey?: string|null }} [metadata] — e.g. attaché pattern key for instruction selection
 */

function joinBlocks(parts) {
  return parts.map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
}

/**
 * Attaché: `# TURN INSTRUCTIONS` come from `prompt_catalog.json` via `composeAgentPrompt` → `buildAttacheTurnInstructionBlock`.
 * This builder only supplies metadata (`promptFamilyKey`); `custom` is empty so the catalog block is not duplicated.
 *
 * @param {{ state: import("../attache/attacheMachine").AttacheState|null|undefined, context?: Record<string, unknown> }} input
 * @returns {TurnBuilderResult}
 */
function buildAttacheTurn(input) {
  const { state } = input;
  const pattern = state ? getPromptPattern(state) : { key: "unknown" };
  return {
    custom: "",
    metadata: {
      promptFamilyKey: pattern && pattern.key ? pattern.key : null,
    },
  };
}

/**
 * Detective: same `# TURN INSTRUCTIONS` as `composeAgentPrompt` (return catalog + therapy + scene only for brief visit, first turn, no dossier; see `buildDetectiveTurnInstructionBlock`).
 *
 * @param {{ agentKey: "detective", session?: Record<string, unknown>, internalState?: Record<string, unknown> }} input
 * @returns {TurnBuilderResult}
 */
function buildDetectiveTurn(input) {
  const session = input.session && typeof input.session === "object" ? input.session : {};
  const internalState =
    input.internalState && typeof input.internalState === "object" ? input.internalState : {};
  const custom = buildDetectiveTurnInstructionBlock(session, internalState);
  return {
    custom,
    metadata: {},
  };
}

/** @type {Record<string, (input: Record<string, unknown>) => TurnBuilderResult>} */
const TURN_BUILDERS = {
  attache: buildAttacheTurn,
  detective: buildDetectiveTurn,
};

/**
 * Build the per-turn `custom` segment (and optional metadata) for a registered agent.
 * Add new agents by extending `TURN_BUILDERS` with a function returning `{ custom, metadata? }`.
 *
 * @param {object} input
 * @param {string} input.agentKey — registry key: `"attache"` | `"detective"` | …
 * @param {import("../attache/attacheMachine").AttacheState|null|undefined} [input.state] — attaché state when `agentKey === "attache"`
 * @param {Record<string, unknown>} [input.context] — template context (e.g. from `buildPromptContextFromState`)
 * @param {Record<string, unknown>} [input.session] — when `agentKey` is detective
 * @param {Record<string, unknown>} [input.internalState] — optional orchestrator state for detective
 * @returns {TurnBuilderResult}
 */
function buildAgentTurn(input) {
  if (!input || typeof input !== "object") {
    throw new Error("turnBuilderRegistry: buildAgentTurn requires an input object");
  }
  const agentKey = input.agentKey;
  if (!agentKey || typeof agentKey !== "string") {
    throw new Error("turnBuilderRegistry: agentKey is required");
  }
  const builder = TURN_BUILDERS[agentKey];
  if (typeof builder !== "function") {
    throw new Error(`turnBuilderRegistry: unknown agentKey "${agentKey}"`);
  }
  return builder(input);
}

module.exports = {
  buildAgentTurn,
  buildAttacheTurn,
  buildDetectiveTurn,
  TURN_BUILDERS,
  joinBlocks,
};
