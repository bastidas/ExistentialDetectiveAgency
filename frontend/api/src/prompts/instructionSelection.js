"use strict";

const { computeDetectiveCatalogInstructionIds } = require("../detective/detectivePromptPolicy");

/**
 * Select instruction catalog ids for this turn (per-agent `prompt_catalog.json` via registry `catalogPath`).
 * Detective ids are delegated to {@link computeDetectiveCatalogInstructionIds} (same policy as `detectiveMachine` `POLICY_TURN`).
 * Attaché ids are **not** selected here: `buildAttacheSessionForTurnInstructions` + `computeAttacheCatalogInstructionIds`
 * populate `session.attache_prompt_instruction_ids`; `buildSharedIdentityParts` uses that list (detective parity).
 *
 * @param {string} agentKey
 * @param {Record<string, unknown>} facts
 * @returns {string[]}
 */
function selectSpecialInstructions(agentKey, facts) {
  if (!facts || typeof facts !== "object") return [];

  if (agentKey === "detective") {
    return computeDetectiveCatalogInstructionIds({
      visit_bin: facts.visit_bin != null ? String(facts.visit_bin) : "",
      temporal_greeting_mode:
        facts.temporal_greeting_mode != null ? String(facts.temporal_greeting_mode) : "",
      dossier_stale_by_age: facts.dossier_stale_by_age === true,
      returnCategory: facts.returnCategory != null ? String(facts.returnCategory) : "",
    });
  }

  if (agentKey === "attache") {
    return [];
  }

  return [];
}

module.exports = {
  selectSpecialInstructions,
};
