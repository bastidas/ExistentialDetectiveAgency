"use strict";

/**
 * Dev-only: assemble in-memory orchestration snapshots for the chat scenario lab.
 * Reads the same maps as production for `sessionId` (no side effects).
 */

const { createActor } = require("xstate");
const { getPersistedChatMachineSnapshot, chatMachine } = require("./chatMachine");
const {
  getDetectiveOrchestratorSnapshotForSession,
  getExistentialTherapyPhaseForSession,
  getDetectivePromptInstructionIdsForSession,
} = require("../detective/detectiveExistentialSession");
const {
  getPhilosopherNarrativeSnapshotForSession,
  getAttacheSessionForDevSession,
  advancePhilosopherNarrative,
  simulateAttacheLabStep,
  simulateAttacheLabAdvanceQuestionIndexWithinPhase,
} = require("../chatService");
const { narrativePhaseFromTurn } = require("../narrativePhases");
const {
  runDetectivePromptPolicyTurn,
  advanceExistentialPhaseOneStepForLab,
} = require("../detective/detectiveExistentialSession");

/**
 * @param {unknown} snapshot
 * @returns {number}
 */
function narrativeTurnFromPhilosopherSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return 0;
  const ctx = /** @type {{ context?: { narrativeTurn?: number } }} */ (snapshot).context;
  if (!ctx || typeof ctx !== "object") return 0;
  const n = ctx.narrativeTurn;
  return typeof n === "number" && n >= 0 ? n : 0;
}

/**
 * @param {unknown} persisted
 * @returns {{ value: unknown, context: unknown } | null}
 */
function chatValueContextFromPersisted(persisted) {
  if (persisted == null) return null;
  try {
    const actor = createActor(chatMachine, { snapshot: persisted });
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    return { value: snap.value, context: snap.context };
  } catch {
    return null;
  }
}

/**
 * @param {string|null|undefined} sessionId
 * @returns {Record<string, unknown>}
 */
function buildOrchestrationLabSnapshot(sessionId) {
  const sid = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!sid) {
    return {
      sessionId: null,
      chat: null,
      detective: null,
      philosophers: null,
      attache: null,
    };
  }

  const chatRaw = getPersistedChatMachineSnapshot(sid);
  const chatParsed = chatValueContextFromPersisted(chatRaw);
  const chat =
    chatRaw != null
      ? {
          hasPersistedSnapshot: true,
          value: chatParsed ? chatParsed.value : undefined,
          context: chatParsed ? chatParsed.context : undefined,
        }
      : null;

  const detRaw = getDetectiveOrchestratorSnapshotForSession(sid);
  const detective =
    detRaw != null
      ? {
          hasPersistedSnapshot: true,
          snapshot: detRaw,
          existentialTherapyPhase: getExistentialTherapyPhaseForSession(sid),
          instructionIds: getDetectivePromptInstructionIdsForSession(sid),
        }
      : null;

  const philRaw = getPhilosopherNarrativeSnapshotForSession(sid);
  const nTurn = narrativeTurnFromPhilosopherSnapshot(philRaw);
  const philosophers =
    philRaw != null
      ? {
          hasPersistedSnapshot: true,
          snapshot: philRaw,
          narrativeTurn: nTurn,
          narrative_phase: narrativePhaseFromTurn(nTurn),
        }
      : null;

  const attSession = getAttacheSessionForDevSession(sid);
  let attache = null;
  if (attSession != null) {
    const st =
      attSession.attacheState && typeof attSession.attacheState === "object"
        ? attSession.attacheState
        : null;
    attache = {
      session: attSession,
      attacheState: st,
      current_phase_id: st && typeof st.current_phase_id === "string" ? st.current_phase_id : undefined,
    };
  }

  return {
    sessionId: sid,
    chat,
    detective,
    philosophers,
    attache,
  };
}

/**
 * Dev lab: apply one synthetic step and return fresh orchestration snapshot.
 *
 * @param {string} sessionId
 * @param {{ type?: string, payload?: object }} step
 * @returns {Record<string, unknown>}
 */
function runOrchestrationLabStep(sessionId, step) {
  const sid = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : "";
  if (!sid) {
    throw new Error("sessionId required");
  }
  const t = step && typeof step.type === "string" ? step.type.trim() : "";
  if (t === "DETECTIVE_POLICY_TURN") {
    const payload = step.payload && typeof step.payload === "object" ? step.payload : {};
    runDetectivePromptPolicyTurn(sid, payload);
  } else if (t === "DETECTIVE_PHASE_ADVANCE") {
    advanceExistentialPhaseOneStepForLab(sid);
  } else if (t === "PHILOSOPHER_NARRATIVE_TURN") {
    advancePhilosopherNarrative(sid);
  } else if (t === "ATTACHE_ADVANCE_QUESTION_INDEX") {
    simulateAttacheLabAdvanceQuestionIndexWithinPhase(sid);
  } else if (t === "ATTACHE_TURN_BASELINE" || t === "ATTACHE_TURN_EXPLORE" || t === "ATTACHE_TURN_CLOSE") {
    const payload = step.payload && typeof step.payload === "object" ? step.payload : {};
    simulateAttacheLabStep(sid, t, payload);
  } else {
    throw new Error("Invalid orchestration step type.");
  }
  return buildOrchestrationLabSnapshot(sid);
}

module.exports = {
  buildOrchestrationLabSnapshot,
  chatValueContextFromPersisted,
  runOrchestrationLabStep,
};
