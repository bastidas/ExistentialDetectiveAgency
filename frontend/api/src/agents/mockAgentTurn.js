"use strict";

const path = require("path");
const { composeAgentPrompt } = require("../prompts/promptComposer");
const { getPromptRegistryEntry } = require("../prompts/promptRegistry");
const { buildAgentTurn } = require("../prompts/turnBuilderRegistry");

const MOCK_CUSTOM_MAX = 120;

/**
 * Pretty-print JSON for mock diagnostics (chat-readable).
 *
 * @param {unknown} value
 * @returns {string}
 */
function prettyJsonForMock(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return JSON.stringify(value);
}

/**
 * Split `a + b + c` mock query stack onto indented lines.
 *
 * @param {string} mockQuery
 * @returns {string}
 */
function formatMockQueryStack(mockQuery) {
  const s = String(mockQuery).trim();
  if (!s) return "(none)";
  const segments = s.split(/\s+\+\s+/).map((x) => x.trim()).filter(Boolean);
  if (segments.length <= 1) return s;
  return segments
    .map((seg, i) => (i === 0 ? seg : `  + ${seg}`))
    .join("\n");
}

/**
 * @param {string|null|undefined} userMessage
 * @returns {string}
 */
function formatMockUserLine(userMessage) {
  const u = userMessage != null ? String(userMessage) : "";
  if (u === "") return "User: (empty)";
  if (u.includes("\n")) {
    return `User:\n${u.split("\n").map((line) => `  ${line}`).join("\n")}`;
  }
  return `User: ${u}`;
}

function fileLabel(p) {
  if (p == null || p === "") return "";
  return path.basename(String(p));
}

/**
 * Truncate custom segment for mock query line (offline diagnostics).
 *
 * @param {string|null|undefined} custom
 * @returns {string}
 */
function truncateMockCustom(custom) {
  const s = custom == null ? "" : String(custom).trim();
  if (s.length <= MOCK_CUSTOM_MAX) return s;
  return s.slice(0, MOCK_CUSTOM_MAX) + "…";
}

/**
 * Single-line mock of the query stack: persona + instructions + turn schema files + *custom*.
 *
 * @param {string} agentKey
 * @param {string} [custom] Resolved per-agent custom segment (same as passed to `composeAgentPrompt` `custom`).
 * @returns {string}
 */
function formatMockQueryLine(agentKey, custom) {
  const entry = getPromptRegistryEntry(agentKey);
  if (!entry) {
    return `unknown_agent=${String(agentKey)} + *${truncateMockCustom(custom)}*`;
  }
  const b = (p) => (p ? fileLabel(p) : "");
  const tail = truncateMockCustom(custom);
  return `${b(entry.personaPath)} + ${b(entry.instructionsPath)} + ${b(entry.outputSchemaPath)} + *${tail}*`;
}

/**
 * Deterministic stand-in for an LLM response (no HTTP). Used in OFFLINE / diagnostics.
 *
 * @param {object} input
 * @param {string} input.agentKey
 * @param {string} [input.userMessage]
 * @param {unknown} [input.machineStateSummary]
 * @param {{ persona?: string, instructions?: string, outputSchema?: string, prompts?: string }} [input.promptPaths]
 * @param {Record<string, unknown>} [input.llmSafeState]
 * @param {string} [input.custom] Same custom tail as `composeAgentPrompt` (for mock query line when `mockQueryBody` omitted).
 * @param {string} [input.mockQueryBody] Full mock-query stack string (e.g. from `formatAttacheMockQueryBody`); not truncated.
 * @returns {string}
 */
function buildMockAgentReply({
  agentKey,
  userMessage,
  machineStateSummary,
  promptPaths,
  llmSafeState,
  custom,
  mockQueryBody,
}) {
  void promptPaths;
  const mockQuery =
    mockQueryBody !== undefined && mockQueryBody !== null
      ? String(mockQueryBody)
      : formatMockQueryLine(agentKey, custom);
  return [
    `[Mock LLM] ${String(agentKey)}`,
    formatMockUserLine(userMessage),
    `State:\n${prettyJsonForMock(machineStateSummary ?? null)}`,
    `Mock query (persona + instructions + turn schema + custom):\n${formatMockQueryStack(mockQuery)}`,
    `LLM-safe state:\n${prettyJsonForMock(llmSafeState != null ? llmSafeState : {})}`,
  ].join("\n");
}

/**
 * Compose prompt + paths for an agent key (no attaché turn instruction — use `runAttacheTurn` for attaché).
 *
 * @param {string} agentKey
 * @param {string} userMessage
 * @param {unknown} [machineStateSummary]
 * @param {{ session?: object, internalState?: object }} [composeOptions] — passed to `composeAgentPrompt` / turn builder (e.g. detective turn count)
 * @returns {string}
 */
function buildMockReplyFromRegistry(agentKey, userMessage, machineStateSummary, composeOptions = {}) {
  const session =
    composeOptions && composeOptions.session && typeof composeOptions.session === "object"
      ? composeOptions.session
      : {};
  const internalState =
    composeOptions && composeOptions.internalState && typeof composeOptions.internalState === "object"
      ? composeOptions.internalState
      : {};

  let custom = "";
  if (agentKey === "detective") {
    try {
      custom = buildAgentTurn({ agentKey, session, internalState }).custom;
    } catch (_) {
      custom = "";
    }
  }

  const composed = composeAgentPrompt({
    agentKey,
    session,
    internalState,
    custom: custom || undefined,
  });
  const reg = getPromptRegistryEntry(agentKey);
  return buildMockAgentReply({
    agentKey,
    userMessage,
    machineStateSummary: machineStateSummary ?? null,
    promptPaths: reg
      ? {
          persona: reg.personaPath,
          instructions: reg.instructionsPath,
          outputSchema: reg.outputSchemaPath,
          prompts: reg.promptsPath,
        }
      : {},
    llmSafeState: composed.llmSafeState,
    custom: "",
  });
}

module.exports = {
  buildMockAgentReply,
  buildMockReplyFromRegistry,
  formatMockQueryLine,
  truncateMockCustom,
};
