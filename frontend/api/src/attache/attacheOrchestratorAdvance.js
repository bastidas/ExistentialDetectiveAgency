"use strict";

const { createActor } = require("xstate");
const {
  attacheOrchestratorMachine,
  migrateAttacheOrchestratorMachineSnapshot,
} = require("./attacheMachine");
const { extractReturnPromptFacts } = require("../prompts/returnPromptFacts");

/**
 * Build `ATTACHE_BEGIN_TURN` payload from attaché session (same facts as `buildAttacheSessionForTurnInstructions`).
 *
 * @param {object|null|undefined} sessionState
 * @returns {Record<string, unknown>}
 */
function buildAttacheOrchestratorBeginPayload(sessionState) {
  const s = sessionState && typeof sessionState === "object" ? sessionState : {};
  const facts = extractReturnPromptFacts(s, { mainState: { attache: { baselineCompleted: false } } });
  const attache_turn_count =
    typeof s.attache_turn_count === "number" && Number.isFinite(s.attache_turn_count)
      ? Math.max(0, Math.trunc(s.attache_turn_count))
      : 0;
  const attache_close_count =
    typeof s.attache_close_count === "number" && Number.isFinite(s.attache_close_count)
      ? s.attache_close_count
      : 0;
  return {
    attacheState: s.attacheState && typeof s.attacheState === "object" ? s.attacheState : undefined,
    attache_turn_count,
    attache_close_count,
    visit_bin: facts.visit_bin != null ? String(facts.visit_bin) : "",
    baseline_return_greeting_pending: facts.baseline_return_greeting_pending === true,
    stale_dossier_rebaseline: facts.stale_dossier_rebaseline === true,
    returnCategory: facts.returnCategory != null ? String(facts.returnCategory) : "",
    has_dossier: facts.has_dossier === true,
    dossier_stale_by_age: facts.dossier_stale_by_age === true,
  };
}

/**
 * Run `ATTACHE_BEGIN_TURN` on the attaché orchestrator so context holds `attachePromptInstructionIds`
 * for the outgoing system prompt (pre-transition).
 *
 * @param {unknown} prevSnapshot
 * @param {object|null|undefined} sessionState
 * @returns {unknown}
 */
function advanceAttacheOrchestratorForPromptTurn(prevSnapshot, sessionState) {
  try {
    const snap = prevSnapshot ? migrateAttacheOrchestratorMachineSnapshot(prevSnapshot) : undefined;
    const actor = createActor(attacheOrchestratorMachine, snap ? { snapshot: snap } : {});
    actor.start();
    actor.send({
      type: "ATTACHE_BEGIN_TURN",
      payload: buildAttacheOrchestratorBeginPayload(sessionState),
    });
    const out =
      typeof actor.getPersistedSnapshot === "function"
        ? actor.getPersistedSnapshot()
        : actor.getSnapshot();
    actor.stop();
    return out;
  } catch (_) {
    return prevSnapshot;
  }
}

module.exports = {
  buildAttacheOrchestratorBeginPayload,
  advanceAttacheOrchestratorForPromptTurn,
};
