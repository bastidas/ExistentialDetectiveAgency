"use strict";

/**
 * Shared construction of dev-lab / docs preview for what the API sends to OpenAI:
 * exact system string, turn schema JSON, ordered non-system messages (matches `buildChatCompletionMessages`).
 */

/** Lab copy: how prior turns appear in a user message (sent as a user-role message after schema, when non-empty). */
const LAB_HISTORY_NOTE =
  "Prior user/assistant turns formatted for the model (formatConversationHistoryBlock). Empty on a new thread.";

/** Lab copy: this turn’s user text (sent as the final user-role message). */
const LAB_USER_NOTE = "POST /api/chat body field `message` for this turn.";

const { extractTurnInstructionsFromSystemPrompt } = require("../prompts/turnInstructionsExtract");

/**
 * @param {object|null|undefined} schema
 * @returns {string}
 */
function schemaToJsonString(schema) {
  if (!schema || typeof schema !== "object") return "";
  try {
    return JSON.stringify(schema, null, 2);
  } catch (_) {
    return "";
  }
}

/**
 * Non-system messages in the same order as `buildChatCompletionMessages` (history, then this turn).
 * JSON Schema + response-format prose are part of `systemRoleExact`, not a separate message.
 *
 * @param {object} input
 * @param {string} input.historyNote
 * @param {string} input.userNote
 * @returns {Array<{ role: string, label: string, content: string }>}
 */
function buildNonSystemMessagesPreview({ historyNote, userNote }) {
  /** @type {Array<{ role: string, label: string, content: string }>} */
  return [
    {
      role: "user",
      label: "Conversation history",
      content: historyNote,
    },
    {
      role: "user",
      label: "Current user message",
      content: userNote,
    },
  ];
}

/**
 * Uniform preview object for `/api/dev/chat-scenario-preview` (all agents).
 *
 * @param {object} input
 * @param {string} input.activeAgent
 * @param {string} input.title
 * @param {{ content: string, outputSchema?: object|null, structuredOutputsResponseFormat?: object|null }} input.composed — from `composeAgentPrompt`
 * @param {string} [input.phaseId]
 * @returns {object}
 */
function buildComposedPromptPreviewPayload({ activeAgent, title, composed, phaseId }) {
  const c = composed && typeof composed === "object" ? composed : {};
  const content = typeof c.content === "string" ? c.content : "";
  const turnInstructionsPreview = extractTurnInstructionsFromSystemPrompt(content);
  if (turnInstructionsPreview.length > 0 && content.indexOf(turnInstructionsPreview) < 0) {
    throw new Error(
      "turnInstructionsPreview must be a contiguous substring of composed.content (TURN INSTRUCTIONS extract bug)"
    );
  }
  const labLlmSafeState =
    c.llmSafeState && typeof c.llmSafeState === "object" ? { ...c.llmSafeState } : undefined;
  return {
    activeAgent,
    title,
    systemRoleExact: content,
    /** Dev lab: `# TURN INSTRUCTIONS` region only (same string embedded in systemRoleExact). */
    turnInstructionsPreview,
    outputSchemaJson: schemaToJsonString(c.outputSchema),
    structuredOutputsResponseFormat:
      c.structuredOutputsResponseFormat && typeof c.structuredOutputsResponseFormat === "object"
        ? c.structuredOutputsResponseFormat
        : undefined,
    additionalMessages: buildNonSystemMessagesPreview({
      historyNote: LAB_HISTORY_NOTE,
      userNote: LAB_USER_NOTE,
    }),
    phaseId: phaseId != null && phaseId !== "" ? phaseId : undefined,
    /** @deprecated use systemRoleExact */
    systemPrompt: content,
    /** Dev lab: `composeAgentPrompt` conversation slice (existential_therapy_phase, narrative_phase, …). */
    labLlmSafeState,
  };
}

module.exports = {
  LAB_HISTORY_NOTE,
  LAB_USER_NOTE,
  schemaToJsonString,
  buildNonSystemMessagesPreview,
  buildComposedPromptPreviewPayload,
  extractTurnInstructionsFromSystemPrompt,
};
