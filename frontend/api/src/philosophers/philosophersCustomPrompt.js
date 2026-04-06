"use strict";

const { getPromptRegistryEntry, loadText } = require("../prompts/promptRegistry");

const MAX_PROMPTS_APPEND = 8000;

/**
 * Mock placeholder for Lumen/Umbra custom prompt tail.
 *
 * **Target pattern** (same contract as attaché / detective): persona + instructions + **dynamic tail**
 * where the tail is produced by the philosophers xstate machine (`philosophersMachine`) and passed as
 * `custom` into `composeAgentPrompt`, instead of this mock prefix + prompts file dump. Until that
 * lands, the registry `promptsPath` text is appended here for dev parity only.
 *
 * @param {object} input
 * @param {"lumen"|"umbra"} input.agentKey
 * @param {string} [input.activeVoice]
 * @param {object} [input.session]
 * @returns {string}
 */
function buildPhilosophersCustomPrompt({ agentKey, activeVoice, session: _session }) {
  const reg = getPromptRegistryEntry(agentKey);
  let promptsLib = reg && reg.promptsPath ? loadText(reg.promptsPath) : "";
  promptsLib = promptsLib.trim();
  if (promptsLib.length > MAX_PROMPTS_APPEND) {
    promptsLib = `${promptsLib.slice(0, MAX_PROMPTS_APPEND)}\n…`;
  }
  const head = `[mock custom ${agentKey}] voice=${String(activeVoice ?? "")}`;
  if (!promptsLib) return head;
  return `${head}\n\n${promptsLib}`;
}

module.exports = {
  buildPhilosophersCustomPrompt,
};
