"use strict";

/**
 * Pure policy: which attaché `prompt_catalog.json` instruction ids apply to this turn.
 * Combines return/time-away tier (legacy `instructionSelection` attache rules) with phase/baseline/close rows.
 *
 * Ordering: **return / stale tier first** (only when `attache_turn_count === 0`), then **phase / baseline / close**.
 * Return-tier rows (`ATTACHE_RETURN_*`, optional `ATTACHE_RETURN_APPEND_*`) must not repeat on later attaché turns.
 *
 * **Return tier layout:** For each qualifying first turn, policy emits one **primary** return id (visit bin / pending /
 * `returnCategory`), then **one dossier append** id (`ATTACHE_RETURN_APPEND_*`) so copy layers: greeting + bin story,
 * then a short dossier continuity line (no vs stale vs fresh file). Append ids are **last within the return tier block**
 * so phase instructions (`ATTACHE_START_ORIENTATION`, …) still follow the full return stack.
 *
 * **Catalog vs XState:** Instruction ids are resolved from **`AttacheState` + session facts** (visit bin, turn
 * counts, dossier flags). The attaché orchestrator machine mirrors `attacheState.phase` into its own nodes
 * (`intro` / `exploring` / …); it does **not** select catalog rows. Composed `# TURN INSTRUCTIONS` are the
 * **union** of rows for those ids (see `buildAttacheTurnInstructionBlock` + `fillTemplate` for placeholders
 * like `{baselineN_questionQ}`). Keep policy branching aligned with `transition()` in `attacheMachine.js`.
 *
 * **`stale_dossier_rebaseline`:** No longer maps to a separate catalog row; when set without other primary return
 * rows, policy uses `ATTACHE_RETURN_STALE_VISIT` plus dossier append (same story as pending + stale visit bin).
 */

const { computeCurrentPhaseId } = require("./attacheMachine");

/**
 * One short catalog line for dossier dimension on return / re-entry (turn 0 only).
 *
 * @param {boolean} hasDossier
 * @param {boolean} dossierStaleByAge
 * @returns {string}
 */
function computeDossierAppendInstructionId(hasDossier, dossierStaleByAge) {
  if (!hasDossier) return "ATTACHE_RETURN_APPEND_NO_DOSSIER";
  if (dossierStaleByAge) return "ATTACHE_RETURN_APPEND_STALE_DOSSIER";
  return "ATTACHE_RETURN_APPEND_FRESH_DOSSIER";
}

/**
 * Return-tier ids only: primary row(s) from visit bin / pending / `returnCategory`, then one dossier append when
 * any primary applies.
 * Mirrors `instructionSelection` for `agentKey === "attache"`.
 *
 * @param {Record<string, unknown>} facts
 * @returns {string[]}
 */
function computeAttacheReturnTierInstructionIds(facts) {
  const f = facts && typeof facts === "object" ? facts : {};
  /** @type {string[]} */
  const primary = [];
  const vb = f.visit_bin != null ? String(f.visit_bin).trim().toLowerCase() : "";
  const pending = f.baseline_return_greeting_pending === true;

  if (pending) {
    if (vb === "stale") primary.push("ATTACHE_RETURN_STALE_VISIT");
    else if (vb === "long") primary.push("ATTACHE_RETURN_LONG_GONE");
  }

  if (primary.length === 0 && vb === "moderate") {
    primary.push("ATTACHE_RETURN_DAY_OR_SO");
  }

  if (primary.length === 0) {
    const cat = f.returnCategory != null ? String(f.returnCategory) : "";
    if (cat === "moderate" || cat === "day_or_so" || cat === "DAY_OR_SO") {
      primary.push("ATTACHE_RETURN_DAY_OR_SO");
    }
    if (cat === "long" || cat === "long_gone" || cat === "LONG_GONE") {
      primary.push("ATTACHE_RETURN_LONG_GONE");
    }
  }

  if (primary.length === 0 && f.stale_dossier_rebaseline === true) {
    primary.push("ATTACHE_RETURN_STALE_VISIT");
  }

  if (primary.length === 0) {
    return [];
  }

  const appendId = computeDossierAppendInstructionId(
    f.has_dossier === true,
    f.dossier_stale_by_age === true
  );
  return [...primary, appendId];
}

/**
 * Phase/baseline/close ids from `AttacheState` (same branching as legacy `getSystemPrompt`).
 *
 * @param {object} input
 * @param {import("./attacheMachine").AttacheState|null|undefined} input.attacheState
 * @param {number} [input.attache_turn_count]
 * @param {number} [input.attache_close_count]
 * @returns {string[]}
 */
function computeAttachePhaseInstructionIds(input) {
  const p = input && typeof input === "object" ? input : {};
  const state = p.attacheState && typeof p.attacheState === "object" ? p.attacheState : null;
  const turnCount =
    typeof p.attache_turn_count === "number" && Number.isFinite(p.attache_turn_count)
      ? Math.max(0, Math.trunc(p.attache_turn_count))
      : 0;
  const closeCount =
    typeof p.attache_close_count === "number" && Number.isFinite(p.attache_close_count)
      ? p.attache_close_count
      : 0;

  /** @type {string[]} */
  const ids = [];

  if (!state) {
    ids.push("ATTACHE_START_ORIENTATION");
    return ids;
  }

  const phase = state.phase;
  if (phase === "start") {
    ids.push("ATTACHE_START_ORIENTATION");
    if (turnCount > 0) ids.push("ATTACHE_BASELINE_DELIVERY_START");
    return ids;
  }

  if (phase === "explore") {
    const mid =
      state.potential_next_phase && String(state.potential_next_phase).startsWith("baseline");
    if (mid) {
      ids.push("ATTACHE_EXPLORE_RESUME_BASELINE");
    } else {
      ids.push("ATTACHE_EXPLORE_GENERAL");
    }
    ids.push("ATTACHE_BASELINE_DELIVERY_START");
    return ids;
  }

  if (phase && String(phase).startsWith("baseline")) {
    const isMid = (state.question_index || 0) > 0;
    if (isMid) ids.push("ATTACHE_BASELINE_MID_QUESTION");
    else ids.push("ATTACHE_BASELINE_DELIVERY_START");
    return ids;
  }

  if (phase === "close") {
    const fromBaseline =
      state.phase_before_close && String(state.phase_before_close).startsWith("baseline");
    if (fromBaseline && state.phase_before_close !== "baseline3" && closeCount === 1) {
      ids.push("ATTACHE_CLOSE_EARLY_EXIT_CONFIRM");
    } else {
      const id = state.current_phase_id || computeCurrentPhaseId(state);
      if (id === "close_from_final_baseline3") ids.push("ATTACHE_CLOSE_FINAL");
      else ids.push("ATTACHE_CLOSE_DEFAULT");
    }
    return ids;
  }

  ids.push("ATTACHE_START_ORIENTATION");
  return ids;
}

/**
 * @typedef {Object} AttacheCatalogPolicyPayload
 * @property {import("./attacheMachine").AttacheState|null|undefined} [attacheState]
 * @property {number} [attache_turn_count]
 * @property {number} [attache_close_count]
 * @property {string} [visit_bin]
 * @property {boolean} [baseline_return_greeting_pending]
 * @property {boolean} [stale_dossier_rebaseline]
 * @property {boolean} [has_dossier]
 * @property {boolean} [dossier_stale_by_age]
 * @property {string} [returnCategory]
 */

/**
 * Full ordered id list for this attaché turn (return tier, then phase tier).
 *
 * @param {AttacheCatalogPolicyPayload} payload
 * @returns {string[]}
 */
function computeAttacheCatalogInstructionIds(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const attacheTurnCount =
    typeof p.attache_turn_count === "number" && Number.isFinite(p.attache_turn_count)
      ? Math.max(0, Math.trunc(p.attache_turn_count))
      : 0;

  const facts = {
    visit_bin: p.visit_bin != null ? String(p.visit_bin) : "",
    baseline_return_greeting_pending: p.baseline_return_greeting_pending === true,
    stale_dossier_rebaseline: p.stale_dossier_rebaseline === true,
    returnCategory: p.returnCategory != null ? String(p.returnCategory) : "",
    has_dossier: p.has_dossier === true,
    dossier_stale_by_age: p.dossier_stale_by_age === true,
  };

  /** Return / re-entry catalog copy only on the first attaché turn of the session. */
  const returnIds =
    attacheTurnCount === 0 ? computeAttacheReturnTierInstructionIds(facts) : [];

  const phaseIds = computeAttachePhaseInstructionIds({
    attacheState: p.attacheState,
    attache_turn_count: p.attache_turn_count,
    attache_close_count: p.attache_close_count,
  });

  return [...returnIds, ...phaseIds];
}

module.exports = {
  computeAttacheCatalogInstructionIds,
  computeAttacheReturnTierInstructionIds,
  computeAttachePhaseInstructionIds,
  computeDossierAppendInstructionId,
};
