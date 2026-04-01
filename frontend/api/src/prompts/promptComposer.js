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

const SAFE_VIEW_KEYS = Object.freeze({
  detective: [
    "dossier_summary",
    "therapy_phase",
    "existential_phase",
    "preceding_conversation_summary",
  ],
  final_detective: [
    "dossier_summary",
    "therapy_phase",
    "existential_phase",
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
  attache: [
    "dossier_summary",
    "preceding_conversation_summary",
  ],
});

const DEFAULT_RULES = Object.freeze({
  detective_speaks_to_user_only: true,
  philosophers_may_debate_each_other: true,
  philosophers_do_not_address_user: true,
  revelation_follows_narrative_phase: true,
});

let registryValidated = false;

function ensurePromptRegistryValidated() {
  if (registryValidated) return;
  const strict = process.env.NODE_ENV === "test" || /^(1|true|yes)$/i.test(process.env.CI || "");
  const result = validatePromptRegistry({ strict });
  if (!result.ok && !strict) {
    // Keep runtime alive in non-strict mode, but surface missing files clearly.
    console.warn("[promptComposer] prompt registry validation warnings:\n" + result.errors.join("\n"));
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

function resolveSpecialInstructionBodies(catalogJson, instructionIds) {
  const entries = catalogJson && catalogJson.entries && typeof catalogJson.entries === "object"
    ? catalogJson.entries
    : {};
  const blocks = [];
  for (const id of instructionIds) {
    const entry = entries[id];
    if (!entry || typeof entry !== "object") continue;
    const body = entry.body == null ? "" : String(entry.body).trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

function composeAgentPrompt({
  agentKey,
  session,
  internalState,
  otherAgentsSummary,
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
  const selectedIds = selectSpecialInstructions(agentKey, facts);
  const selectedBodies = resolveSpecialInstructionBodies(catalog, selectedIds);
  const explicitAdditional = Array.isArray(additionalSpecialInstructions)
    ? additionalSpecialInstructions.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  const combinedSpecialInstructions = [...selectedBodies, ...explicitAdditional];

  if (entry.renderMode === "plain") {
    const parts = [persona, instructions, ...combinedSpecialInstructions];
    if (attacheTurnInstruction && typeof attacheTurnInstruction.turnInstruction === "string") {
      parts.push(attacheTurnInstruction.turnInstruction);
    }
    return {
      role: "system",
      content: parts.filter(Boolean).join("\n\n"),
      outputSchema,
      selectedInstructionIds: selectedIds,
      llmSafeState: conversationState,
    };
  }

  const identity = [persona, instructions, ...combinedSpecialInstructions]
    .filter(Boolean)
    .join("\n\n");
  const payload = {
    type: "agent_context",
    identity,
    other_agents: String(otherAgentsSummary || "").trim(),
    conversation_state: conversationState,
    output_schema: outputSchema,
    rules: { ...DEFAULT_RULES },
  };
  return {
    role: "system",
    content: JSON.stringify(payload),
    outputSchema,
    selectedInstructionIds: selectedIds,
    llmSafeState: conversationState,
  };
}

module.exports = {
  composeAgentPrompt,
  pickAllowedKeys,
};

