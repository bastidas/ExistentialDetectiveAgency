"use strict";

const { extractReturnPromptFacts } = require("./returnPromptFacts");
const { computeDetectiveCatalogInstructionIds } = require("../detective/detectivePromptPolicy");
const { isDetectiveSessionFirstTurn } = require("../detective/detectiveSessionTurn");
const { computeAttacheCatalogInstructionIds } = require("../attache/attachePromptPolicy");
const { getAttachePromptInstructionIdsFromSnapshot } = require("../attache/attacheMachine");

/**
 * @param {object|null|undefined} catalogJson
 * @param {string[]} instructionIds
 * @returns {string[]}
 */
function resolveSpecialInstructionBodies(catalogJson, instructionIds) {
  const entries =
    catalogJson && catalogJson.entries && typeof catalogJson.entries === "object"
      ? catalogJson.entries
      : {};
  const blocks = [];
  if (!Array.isArray(instructionIds)) return blocks;
  for (const id of instructionIds) {
    const key = id != null ? String(id).trim() : "";
    if (!key) continue;
    const entry = entries[key];
    if (!entry || typeof entry !== "object") continue;
    const body = entry.body == null ? "" : String(entry.body).trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

/**
 * @param {object|null|undefined} catalogJson
 * @param {string[]} instructionIds
 * @returns {{ id: string, title: string, body: string }[]}
 */
function resolveSpecialInstructionEntries(catalogJson, instructionIds) {
  const map =
    catalogJson && catalogJson.entries && typeof catalogJson.entries === "object"
      ? catalogJson.entries
      : {};
  const out = [];
  if (!Array.isArray(instructionIds)) return out;
  for (const id of instructionIds) {
    const key = id != null ? String(id).trim() : "";
    if (!key) continue;
    if (/^EXISTENTIAL_THERAPY_/i.test(key)) continue;
    const entry = map[key];
    if (!entry || typeof entry !== "object") continue;
    const body = entry.body == null ? "" : String(entry.body).trim();
    // Intentionally blank catalog rows (tags include `allow_empty_body`) omit a `###` block—same as skipping here.
    if (!body) continue;
    const title = entry.title == null ? "" : String(entry.title).trim();
    out.push({ id: key, title, body });
  }
  return out;
}

/**
 * Same session merge as `composeAgentPrompt` for detective: effective `detective_prompt_instruction_ids`
 * when omitted (from return/time-away facts).
 *
 * @param {object|undefined|null} session
 * @param {object|undefined|null} internalState
 * @returns {Record<string, unknown>}
 */
function buildDetectiveSessionForTurnInstructions(session, internalState) {
  const sess = session && typeof session === "object" ? session : {};
  const facts = extractReturnPromptFacts(session, internalState);
  const firstDetective = isDetectiveSessionFirstTurn(sess);

  let effectiveIds = Array.isArray(sess.detective_prompt_instruction_ids)
    ? sess.detective_prompt_instruction_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : null;

  if (effectiveIds == null) {
    effectiveIds = firstDetective
      ? computeDetectiveCatalogInstructionIds({
          visit_bin: facts.visit_bin != null ? String(facts.visit_bin) : "",
          temporal_greeting_mode:
            facts.temporal_greeting_mode != null ? String(facts.temporal_greeting_mode) : "",
          dossier_stale_by_age: facts.dossier_stale_by_age === true,
          returnCategory: facts.returnCategory != null ? String(facts.returnCategory) : "",
        })
      : [];
  } else if (!firstDetective) {
    effectiveIds = effectiveIds.filter((id) => !/^DETECTIVE_RETURN_/i.test(String(id)));
  }

  const out = Object.assign({}, sess, {
    detective_prompt_instruction_ids: effectiveIds,
  });

  const clearVisitFacts = !firstDetective || !!sess.closure_phase;
  if (clearVisitFacts) {
    out.visit_bin = "";
    out.ms_since_last_visit = null;
    out.time_away_context_line = "";
    out.temporal_greeting_mode = "";
  }

  return out;
}

/**
 * Single precedence for attaché catalog ids: orchestrator snapshot (`ATTACHE_BEGIN_TURN`) wins, then explicit
 * `session.attache_prompt_instruction_ids`, then `computeAttacheCatalogInstructionIds` (tests / no snapshot).
 *
 * @param {object|undefined|null} session
 * @param {object|undefined|null} internalState
 * @returns {string[]}
 */
function resolveAttachePromptInstructionIdsForTurn(session, internalState) {
  const sess = session && typeof session === "object" ? session : {};
  const fromSnap = getAttachePromptInstructionIdsFromSnapshot(sess.attacheOrchestratorSnapshot);
  if (fromSnap.length > 0) return fromSnap;

  const explicit = Array.isArray(sess.attache_prompt_instruction_ids)
    ? sess.attache_prompt_instruction_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (explicit.length > 0) return explicit;

  const facts = extractReturnPromptFacts(sess, internalState);
  const attacheState =
    sess.attacheState && typeof sess.attacheState === "object" ? sess.attacheState : null;

  const attache_turn_count =
    typeof sess.attache_turn_count === "number" && Number.isFinite(sess.attache_turn_count)
      ? Math.max(0, Math.trunc(sess.attache_turn_count))
      : 0;
  const attache_close_count =
    typeof sess.attache_close_count === "number" && Number.isFinite(sess.attache_close_count)
      ? sess.attache_close_count
      : 0;

  return computeAttacheCatalogInstructionIds({
    attacheState,
    attache_turn_count,
    attache_close_count,
    visit_bin: facts.visit_bin != null ? String(facts.visit_bin) : "",
    baseline_return_greeting_pending: facts.baseline_return_greeting_pending === true,
    stale_dossier_rebaseline: facts.stale_dossier_rebaseline === true,
    returnCategory: facts.returnCategory != null ? String(facts.returnCategory) : "",
    has_dossier: facts.has_dossier === true,
    dossier_stale_by_age: facts.dossier_stale_by_age === true,
  });
}

/**
 * Same session merge as `composeAgentPrompt` for attaché: effective `attache_prompt_instruction_ids`
 * via {@link resolveAttachePromptInstructionIdsForTurn}.
 *
 * @param {object|undefined|null} session
 * @param {object|undefined|null} internalState
 * @returns {Record<string, unknown>}
 */
function buildAttacheSessionForTurnInstructions(session, internalState) {
  const sess = session && typeof session === "object" ? session : {};
  const effectiveIds = resolveAttachePromptInstructionIdsForTurn(sess, internalState);
  return Object.assign({}, sess, {
    attache_prompt_instruction_ids: effectiveIds,
  });
}

module.exports = {
  resolveSpecialInstructionBodies,
  resolveSpecialInstructionEntries,
  buildDetectiveSessionForTurnInstructions,
  buildAttacheSessionForTurnInstructions,
  resolveAttachePromptInstructionIdsForTurn,
};
