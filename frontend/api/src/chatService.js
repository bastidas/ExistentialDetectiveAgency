"use strict";

const { createActor } = require("xstate");
const {
  runChatTurn,
  notifyAttachePreludeComplete,
  getChatEnvelopeForSession,
} = require("./orchestration/chatMachine");
const { createChatPostSuccessBody } = require("../../contracts/chatApiContract");
const { runAttacheTurn } = require("./attache/attacheRuntime");
const {
  attacheOrchestratorMachine,
  transition,
  normalizeIntent,
} = require("./attache/attacheMachine");
const { buildMockReplyFromRegistry } = require("./agents/mockAgentTurn");
const { composeAgentPrompt } = require("./prompts/promptComposer");
const { createDetectiveCall } = require("./detective/detectiveCall");
const { philosophersNarrativeMachine } = require("./philosophers/philosophersMachine");
const { buildPhilosophersCustomPrompt } = require("./philosophers/philosophersCustomPrompt");
const { createPhilosopherCall } = require("./philosophers/philosophersCall");
const config = require("./config");
const logger = require("./logger");
const {
  createEmptyDossier,
  normalizeDossier,
  runDossierAnalyzer,
  user_dossier_updater,
  buildDossierSnippet,
} = require("./dossier_and_summarize/dossier");
const { narrativePhaseFromTurn, narrativeTurnForPhaseLabel } = require("./narrativePhases");
const { pickExistentialTherapyPhase, pickNarrativePhase } = require("./chatScenarioLabPhases");
const {
  getExistentialTherapyPhaseForSession,
  applyExistentialPhaseSuggestionAfterDetectiveTurn,
  resetDetectiveExistentialPhaseForAttacheHandoff,
  runDetectivePromptPolicyTurn,
  clearDetectivePromptPolicySnapshot,
  setExistentialTherapyPhaseForLabSession,
} = require("./detective/detectiveExistentialSession");
const { classifyTimeAway } = require("./orchestration/timeAwayClassification");
const { userHasPersistedDossier } = require("./dossier_and_summarize/dossierPresence");
const { isDossierStaleByAge } = require("./dossier_and_summarize/dossierRecency");
const { classifyFromSessionAndDossier } = require("./session/returnClassification");
const { createInitialAttacheSessionState } = require("./attache/attacheRuntime");
/**
 * @param {{ llmRefusal?: unknown }} body
 * @param {unknown[]} metas
 */
function mergeLlmRefusalIntoBody(body, metas) {
  const flat = (metas || []).filter(Boolean);
  if (!flat.length) return;
  body.llmRefusal = flat.length === 1 ? flat[0] : flat;
}

/**
 * Advance invoked attaché orchestrator snapshot from LLM output; align `attacheState` with runtime (authoritative).
 *
 * @param {unknown} prevSnapshot
 * @param {object|null|undefined} llmOutput
 * @param {object|undefined} authoritativeAttacheState — runtime `attacheState` (single source of truth)
 * @returns {unknown}
 */
function advanceAttacheOrchestratorSnapshot(prevSnapshot, llmOutput, authoritativeAttacheState) {
  if (!llmOutput || typeof llmOutput !== "object") return prevSnapshot;
  try {
    const actor = createActor(attacheOrchestratorMachine, prevSnapshot ? { snapshot: prevSnapshot } : {});
    actor.start();
    actor.send({ type: "ATTACHE_TURN", llmOutput });
    const out =
      typeof actor.getPersistedSnapshot === "function"
        ? actor.getPersistedSnapshot()
        : actor.getSnapshot();
    actor.stop();
    if (authoritativeAttacheState && out && typeof out === "object" && out.context) {
      return {
        ...out,
        context: { ...out.context, attacheState: authoritativeAttacheState },
      };
    }
    return out;
  } catch (_) {
    return prevSnapshot;
  }
}

/** In-memory attaché session (prelude state + history) until durable storage is wired through chat. */
const attacheSessionByChatSessionId = new Map();

/** In-memory dossier per session (seeded after attaché prelude when online). */
const dossierBySessionId = new Map();

/** Detective-phase chat history for live LLM context (user/assistant pairs). */
const detectiveChatHistoryBySessionId = new Map();

/** Lumen / Umbra chat histories for parallel philosopher LLM context. */
const lumenChatHistoryBySessionId = new Map();
const umbraChatHistoryBySessionId = new Map();

/** Persisted XState snapshot for [`philosophersNarrativeMachine`](./philosophers/philosophersMachine.js). */
const philosopherNarrativeSnapshotBySessionId = new Map();

/** Per chat session: how many detective turns have run (for first-turn TURN INSTRUCTIONS + opening line). */
const detectiveTurnCountByChatSessionId = new Map();

/** User messages handled while routing is attaché (sums with detective count for MAX_USER_EXCHANGES closure). */
const attacheExchangeCountByChatSessionId = new Map();

function getAttacheExchangeCount(sessionId) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return 0;
  const n = attacheExchangeCountByChatSessionId.get(id);
  return typeof n === "number" && n >= 0 ? n : 0;
}

function bumpAttacheExchangeCount(sessionId) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return;
  attacheExchangeCountByChatSessionId.set(id, getAttacheExchangeCount(sessionId) + 1);
}

function getDetectiveTurnCount(sessionId) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return 0;
  const n = detectiveTurnCountByChatSessionId.get(id);
  return typeof n === "number" && n >= 0 ? n : 0;
}

function bumpDetectiveTurnCount(sessionId) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return;
  detectiveTurnCountByChatSessionId.set(id, getDetectiveTurnCount(sessionId) + 1);
}

/**
 * Merge time-away / return facts onto attaché session for catalog + compose (same request as detective payload).
 *
 * @param {object|null} prev
 * @param {Record<string, unknown>} facts
 * @returns {Record<string, unknown>}
 */
function mergeAttacheVisitFacts(prev, facts) {
  const base = prev && typeof prev === "object" ? { ...prev } : {};
  const f = facts && typeof facts === "object" ? facts : {};
  return { ...base, ...f };
}

/**
 * Empty in-memory chat state for forced attaché re-baseline (stale visit always; long visit when no dossier or dossier stale by age).
 * @param {string} sessionId
 * @param {{ visitBin?: string, msSinceLastVisit?: number }} [opts]
 */
function clearSessionForAttacheRebaseline(sessionId, opts = {}) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return;
  const o = opts && typeof opts === "object" ? opts : {};
  const visitBinRaw = o.visitBin != null ? String(o.visitBin).trim().toLowerCase() : "long";
  const visitBin = visitBinRaw === "stale" ? "stale" : "long";
  const ms =
    typeof o.msSinceLastVisit === "number" && Number.isFinite(o.msSinceLastVisit)
      ? Math.max(0, o.msSinceLastVisit)
      : 0;
  detectiveChatHistoryBySessionId.delete(id);
  lumenChatHistoryBySessionId.delete(id);
  umbraChatHistoryBySessionId.delete(id);
  philosopherNarrativeSnapshotBySessionId.delete(id);
  detectiveTurnCountByChatSessionId.delete(id);
  attacheExchangeCountByChatSessionId.delete(id);
  dossierBySessionId.delete(id);
  attacheSessionByChatSessionId.set(
    id,
    createInitialAttacheSessionState({
      baseline_refresh_return_category: "LONG_GONE",
      baseline_return_greeting_pending: true,
      stale_dossier_rebaseline: false,
      visit_bin: visitBin,
      ms_since_last_visit: ms,
      time_away_context_line: classifyTimeAway(ms).description,
    })
  );
  resetDetectiveExistentialPhaseForAttacheHandoff(id);
  clearDetectivePromptPolicySnapshot(id);
}

/**
 * @param {string} visitBin
 * @param {boolean} dossierStaleByAge
 * @param {boolean} hasDossier
 * @returns {"none"|"continuation"|"long_absence"}
 */
function temporalGreetingModeForDetective(visitBin, dossierStaleByAge, hasDossier) {
  if (visitBin === "brief") return "none";
  if (!hasDossier || dossierStaleByAge) return "none";
  if (visitBin === "moderate") return "continuation";
  if (visitBin === "long" || visitBin === "stale") return "long_absence";
  return "none";
}

/**
 * @param {unknown} snapshot
 * @returns {number}
 */
function getNarrativeTurnFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return 0;
  const ctx = /** @type {{ context?: { narrativeTurn?: number } }} */ (snapshot).context;
  if (!ctx || typeof ctx !== "object") return 0;
  const n = /** @type {{ narrativeTurn?: number }} */ (ctx).narrativeTurn;
  return typeof n === "number" && n >= 0 ? n : 0;
}

/**
 * @param {string|null} sessionId
 * @param {object|null} dossier
 * @returns {Record<string, unknown>}
 */
function buildPhilosopherComposeSession(sessionId, dossier) {
  const snap = sessionId ? philosopherNarrativeSnapshotBySessionId.get(sessionId) : undefined;
  const narrativeTurn = getNarrativeTurnFromSnapshot(snap);
  /** @type {Record<string, unknown>} */
  const session = {
    narrative_phase: narrativePhaseFromTurn(narrativeTurn),
  };
  if (dossier) {
    session.dossier_summary = buildDossierSnippet(dossier);
  }
  return session;
}

/**
 * @param {string|null} sessionId
 */
function advancePhilosopherNarrative(sessionId) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return;
  const prev = philosopherNarrativeSnapshotBySessionId.get(id);
  const actor = createActor(philosophersNarrativeMachine, prev ? { snapshot: prev } : {});
  actor.start();
  actor.send({ type: "NARRATIVE_TURN" });
  let next;
  try {
    next =
      typeof actor.getPersistedSnapshot === "function"
        ? actor.getPersistedSnapshot()
        : actor.getSnapshot();
  } catch (_) {
    next = actor.getSnapshot();
  }
  philosopherNarrativeSnapshotBySessionId.set(id, next);
  actor.stop();
}

/**
 * Dev / lab: set philosophers narrative `turn` so `narrativePhaseFromTurn(turn)` matches the scenario preset.
 *
 * @param {string|null|undefined} sessionId
 * @param {number} targetTurn — non-negative; 0 = Exposition, etc.
 */
function setPhilosopherNarrativeTurnForLabSession(sessionId, targetTurn) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return;
  const n =
    typeof targetTurn === "number" && Number.isFinite(targetTurn) && targetTurn >= 0
      ? Math.floor(targetTurn)
      : 0;
  philosopherNarrativeSnapshotBySessionId.delete(id);
  const actor = createActor(philosophersNarrativeMachine);
  actor.start();
  for (let i = 0; i < n; i += 1) {
    actor.send({ type: "NARRATIVE_TURN" });
  }
  let next;
  try {
    next =
      typeof actor.getPersistedSnapshot === "function"
        ? actor.getPersistedSnapshot()
        : actor.getSnapshot();
  } catch (_) {
    next = actor.getSnapshot();
  }
  philosopherNarrativeSnapshotBySessionId.set(id, next);
  actor.stop();
}

/**
 * After `seedSessionScenario`, align persisted detective + philosopher orchestrators with lab controls
 * so orchestration snapshots / Mermaid match the scenario used for preview.
 *
 * @param {string|null|undefined} sessionId
 * @param {object} preset
 */
function syncLabDetectiveOrchestrationFromPreset(sessionId, preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  let activeAgent;
  if (typeof p.baselineCompleted === "boolean") {
    activeAgent = p.baselineCompleted ? "detective" : "attache";
  } else {
    activeAgent = p.activeAgent === "detective" ? "detective" : "attache";
  }
  if (activeAgent !== "detective") return;

  const rawEt = pickExistentialTherapyPhase(p);
  const et =
    rawEt === "initial" || rawEt === "middle" || rawEt === "final" ? rawEt : "initial";

  setExistentialTherapyPhaseForLabSession(sessionId, et);

  const narrLabel = pickNarrativePhase(p);
  const turns = narrativeTurnForPhaseLabel(narrLabel);
  setPhilosopherNarrativeTurnForLabSession(sessionId, turns);
}

/**
 * @param {string} sessionId
 * @param {object} nextSession — attaché `runAttacheTurn` session state
 * @param {import("openai").default} openaiClient
 */
async function seedDossierFromAttachePrelude(sessionId, nextSession, openaiClient) {
  try {
    const prev = dossierBySessionId.get(sessionId);
    const base = normalizeDossier(prev || createEmptyDossier(sessionId), sessionId);
    const chatHistory = Array.isArray(nextSession.chat_history) ? nextSession.chat_history : [];
    const analyzerOutput = await runDossierAnalyzer({
      userId: sessionId,
      recentMessages: chatHistory,
      currentDossier: base,
      openaiClient,
      recentMessageLimit: null,
    });
    const merged = user_dossier_updater(base, analyzerOutput, {
      baselineQuestionsAnswered: nextSession.baseline_answer_count,
      baselineQuestionStats: nextSession.baseline_question_stats,
      lastBaselineCompletedAt: Date.now(),
    });
    dossierBySessionId.set(sessionId, merged);
  } catch (err) {
    logger.warn(
      "chatService",
      "seedDossierFromAttachePrelude",
      err && err.message ? err.message : String(err)
    );
  }
}

/**
 * @param {string} sessionId
 * @param {string} message
 * @param {object} [options]
 * @param {boolean} [options.debug]
 * @param {number} [options.userExchangeCount]
 * @param {number} [options.dailyUsage]
 * @param {number} [options.maxUserExchanges]
 * @param {number} [options.maxDailyUsage]
 * @param {object|null} [options.dossier] — loaded dossier for orchestrator (optional; see dossierPresence.js)
 * @param {import("openai").default | null} [options.openaiClient]
 */
/**
 * @param {{ maxUserExchanges?: number }} options
 * @returns {number}
 */
function resolveMaxUserExchanges(options) {
  const m = options && options.maxUserExchanges;
  return typeof m === "number" && Number.isFinite(m) && m >= 0 ? Math.floor(m) : 1_000_000;
}

/**
 * @param {number} sumBefore — completed attaché + detective exchanges before this request’s reply.
 * @param {number} maxEx
 * @returns {"penultimate"|"ultimate"|null}
 */
function detectiveClosurePhaseFromExchangeSum(sumBefore, maxEx) {
  if (maxEx < 1) return null;
  if (sumBefore === maxEx - 1) return "penultimate";
  if (sumBefore === maxEx) return "ultimate";
  return null;
}

async function composeChatResponse(sessionId, message, options = {}) {
  /** @type {unknown[]} */
  const llmRefusalMetas = [];

  const maxEx = resolveMaxUserExchanges(options);
  const sumBefore = getAttacheExchangeCount(sessionId) + getDetectiveTurnCount(sessionId);
  /*
   * Past the ultimate (final) detective reply, return no assistant content (HTTP 204).
   * Optional future: a single random "easter egg" assistant line 3–10 user messages after the
   * ultimate response — not implemented yet.
   */
  if (sumBefore >= maxEx + 1) {
    return { status: 204, body: {} };
  }

  const msSinceLastVisit =
    typeof options.msSinceLastVisit === "number" && Number.isFinite(options.msSinceLastVisit)
      ? Math.max(0, options.msSinceLastVisit)
      : 0;

  let dossierForTurn =
    dossierBySessionId.get(sessionId) ?? (options.dossier != null ? options.dossier : null);
  const visitTier = classifyTimeAway(msSinceLastVisit);
  const wantsDossierPre = userHasPersistedDossier(dossierForTurn);
  const dossierStalePre = isDossierStaleByAge(dossierForTurn, Date.now());
  const forceAttacheRebaseline =
    visitTier.bin === "stale" ||
    (visitTier.bin === "long" && (!wantsDossierPre || dossierStalePre));

  if (forceAttacheRebaseline) {
    clearSessionForAttacheRebaseline(sessionId, {
      visitBin: visitTier.bin,
      msSinceLastVisit,
    });
    dossierForTurn = dossierBySessionId.get(sessionId) ?? null;
  }

  const turn = runChatTurn(sessionId, message, {
    msSinceLastVisit,
    dossier: dossierForTurn,
  });

  let reply = turn.reply;
  let envelope = turn.envelope;

  if (envelope.active_agent === "attache") {
    const prevRaw = attacheSessionByChatSessionId.get(sessionId) || null;
    const classificationAttache = classifyFromSessionAndDossier(
      { msSinceLastVisit },
      dossierForTurn,
      new Date()
    );
    const temporalAttache = temporalGreetingModeForDetective(
      visitTier.bin,
      dossierStalePre,
      wantsDossierPre
    );
    const prev = mergeAttacheVisitFacts(prevRaw, {
      visit_bin: visitTier.bin,
      ms_since_last_visit: msSinceLastVisit,
      time_away_context_line: visitTier.description,
      dossier_stale_by_age: dossierStalePre,
      temporal_greeting_mode: temporalAttache,
      lastReturnClassification: { returnCategory: classificationAttache.returnCategory },
    });
    const result = await runAttacheTurn({
      userMessage: message,
      sessionState: prev,
      openaiClient: options && options.openaiClient ? options.openaiClient : null,
    });
    const nextSession = {
      ...mergeAttacheVisitFacts(result.sessionState, {
        visit_bin: visitTier.bin,
        ms_since_last_visit: msSinceLastVisit,
        time_away_context_line: visitTier.description,
        dossier_stale_by_age: dossierStalePre,
        temporal_greeting_mode: temporalAttache,
        lastReturnClassification: { returnCategory: classificationAttache.returnCategory },
      }),
      attacheOrchestratorSnapshot: advanceAttacheOrchestratorSnapshot(
        prev && prev.attacheOrchestratorSnapshot,
        result.llmOutput,
        result.sessionState.attacheState
      ),
    };
    attacheSessionByChatSessionId.set(sessionId, nextSession);
    reply = result.user_response;
    if (result.sessionEnded) {
      if (!config.OFFLINE && options.openaiClient) {
        await seedDossierFromAttachePrelude(sessionId, nextSession, options.openaiClient);
      }
      notifyAttachePreludeComplete(sessionId);
      const refreshed = getChatEnvelopeForSession(sessionId);
      if (refreshed) {
        // Persisted routing is now detective for the *next* message, but this HTTP
        // response body still carries the attaché's closing `reply` — label it ATTACHÉ.
        envelope = {
          ...refreshed,
          active_agent: "attache",
          agent_label: "ATTACHÉ",
        };
      }
    }
    if (typeof reply !== "string" || !reply.trim()) {
      const phase =
        result.sessionState &&
        result.sessionState.attacheState &&
        result.sessionState.attacheState.phase
          ? result.sessionState.attacheState.phase
          : null;
      reply = buildMockReplyFromRegistry("attache", message, {
        note: "fallback_empty_attache_response",
        phase,
      });
    }
    const attRefusal =
      result.llmOutput && typeof result.llmOutput === "object" && result.llmOutput.llmRefusal
        ? result.llmOutput.llmRefusal
        : null;
    if (attRefusal) {
      llmRefusalMetas.push(attRefusal);
    }
    bumpAttacheExchangeCount(sessionId);
  } else if (envelope.active_agent === "detective") {
    const detTurn = getDetectiveTurnCount(sessionId);
    const closurePhase = detectiveClosurePhaseFromExchangeSum(sumBefore, maxEx);
    const dossier = dossierBySessionId.get(sessionId) ?? null;
    const nowMs = Date.now();
    const hasDossier = userHasPersistedDossier(dossier);
    const dossierStale = isDossierStaleByAge(dossier, nowMs);
    const classification = classifyFromSessionAndDossier(
      { msSinceLastVisit },
      dossier,
      new Date(nowMs)
    );
    /** @type {Record<string, unknown>} */
    const sessionPayload = {
      detective_turn_count: detTurn,
      detective_first_turn: detTurn === 0,
      closure_phase: closurePhase || undefined,
      existential_therapy_phase: getExistentialTherapyPhaseForSession(sessionId),
      visit_bin: visitTier.bin,
      ms_since_last_visit: msSinceLastVisit,
      time_away_context_line: visitTier.description,
      dossier_stale_by_age: dossierStale,
      temporal_greeting_mode: temporalGreetingModeForDetective(
        visitTier.bin,
        dossierStale,
        hasDossier
      ),
      lastReturnClassification: { returnCategory: classification.returnCategory },
    };
    if (dossier) {
      sessionPayload.dossier_summary = buildDossierSnippet(dossier);
    }

    sessionPayload.detective_prompt_instruction_ids = runDetectivePromptPolicyTurn(sessionId, {
      visit_bin: visitTier.bin,
      temporal_greeting_mode: sessionPayload.temporal_greeting_mode,
      dossier_stale_by_age: dossierStale,
      returnCategory: classification.returnCategory,
      closure_phase: closurePhase,
    });

    /** @type {Record<string, unknown>} */
    const philosopherWire = {};

    if (config.OFFLINE || !options.openaiClient) {
      reply = buildMockReplyFromRegistry(
        "detective",
        message,
        {
          active_agent: "detective",
          time_away_reply: turn.reply,
        },
        {
          session: sessionPayload,
          internalState: {},
        }
      );
    } else {
      const composed = composeAgentPrompt({
        agentKey: "detective",
        session: sessionPayload,
        internalState: {},
        debugContext: { activeAgent: "detective" },
      });
      const prevHist = detectiveChatHistoryBySessionId.get(sessionId) || [];
      const callDetective = createDetectiveCall(options.openaiClient, {
        userMessage: message,
        defaultExistentialPhase: sessionPayload.existential_therapy_phase,
      });

      const philSession = buildPhilosopherComposeSession(sessionId, dossier);
      const internalState = {};
      let lumenCustom = "";
      let umbraCustom = "";
      try {
        lumenCustom = buildPhilosophersCustomPrompt({
          agentKey: "lumen",
          activeVoice: "lumen",
          session: philSession,
        });
      } catch (_) {
        lumenCustom = "";
      }
      try {
        umbraCustom = buildPhilosophersCustomPrompt({
          agentKey: "umbra",
          activeVoice: "umbra",
          session: philSession,
        });
      } catch (_) {
        umbraCustom = "";
      }
      const composedLumen = composeAgentPrompt({
        agentKey: "lumen",
        session: philSession,
        internalState,
        custom: lumenCustom || undefined,
        debugContext: { activeAgent: "philosophers" },
      });
      const composedUmbra = composeAgentPrompt({
        agentKey: "umbra",
        session: philSession,
        internalState,
        custom: umbraCustom || undefined,
        debugContext: { activeAgent: "philosophers" },
      });

      const prevLumen = lumenChatHistoryBySessionId.get(sessionId) || [];
      const prevUmbra = umbraChatHistoryBySessionId.get(sessionId) || [];
      const callLumen = createPhilosopherCall(options.openaiClient, {
        userMessage: message,
        agentKey: "lumen",
      });
      const callUmbra = createPhilosopherCall(options.openaiClient, {
        userMessage: message,
        agentKey: "umbra",
      });

      const [out, lumenOut, umbraOut] = await Promise.all([
        callDetective({
          composed_system_prompt: composed.content,
          structured_outputs_response_format: composed.structuredOutputsResponseFormat,
          chat_history: prevHist.slice(),
        }),
        callLumen({
          composed_system_prompt: composedLumen.content,
          structured_outputs_response_format: composedLumen.structuredOutputsResponseFormat,
          chat_history: prevLumen.slice(),
        }),
        callUmbra({
          composed_system_prompt: composedUmbra.content,
          structured_outputs_response_format: composedUmbra.structuredOutputsResponseFormat,
          chat_history: prevUmbra.slice(),
        }),
      ]);

      const detReply =
        out && typeof out.detective_response === "string" ? out.detective_response : "";
      if (!detReply.trim()) {
        reply = buildMockReplyFromRegistry(
          "detective",
          message,
          {
            active_agent: "detective",
            time_away_reply: turn.reply,
          },
          {
            session: sessionPayload,
            internalState: {},
          }
        );
      } else {
        reply = detReply;
        const hist = prevHist.slice();
        hist.push({ role: "user", content: message });
        hist.push({ role: "assistant", content: reply });
        detectiveChatHistoryBySessionId.set(sessionId, hist);
        if (out && typeof out === "object") {
          applyExistentialPhaseSuggestionAfterDetectiveTurn(sessionId, out.suggest_existential_phase, {
            hasDossier: userHasPersistedDossier(dossier),
            dossier,
            nowMs,
          });
        }
      }

      Object.assign(philosopherWire, lumenOut || {}, umbraOut || {});

      if (out && typeof out === "object" && out.llmRefusal) {
        llmRefusalMetas.push(out.llmRefusal);
      }
      if (lumenOut && typeof lumenOut === "object" && lumenOut.llmRefusal) {
        llmRefusalMetas.push(lumenOut.llmRefusal);
      }
      if (umbraOut && typeof umbraOut === "object" && umbraOut.llmRefusal) {
        llmRefusalMetas.push(umbraOut.llmRefusal);
      }

      const lh = prevLumen.slice();
      lh.push({ role: "user", content: message });
      lh.push({
        role: "assistant",
        content:
          lumenOut && typeof lumenOut.lumenUserResponse === "string"
            ? lumenOut.lumenUserResponse
            : "",
      });
      lumenChatHistoryBySessionId.set(sessionId, lh);

      const uh = prevUmbra.slice();
      uh.push({ role: "user", content: message });
      uh.push({
        role: "assistant",
        content:
          umbraOut && typeof umbraOut.umbraUserResponse === "string"
            ? umbraOut.umbraUserResponse
            : "",
      });
      umbraChatHistoryBySessionId.set(sessionId, uh);
    }

    advancePhilosopherNarrative(sessionId);
    bumpDetectiveTurnCount(sessionId);

    const body = createChatPostSuccessBody({
      reply,
      envelope,
      ...philosopherWire,
      ...(closurePhase === "ultimate" ? { closureUltimate: true } : {}),
    });

    mergeLlmRefusalIntoBody(body, llmRefusalMetas);

    if (options.debug) {
      const userExchanges =
        typeof options.userExchangeCount === "number" ? options.userExchangeCount : 0;
      const maxUserExchanges =
        typeof options.maxUserExchanges === "number" ? options.maxUserExchanges : 1_000_000;
      const dailyUsage = typeof options.dailyUsage === "number" ? options.dailyUsage : 0;
      const maxDailyUsage =
        typeof options.maxDailyUsage === "number" ? options.maxDailyUsage : 1_000_000;
      body.debug = {
        userExchanges,
        maxUserExchanges,
        dailyUsage,
        maxDailyUsage,
      };
    }

    return { status: 200, body };
  }

  const body = createChatPostSuccessBody({
    reply,
    envelope,
  });

  mergeLlmRefusalIntoBody(body, llmRefusalMetas);

  if (options.debug) {
    const userExchanges =
      typeof options.userExchangeCount === "number" ? options.userExchangeCount : 0;
    const maxUserExchanges =
      typeof options.maxUserExchanges === "number" ? options.maxUserExchanges : 1_000_000;
    const dailyUsage = typeof options.dailyUsage === "number" ? options.dailyUsage : 0;
    const maxDailyUsage =
      typeof options.maxDailyUsage === "number" ? options.maxDailyUsage : 1_000_000;
    body.debug = {
      userExchanges,
      maxUserExchanges,
      dailyUsage,
      maxDailyUsage,
    };
  }

  return { status: 200, body };
}

/**
 * Dev / test: set or clear in-memory dossier for a session (used by `chatTestSeed`).
 * @param {string} sessionId
 * @param {object|null} dossier — normalized dossier or null to clear
 */
function setDossierForDevSession(sessionId, dossier) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return;
  if (dossier == null) {
    dossierBySessionId.delete(id);
  } else {
    dossierBySessionId.set(id, normalizeDossier(dossier, id));
  }
}

/**
 * Dev / test: replace attaché prelude session for a session id (used after orchestrator seed + phase picker).
 * @param {string} sessionId
 * @param {object|null|undefined} sessionState — full attaché session object or null to clear
 */
function setAttacheSessionForDevSession(sessionId, sessionState) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return;
  if (sessionState == null) {
    attacheSessionByChatSessionId.delete(id);
  } else {
    attacheSessionByChatSessionId.set(id, sessionState);
  }
}

/**
 * Dev / lab: current attaché prelude session object (or null).
 *
 * @param {string|null|undefined} sessionId
 * @returns {object|null}
 */
function getAttacheSessionForDevSession(sessionId) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return null;
  const s = attacheSessionByChatSessionId.get(id);
  return s != null && typeof s === "object" ? s : null;
}

/**
 * Dev / lab: persisted philosophers narrative machine snapshot (or null).
 *
 * @param {string|null|undefined} sessionId
 * @returns {unknown|null}
 */
function getPhilosopherNarrativeSnapshotForSession(sessionId) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) return null;
  const snap = philosopherNarrativeSnapshotBySessionId.get(id);
  return snap !== undefined ? snap : null;
}

/**
 * @param {string|null|undefined} sessionId
 * @returns {number}
 */
function getDetectiveTurnCountForSession(sessionId) {
  return getDetectiveTurnCount(sessionId);
}

/**
 * @param {string|null|undefined} sessionId
 * @returns {number}
 */
function getAttacheExchangeCountForSession(sessionId) {
  return getAttacheExchangeCount(sessionId);
}

/**
 * Dev / lab: simulate one attaché turn using `transition` + `advanceAttacheOrchestratorSnapshot` (same as live path).
 *
 * @param {string} sessionId
 * @param {"ATTACHE_TURN_BASELINE"|"ATTACHE_TURN_EXPLORE"|"ATTACHE_TURN_CLOSE"} type
 * @param {{ askedBaselineQuestion?: boolean }} [payload]
 */
function simulateAttacheLabStep(sessionId, type, payload) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) throw new Error("sessionId required");
  const prev = getAttacheSessionForDevSession(id);
  if (!prev || !prev.attacheState) throw new Error("No attaché session for this session");

  const p = payload && typeof payload === "object" ? payload : {};
  /** @type {{ user_intends_explore?: boolean, user_intends_close?: boolean, asked_baseline_question?: boolean }} */
  let llmOutput;
  if (type === "ATTACHE_TURN_EXPLORE") {
    llmOutput = { user_intends_explore: true, user_intends_close: false, asked_baseline_question: true };
  } else if (type === "ATTACHE_TURN_CLOSE") {
    llmOutput = { user_intends_explore: false, user_intends_close: true, asked_baseline_question: true };
  } else if (type === "ATTACHE_TURN_BASELINE") {
    llmOutput = {
      user_intends_explore: false,
      user_intends_close: false,
      asked_baseline_question: p.askedBaselineQuestion !== false,
    };
  } else {
    throw new Error("Invalid attaché lab step type");
  }

  const intent = normalizeIntent(llmOutput);
  const asked = llmOutput.asked_baseline_question !== false;
  const nextAttacheState = transition(prev.attacheState, intent, asked);
  const nextOrchSnap = advanceAttacheOrchestratorSnapshot(
    prev.attacheOrchestratorSnapshot,
    llmOutput,
    nextAttacheState
  );

  const nextSession = {
    ...prev,
    attacheState: nextAttacheState,
    attacheOrchestratorSnapshot: nextOrchSnap,
    attache_turn_count:
      typeof prev.attache_turn_count === "number" && prev.attache_turn_count >= 0
        ? prev.attache_turn_count + 1
        : 1,
  };
  setAttacheSessionForDevSession(id, nextSession);
}

/**
 * Dev / lab: advance `question_index` within the current baseline phase only (same as production
 * when the LLM asked a baseline question and there is another question slot in this block).
 * Does **not** roll baseline1→baseline2→baseline3→close; that requires {@link simulateAttacheLabStep}
 * with `ATTACHE_TURN_BASELINE` at the last question index (or when `n_questions_in_baseline === 1`).
 *
 * @param {string} sessionId
 */
function simulateAttacheLabAdvanceQuestionIndexWithinPhase(sessionId) {
  const id = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  if (!id) throw new Error("sessionId required");
  const prev = getAttacheSessionForDevSession(id);
  if (!prev || !prev.attacheState) throw new Error("No attaché session for this session");
  const s = prev.attacheState;
  const phase = s.phase;
  if (typeof phase !== "string" || !phase.startsWith("baseline")) {
    throw new Error(
      "Attaché phase must be baseline1, baseline2, or baseline3 to advance question index within phase."
    );
  }
  const q = typeof s.question_index === "number" ? s.question_index : 0;
  const n =
    typeof s.n_questions_in_baseline === "number" && s.n_questions_in_baseline > 0
      ? s.n_questions_in_baseline
      : 1;
  if (q + 1 >= n) {
    throw new Error(
      "Already at the last question for this baseline phase (or n_questions_in_baseline is 1). " +
        "Use ATTACHE_TURN_BASELINE for a full baseline turn (rolls to the next baseline phase when appropriate). " +
        "To step mid-baseline, seed n_questions_in_baseline ≥ 2."
    );
  }
  simulateAttacheLabStep(id, "ATTACHE_TURN_BASELINE", { askedBaselineQuestion: true });
}

module.exports = {
  composeChatResponse,
  setDossierForDevSession,
  setAttacheSessionForDevSession,
  getAttacheSessionForDevSession,
  getPhilosopherNarrativeSnapshotForSession,
  advancePhilosopherNarrative,
  setPhilosopherNarrativeTurnForLabSession,
  syncLabDetectiveOrchestrationFromPreset,
  simulateAttacheLabStep,
  simulateAttacheLabAdvanceQuestionIndexWithinPhase,
  getDetectiveTurnCountForSession,
  getAttacheExchangeCountForSession,
};
