"use strict";

const {
  getPromptRegistryEntry,
  validatePromptRegistry,
  loadText,
  loadJson,
} = require("./promptRegistry");
const { selectSpecialInstructions } = require("./instructionSelection");
const { extractReturnPromptFacts } = require("./returnPromptFacts");
const { buildLlmConversationState } = require("../orchestration/buildLlmConversationState");
const { logComposedPromptFull, logTurnInstructionsBlock } = require("../logger");
const { extractFromTurnInstructionsHeadingThroughEnd } = require("./turnInstructionsExtract");
const {
  resolveSpecialInstructionBodies,
  resolveSpecialInstructionEntries,
  buildDetectiveSessionForTurnInstructions,
  buildAttacheSessionForTurnInstructions,
} = require("./promptCatalogUtils");
const {
  buildDetectiveTurnInstructionBlock,
  buildAttacheTurnInstructionBlock,
} = require("./orchestration/buildAgentTurnInstructions");

/**
 * Per-agent allowlist for `llmSafeState` (filtered slice of `buildLlmConversationState`).
 * Used for diagnostics and the chat scenario lab — **not** appended to `messages[]` unless a future
 * feature explicitly serializes it (production today does not).
 *
 * Attaché: narrative context only (dossier / prior summary). Routing ids, visit bins, and policy
 * flags are **not** included — see dev lab `labOrchestrationMeta` for attaché preview.
 */
const SAFE_VIEW_KEYS = Object.freeze({
  detective: [
    "dossier_summary",
    "existential_therapy_phase",
    "visit_bin",
    "ms_since_last_visit",
    "time_away_context_line",
    "temporal_greeting_mode",
    "detective_prompt_instruction_ids",
    "detective_turn_count",
    "closure_phase",
    "preceding_conversation_summary",
  ],
  lumen: [
    "dossier_summary",
    "narrative_phase",
    "secrets_revealed",
    "preceding_conversation_summary",
  ],
  umbra: [
    "dossier_summary",
    "narrative_phase",
    "secrets_revealed",
    "preceding_conversation_summary",
  ],
  attache: ["dossier_summary", "preceding_conversation_summary"],
});

let registryValidated = false;

function ensurePromptRegistryValidated() {
  if (registryValidated) return;
  const strict = process.env.NODE_ENV === "test" || /^(1|true|yes)$/i.test(process.env.CI || "");
  const result = validatePromptRegistry({ strict });
  if (!result.ok && !strict) {
    console.warn(
      "[promptComposer] prompt registry validation warnings:\n" + result.errors.join("\n")
    );
  }
  registryValidated = true;
}

function pickAllowedKeys(agentKey, safeView) {
  const allowed = SAFE_VIEW_KEYS[agentKey] || [];
  const out = {};
  for (const key of allowed) {
    if (safeView && Object.prototype.hasOwnProperty.call(safeView, key)) {
      out[key] = safeView[key];
    }
  }
  return out;
}

function joinNonEmpty(parts) {
  return parts.map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
}

/** Stable `json_schema.name` for Chat Completions Structured Outputs (OpenAI API). */
function structuredOutputSchemaName(agentKey) {
  const k = agentKey != null ? String(agentKey) : "";
  if (k === "detective") return "detective_turn";
  if (k === "attache") return "attache_turn";
  if (k === "lumen") return "lumen_philosopher_turn";
  if (k === "umbra") return "umbra_philosopher_turn";
  return `${k || "agent"}_turn`;
}

/**
 * Ensure JSON Schema objects meet Structured Outputs rules (e.g. `additionalProperties: false` on objects).
 * @param {object} schema — root JSON Schema object
 * @returns {object|null}
 */
function normalizeSchemaForStructuredOutputs(schema) {
  if (!schema || typeof schema !== "object") return null;
  let clone;
  try {
    clone = JSON.parse(JSON.stringify(schema));
  } catch (_) {
    return null;
  }
  function walk(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (node.type === "object" && node.properties && typeof node.properties === "object") {
      node.additionalProperties = false;
      for (const key of Object.keys(node.properties)) {
        walk(node.properties[key]);
      }
    }
    if (node.type === "array" && node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
      walk(node.items);
    }
  }
  walk(clone);
  return clone;
}

/**
 * Chat Completions `response_format` for OpenAI Structured Outputs.
 * @see https://developers.openai.com/api/docs/guides/structured-outputs
 * @param {string} agentKey
 * @param {object|null|undefined} outputSchema — raw schema from registry JSON
 * @returns {{ type: "json_schema", json_schema: { name: string, strict: boolean, schema: object } }|null}
 */
function buildStructuredOutputsResponseFormat(agentKey, outputSchema) {
  const normalized = normalizeSchemaForStructuredOutputs(outputSchema);
  if (!normalized || typeof normalized !== "object") return null;
  const name = structuredOutputSchemaName(agentKey);
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema: normalized,
    },
  };
}

/**
 * Full JSON Schema appendix for system prompt (fallback when Structured Outputs is not used).
 * @param {object|null|undefined} outputSchema
 * @returns {string}
 */
function buildSchemaSystemAppendix(outputSchema) {
  if (!outputSchema || typeof outputSchema !== "object") return "";
  let raw;
  try {
    raw = JSON.stringify(outputSchema, null, 2);
  } catch (_) {
    return "";
  }
  if (!raw || raw === "{}") return "";
  return [
    "# Response format",
    "",
    "Reply with a single JSON object only (no markdown code fences, no text before or after the JSON). It must satisfy:",
    "",
    raw,
  ].join("\n");
}

/**
 * Short system appendix when the API enforces shape via `response_format.type === "json_schema"`.
 */
const STRUCTURED_OUTPUT_SYSTEM_APPENDIX = [
  "# Response format",
  "",
  "Reply with a single JSON object only (no markdown code fences, no text before or after the JSON). The API enforces the output shape to match the turn schema.",
].join("\n");

/**
 * Shared layers: persona + instructions + catalog-driven special instruction blocks.
 * For attaché, `buildAttacheSessionForTurnInstructions` sets `attache_prompt_instruction_ids`; bodies render in
 * `buildAttacheTurnInstructionBlock` (tail) — not duplicated in `catalogBlocks`.
 * For detective, when `session.detective_prompt_instruction_ids` is set (from `detectiveMachine` `POLICY_TURN` via `runDetectivePromptPolicyTurn`),
 * those ids replace `selectSpecialInstructions`; middle catalog bodies use the agent `prompt_catalog.json`.
 *
 * @param {object} input
 * @param {string} input.agentKey
 * @param {object} [input.session]
 * @param {object} [input.internalState]
 * @param {string[]|undefined} input.additionalSpecialInstructions
 * @param {{ attachePromptFamilyKey?: string|null }} [input.attacheTurnInstruction]
 * @returns {object}
 */
function buildSharedIdentityParts({
  agentKey,
  session,
  internalState,
  additionalSpecialInstructions,
  attacheTurnInstruction,
}) {
  ensurePromptRegistryValidated();
  const entry = getPromptRegistryEntry(agentKey);
  if (!entry) {
    throw new Error(`Unknown prompt registry agent key: ${agentKey}`);
  }

  const persona = loadText(entry.personaPath);
  const instructions = loadText(entry.instructionsPath);
  const outputSchema = loadJson(entry.outputSchemaPath);
  const catalog = loadJson(entry.catalogPath);

  const rawSafeView = buildLlmConversationState(agentKey, {
    internalState,
    session,
  });
  const conversationState = pickAllowedKeys(agentKey, rawSafeView);

  const facts = {
    ...extractReturnPromptFacts(session, internalState),
    attachePromptFamilyKey:
      attacheTurnInstruction && attacheTurnInstruction.attachePromptFamilyKey
        ? attacheTurnInstruction.attachePromptFamilyKey
        : null,
  };
  const s = session && typeof session === "object" ? session : {};
  const useMachineDetectiveIds =
    agentKey === "detective" && Array.isArray(s.detective_prompt_instruction_ids);
  const machineDetectiveIds = useMachineDetectiveIds
    ? s.detective_prompt_instruction_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : null;

  const useMachineAttacheIds =
    agentKey === "attache" && Array.isArray(s.attache_prompt_instruction_ids);
  const machineAttacheIds = useMachineAttacheIds
    ? s.attache_prompt_instruction_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : null;

  let selectedIds = selectSpecialInstructions(agentKey, facts);
  let selectedBodies = resolveSpecialInstructionBodies(catalog, selectedIds);
  if (useMachineDetectiveIds) {
    selectedIds = machineDetectiveIds || [];
    selectedBodies = [];
  }
  if (useMachineAttacheIds) {
    selectedIds = machineAttacheIds || [];
    selectedBodies = [];
  }
  const explicitAdditional = Array.isArray(additionalSpecialInstructions)
    ? additionalSpecialInstructions.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  const catalogBlocks = [...selectedBodies, ...explicitAdditional];

  return {
    entry,
    persona,
    instructions,
    catalogBlocks,
    selectedIds,
    conversationState,
    outputSchema,
    catalog,
  };
}

/**
 * Resolve per-turn custom segment: explicit `custom` wins; else legacy attaché `turnInstruction`.
 *
 * @param {string|undefined|null} custom
 * @param {{ turnInstruction?: string }|null|undefined} attacheTurnInstruction
 * @returns {string}
 */
function resolveCustomSegment(custom, attacheTurnInstruction) {
  if (custom != null && String(custom).trim() !== "") {
    return String(custom).trim();
  }
  if (attacheTurnInstruction && typeof attacheTurnInstruction.turnInstruction === "string") {
    return String(attacheTurnInstruction.turnInstruction).trim();
  }
  return "";
}

/**
 * @typedef {Object} ComposedAgentPrompt
 * @property {"system"} role
 * @property {string} content — exact string for `messages[].role === "system"` (persona + instructions + catalog + custom + response-format line)
 * @property {object|null} outputSchema — raw turn schema from disk (also normalized for `structuredOutputsResponseFormat` when set)
 * @property {{ type: "json_schema", json_schema: { name: string, strict: boolean, schema: object } }|null} structuredOutputsResponseFormat — pass to `chat.completions.create` as `response_format`, or null to use JSON mode + full schema appendix in `content`
 * @property {string[]} selectedInstructionIds
 * @property {Record<string, unknown>} llmSafeState — allowlisted slice for mocks/lab/logs; not a default part of the OpenAI `messages` body
 */

/**
 * @param {object} input
 * @param {string} input.agentKey
 * @param {object} [input.session]
 * @param {object} [input.internalState]
 * @param {string[]} [input.additionalSpecialInstructions]
 * @param {{ turnInstruction?: string, attachePromptFamilyKey?: string|null }} [input.attacheTurnInstruction]
 * @param {string} [input.custom] Per-agent custom prompt tail (xstate + prompts library); overrides `turnInstruction` when set.
 * @param {{ activeAgent?: string }} [input.debugContext] Optional labels for DEBUG_PROMPTS_LEVEL 2–3 logging (2: from `# TURN INSTRUCTIONS` through end of system; 3: full system).
 * @returns {ComposedAgentPrompt}
 */
function composeAgentPrompt({
  agentKey,
  session,
  internalState,
  additionalSpecialInstructions,
  attacheTurnInstruction,
  custom,
  debugContext,
}) {
  /** Merge effective catalog ids so `buildSharedIdentityParts` and `# TURN INSTRUCTIONS` stay aligned. */
  let sessionForBuild = session;
  if (agentKey === "detective") {
    sessionForBuild = buildDetectiveSessionForTurnInstructions(session, internalState);
  } else if (agentKey === "attache") {
    sessionForBuild = buildAttacheSessionForTurnInstructions(session, internalState);
  }

  const shared = buildSharedIdentityParts({
    agentKey,
    session: sessionForBuild,
    internalState,
    additionalSpecialInstructions,
    attacheTurnInstruction,
  });
  const {
    persona,
    instructions,
    catalogBlocks,
    selectedIds,
    conversationState,
    outputSchema,
    catalog,
  } = shared;

  /** Detective / attaché `tailCustom`: full `# TURN INSTRUCTIONS` from `prompt_catalog.json` + template fill. */
  let tailCustom;
  if (agentKey === "detective" && catalog && typeof catalog === "object") {
    const turnBlock = buildDetectiveTurnInstructionBlock(sessionForBuild, internalState);
    const customSeg = resolveCustomSegment(custom, attacheTurnInstruction);
    tailCustom = joinNonEmpty([turnBlock, customSeg]);
  } else if (agentKey === "attache" && catalog && typeof catalog === "object") {
    const turnBlock = buildAttacheTurnInstructionBlock(sessionForBuild, internalState);
    const customSeg = resolveCustomSegment(custom, attacheTurnInstruction);
    tailCustom = joinNonEmpty([turnBlock, customSeg]);
  } else {
    tailCustom = resolveCustomSegment(custom, attacheTurnInstruction);
  }

  const structuredOutputsResponseFormat = buildStructuredOutputsResponseFormat(agentKey, outputSchema);

  /** System role: persona + instructions + catalog + custom + short or full response-format block. Never JSON `agent_context`. */
  let schemaAppendix = "";
  if (outputSchema && typeof outputSchema === "object") {
    schemaAppendix = structuredOutputsResponseFormat
      ? STRUCTURED_OUTPUT_SYSTEM_APPENDIX
      : buildSchemaSystemAppendix(outputSchema);
  }
  const parts = [persona, instructions, ...catalogBlocks, tailCustom];
  if (schemaAppendix) {
    parts.push(schemaAppendix);
  }

  /** @type {ComposedAgentPrompt} */
  const result = {
    role: "system",
    content: joinNonEmpty(parts),
    outputSchema,
    structuredOutputsResponseFormat,
    selectedInstructionIds: selectedIds,
    llmSafeState: conversationState,
  };

  logTurnInstructionsBlock({
    agentKey,
    activeAgent: debugContext && debugContext.activeAgent,
    turnInstructionsText: extractFromTurnInstructionsHeadingThroughEnd(result.content),
  });
  logComposedPromptFull({
    agentKey,
    activeAgent: debugContext && debugContext.activeAgent,
    systemContentExact: result.content,
  });

  return result;
}

module.exports = {
  composeAgentPrompt,
  buildDetectiveSessionForTurnInstructions,
  buildAttacheSessionForTurnInstructions,
  buildDetectiveTurnInstructionBlock,
  buildAttacheTurnInstructionBlock,
  buildSharedIdentityParts,
  resolveSpecialInstructionEntries,
  resolveCustomSegment,
  pickAllowedKeys,
  SAFE_VIEW_KEYS,
  buildSchemaSystemAppendix,
  buildStructuredOutputsResponseFormat,
  normalizeSchemaForStructuredOutputs,
  structuredOutputSchemaName,
  /** @deprecated use buildSchemaSystemAppendix */
  buildSchemaUserMessageContent: buildSchemaSystemAppendix,
};
