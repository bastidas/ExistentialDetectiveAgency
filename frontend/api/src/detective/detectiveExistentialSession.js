"use strict";

/**
 * In-memory persisted [`detectiveMachine`](./detectiveMachine.js) snapshot per chat session.
 * Single source of truth for:
 * - `existentialTherapyPhase` (initial | middle | final)
 * - `instructionIds` (return-state ids from detective `prompt_catalog.json`), updated each turn via `POLICY_TURN`.
 * - Phase suggestion streak (two consecutive matching `suggest_existential_phase` values before a transition).
 *
 * Reset when attaché hands off to detective again (`resetDetectiveExistentialPhaseForAttacheHandoff`).
 */

const { createActor } = require("xstate");
const { detectiveMachine, isLegalNeighborPhaseTransition } = require("./detectiveMachine");
const { computeDetectiveCatalogInstructionIds } = require("./detectivePromptPolicy");
const { normalizeExistentialTherapyPhaseId } = require("./existentialTherapyPhaseContent");
const { userHasPersistedDossier } = require("../dossier_and_summarize/dossierPresence");
const { isDossierCreatedAtStaleEnoughForFinal } = require("../dossier_and_summarize/dossierRecency");

const detectiveOrchestratorSnapshotBySessionId = new Map();

/** @type {Map<string, { lastSuggested: string | null, runLength: number }>} */
const phaseSuggestionStreakBySessionId = new Map();

/**
 * @param {string|null|undefined} sessionId
 * @returns {string|null}
 */
function sessionKey(sessionId) {
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}

/**
 * @param {string|null|undefined} sessionId
 * @returns {"initial"|"middle"|"final"}
 */
function getExistentialTherapyPhaseForSession(sessionId) {
  const key = sessionKey(sessionId);
  if (!key) return "initial";
  const snap = detectiveOrchestratorSnapshotBySessionId.get(key);
  if (!snap || typeof snap !== "object") return "initial";
  const ctx = /** @type {{ context?: { existentialTherapyPhase?: string } }} */ (snap).context;
  if (ctx && typeof ctx === "object" && ctx.existentialTherapyPhase) {
    const p = String(ctx.existentialTherapyPhase);
    if (p === "initial" || p === "middle" || p === "final") return p;
  }
  return "initial";
}

/**
 * Last resolved return-policy catalog ids from the orchestrator (same snapshot as phase).
 *
 * @param {string|null|undefined} sessionId
 * @returns {string[]}
 */
function getDetectivePromptInstructionIdsForSession(sessionId) {
  const key = sessionKey(sessionId);
  if (!key) return [];
  const snap = detectiveOrchestratorSnapshotBySessionId.get(key);
  if (!snap || typeof snap !== "object") return [];
  const ctx = /** @type {{ context?: { instructionIds?: string[] } }} */ (snap).context;
  const ids = ctx && typeof ctx === "object" && Array.isArray(ctx.instructionIds) ? ctx.instructionIds : [];
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}

/**
 * @param {import("xstate").Actor<typeof detectiveMachine>} actor
 * @param {string} key
 */
function persistDetectiveSnapshot(actor, key) {
  try {
    detectiveOrchestratorSnapshotBySessionId.set(
      key,
      typeof actor.getPersistedSnapshot === "function"
        ? actor.getPersistedSnapshot()
        : actor.getSnapshot()
    );
  } catch {
    detectiveOrchestratorSnapshotBySessionId.delete(key);
  }
}

/**
 * @param {string|null|undefined} sessionId
 * @param {"initial"|"middle"|"final"} targetPhase
 */
function sendSetExistentialPhaseAndPersist(sessionId, targetPhase) {
  const key = sessionKey(sessionId);
  if (!key) return;
  const t =
    targetPhase === "initial" || targetPhase === "middle" || targetPhase === "final" ? targetPhase : null;
  if (!t) return;
  const prev = detectiveOrchestratorSnapshotBySessionId.get(key);
  const actor = createActor(detectiveMachine, prev !== undefined ? { snapshot: prev } : {});
  actor.start();
  actor.send({ type: "SET_EXISTENTIAL_PHASE", payload: { targetPhase: t } });
  persistDetectiveSnapshot(actor, key);
  actor.stop();
}

/**
 * @param {"initial"|"middle"|"final"} from
 * @param {"initial"|"middle"|"final"} to
 * @param {{ hasDossier: boolean, dossier: object | null, nowMs: number }} ctx
 * @returns {boolean}
 */
function guardsAllowExistentialPhaseTransition(from, to, ctx) {
  if (!isLegalNeighborPhaseTransition(from, to)) return false;
  if (to === "middle" && from === "initial") {
    return ctx.hasDossier === true;
  }
  if (to === "final" && from === "middle") {
    if (!ctx.hasDossier) return false;
    return isDossierCreatedAtStaleEnoughForFinal(ctx.dossier, ctx.nowMs);
  }
  return true;
}

/**
 * @param {string|null|undefined} sessionId
 */
function clearPhaseSuggestionStreak(sessionId) {
  const key = sessionKey(sessionId);
  if (key) phaseSuggestionStreakBySessionId.delete(key);
}

/**
 * Run one `POLICY_TURN` on the persisted orchestrator and return `instructionIds` for `composeAgentPrompt`.
 * Stateless callers (no session id) get a one-shot policy result without persisting.
 *
 * @param {string|null|undefined} sessionId
 * @param {import("./detectivePromptPolicy").DetectivePromptPolicyPayload} payload
 * @returns {string[]}
 */
function runDetectivePromptPolicyTurn(sessionId, payload) {
  const key = sessionKey(sessionId);
  const p = payload && typeof payload === "object" ? payload : {};
  if (!key) {
    return computeDetectiveCatalogInstructionIds(p);
  }

  const prev = detectiveOrchestratorSnapshotBySessionId.get(key);
  let actor;
  try {
    actor = createActor(detectiveMachine, prev !== undefined ? { snapshot: prev } : {});
  } catch {
    detectiveOrchestratorSnapshotBySessionId.delete(key);
    actor = createActor(detectiveMachine);
  }
  actor.start();
  actor.send({ type: "POLICY_TURN", payload: p });
  const ids = actor.getSnapshot().context.instructionIds || [];
  try {
    persistDetectiveSnapshot(actor, key);
  } catch {
    detectiveOrchestratorSnapshotBySessionId.delete(key);
  }
  actor.stop();
  return Array.isArray(ids) ? ids : [];
}

/**
 * Clear policy snapshot only — same map as existential session; prefer {@link clearDetectiveExistentialSession}.
 *
 * @param {string|null|undefined} sessionId
 */
function clearDetectivePromptPolicySnapshot(sessionId) {
  clearDetectiveExistentialSession(sessionId);
}

/**
 * After a successful detective LLM turn, record `suggest_existential_phase` and apply a transition only after
 * two consecutive matching suggestions and server-side guards (dossier, dossier `meta.createdAt` age for final).
 *
 * @param {string|null|undefined} sessionId
 * @param {unknown} suggestedRaw — structured output `suggest_existential_phase`
 * @param {{ hasDossier?: boolean, dossier?: object | null, nowMs?: number }} [eligibilityContext]
 */
function applyExistentialPhaseSuggestionAfterDetectiveTurn(sessionId, suggestedRaw, eligibilityContext) {
  const key = sessionKey(sessionId);
  if (!key) return;
  const ec = eligibilityContext && typeof eligibilityContext === "object" ? eligibilityContext : {};
  const hasDossier =
    ec.hasDossier === true ||
    (ec.dossier != null && typeof ec.dossier === "object" && userHasPersistedDossier(ec.dossier));
  const dossier = ec.dossier != null && typeof ec.dossier === "object" ? ec.dossier : null;
  const nowMs =
    typeof ec.nowMs === "number" && Number.isFinite(ec.nowMs) ? ec.nowMs : Date.now();

  const current = getExistentialTherapyPhaseForSession(sessionId);
  const suggested = normalizeExistentialTherapyPhaseId(suggestedRaw);

  if (suggested === current) {
    clearPhaseSuggestionStreak(sessionId);
    return;
  }

  const st = phaseSuggestionStreakBySessionId.get(key) || { lastSuggested: null, runLength: 0 };
  if (suggested === st.lastSuggested) {
    st.runLength += 1;
  } else {
    st.lastSuggested = suggested;
    st.runLength = 1;
  }
  phaseSuggestionStreakBySessionId.set(key, st);

  if (st.runLength < 2) return;

  if (
    !guardsAllowExistentialPhaseTransition(current, suggested, {
      hasDossier,
      dossier,
      nowMs,
    })
  ) {
    clearPhaseSuggestionStreak(sessionId);
    return;
  }

  sendSetExistentialPhaseAndPersist(sessionId, suggested);
  clearPhaseSuggestionStreak(sessionId);
}

/**
 * Dev / lab: advance one step along initial→middle→final (no dossier guards). Used by orchestration lab snapshot.
 *
 * @param {string|null|undefined} sessionId
 */
function advanceExistentialPhaseOneStepForLab(sessionId) {
  const cur = getExistentialTherapyPhaseForSession(sessionId);
  const next = cur === "initial" ? "middle" : cur === "middle" ? "final" : null;
  if (next) sendSetExistentialPhaseAndPersist(sessionId, next);
}

/**
 * Call when attaché prelude completes and the next routing is detective (including return-from-absence re-baseline).
 * Clears persisted snapshot so the next detective turn starts at `initial`.
 *
 * @param {string|null|undefined} sessionId
 */
function resetDetectiveExistentialPhaseForAttacheHandoff(sessionId) {
  const key = sessionKey(sessionId);
  if (!key) return;
  detectiveOrchestratorSnapshotBySessionId.delete(key);
  phaseSuggestionStreakBySessionId.delete(key);
}

/**
 * @param {string|null|undefined} sessionId
 */
function clearDetectiveExistentialSession(sessionId) {
  const key = sessionKey(sessionId);
  if (!key) return;
  detectiveOrchestratorSnapshotBySessionId.delete(key);
  phaseSuggestionStreakBySessionId.delete(key);
}

/**
 * Dev / lab: align persisted detective orchestrator phase with scenario preset (Apply seed).
 * Uses `SET_EXISTENTIAL_PHASE` transitions (initial→middle→final as needed).
 *
 * @param {string|null|undefined} sessionId
 * @param {"initial"|"middle"|"final"} targetPhase
 */
function setExistentialTherapyPhaseForLabSession(sessionId, targetPhase) {
  const key = sessionKey(sessionId);
  if (!key) return;
  const t =
    targetPhase === "middle" || targetPhase === "final" || targetPhase === "initial"
      ? targetPhase
      : "initial";

  detectiveOrchestratorSnapshotBySessionId.delete(key);
  clearPhaseSuggestionStreak(sessionId);
  const actor = createActor(detectiveMachine);
  actor.start();
  let snap =
    typeof actor.getPersistedSnapshot === "function"
      ? actor.getPersistedSnapshot()
      : actor.getSnapshot();
  actor.stop();

  if (t === "initial") {
    detectiveOrchestratorSnapshotBySessionId.set(key, snap);
    return;
  }

  const step = createActor(detectiveMachine, { snapshot: snap });
  step.start();
  step.send({ type: "SET_EXISTENTIAL_PHASE", payload: { targetPhase: "middle" } });
  if (t === "final") {
    step.send({ type: "SET_EXISTENTIAL_PHASE", payload: { targetPhase: "final" } });
  }
  const next =
    typeof step.getPersistedSnapshot === "function"
      ? step.getPersistedSnapshot()
      : step.getSnapshot();
  step.stop();
  detectiveOrchestratorSnapshotBySessionId.set(key, next);
}

/**
 * Dev / lab: raw persisted detective orchestrator snapshot (or null).
 *
 * @param {string|null|undefined} sessionId
 * @returns {unknown|null}
 */
function getDetectiveOrchestratorSnapshotForSession(sessionId) {
  const key = sessionKey(sessionId);
  if (!key) return null;
  const snap = detectiveOrchestratorSnapshotBySessionId.get(key);
  return snap !== undefined ? snap : null;
}

module.exports = {
  getExistentialTherapyPhaseForSession,
  getDetectivePromptInstructionIdsForSession,
  getDetectiveOrchestratorSnapshotForSession,
  runDetectivePromptPolicyTurn,
  clearDetectivePromptPolicySnapshot,
  applyExistentialPhaseSuggestionAfterDetectiveTurn,
  advanceExistentialPhaseOneStepForLab,
  resetDetectiveExistentialPhaseForAttacheHandoff,
  clearDetectiveExistentialSession,
  setExistentialTherapyPhaseForLabSession,
};
