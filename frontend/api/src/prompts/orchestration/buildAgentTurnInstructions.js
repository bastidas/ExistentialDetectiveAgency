"use strict";

const { getPromptRegistryEntry, loadJson } = require("../promptRegistry");
const { getDetectiveTurnInstructions } = require("../../detective/detectivePrompts");
const { fillTemplate } = require("../../attache/attachePrompts");
const { getPromptPattern, buildPromptContextFromState } = require("../../attache/attachePromptContext");
const { getRandomIntroLine } = require("../../attache/attacheOpeningLines");
const {
  resolveSpecialInstructionEntries,
  buildDetectiveSessionForTurnInstructions,
  buildAttacheSessionForTurnInstructions,
} = require("../promptCatalogUtils");

const PRE_ATTACHE_TURN_INSTRUCTIONS = "# TURN INSTRUCTIONS\n";

function joinNonEmpty(parts) {
  return parts.map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
}

/**
 * Full detective `# TURN INSTRUCTIONS` block: return catalog + existential therapy + optional scene guidance from `prompt_catalog.json`
 * (only when `shouldInjectDetectiveOpeningSceneGuidance`: first detective turn, `visit_bin === brief`, no dossier; all LLM-facing).
 * Single entry point for `composeAgentPrompt` and `buildAgentTurn` (mock parity).
 * WARNING: content is sent to the model — see `detective/detectivePrompts.js` header before adding meta.
 *
 * @param {object|undefined|null} session
 * @param {object|undefined|null} internalState
 * @returns {string}
 */
function buildDetectiveTurnInstructionBlock(session, internalState) {
  const sessionForBuild = buildDetectiveSessionForTurnInstructions(session, internalState);
  const entry = getPromptRegistryEntry("detective");
  const catalog = entry ? loadJson(entry.catalogPath) : null;
  const ids = Array.isArray(sessionForBuild.detective_prompt_instruction_ids)
    ? sessionForBuild.detective_prompt_instruction_ids
    : [];
  const catalogEntries = resolveSpecialInstructionEntries(
    catalog && typeof catalog === "object" ? catalog : {},
    ids
  );
  return getDetectiveTurnInstructions("detective", sessionForBuild, internalState, {
    catalogEntries,
    instructionCatalog: catalog && typeof catalog === "object" ? catalog : null,
  });
}

/**
 * Full attaché `# TURN INSTRUCTIONS` block from `prompt_catalog.json` + template fill (`{baselineN_*}`, `{random_opening_line}`).
 * Single entry point for `composeAgentPrompt` and parity with `buildDetectiveTurnInstructionBlock`.
 * WARNING: content is sent to the model.
 *
 * @param {object|undefined|null} session
 * @param {object|undefined|null} internalState
 * @returns {string}
 */
function buildAttacheTurnInstructionBlock(session, internalState) {
  const sessionForBuild = buildAttacheSessionForTurnInstructions(session, internalState);
  const entry = getPromptRegistryEntry("attache");
  const catalog = entry ? loadJson(entry.catalogPath) : null;
  const ids = Array.isArray(sessionForBuild.attache_prompt_instruction_ids)
    ? sessionForBuild.attache_prompt_instruction_ids
    : [];
  const catalogEntries = resolveSpecialInstructionEntries(
    catalog && typeof catalog === "object" ? catalog : {},
    ids
  );

  const s = sessionForBuild && typeof sessionForBuild === "object" ? sessionForBuild : {};
  const attacheState =
    s.attacheState && typeof s.attacheState === "object" ? s.attacheState : null;
  const pattern = getPromptPattern(attacheState);
  const baselineHint = pattern && pattern.baselineNumber != null ? pattern.baselineNumber : null;
  const baseCtx = buildPromptContextFromState(attacheState, s, baselineHint);

  const randomFromSession =
    s.random_opening_line != null && String(s.random_opening_line).trim() !== ""
      ? String(s.random_opening_line).trim()
      : null;
  const random_opening_line =
    randomFromSession != null ? randomFromSession : (getRandomIntroLine() || "").trim();

  const attache_turn_count =
    typeof s.attache_turn_count === "number" && Number.isFinite(s.attache_turn_count)
      ? Math.max(0, Math.trunc(s.attache_turn_count))
      : 0;
  const attache_close_count =
    typeof s.attache_close_count === "number" && Number.isFinite(s.attache_close_count)
      ? s.attache_close_count
      : 0;

  const templateCtx = {
    ...baseCtx,
    random_opening_line,
    attache_turn_count,
    attache_close_count,
  };

  /** @type {string[]} */
  const parallelBlocks = [];
  for (const e of catalogEntries) {
    const title = e && e.title != null ? String(e.title).trim() : "";
    const rawBody = e && e.body != null ? String(e.body) : "";
    const body = fillTemplate(rawBody, templateCtx).trim();
    if (!body) continue;
    parallelBlocks.push(title ? `### ${title}\n\n${body}` : body);
  }

  let block = PRE_ATTACHE_TURN_INSTRUCTIONS;
  block += joinNonEmpty(parallelBlocks) + "\n";
  return block;
}

module.exports = {
  buildDetectiveTurnInstructionBlock,
  buildAttacheTurnInstructionBlock,
};
