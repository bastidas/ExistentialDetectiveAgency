"use strict";

/**
 * Preview exact LLM payload slices for the dev scenario lab (no session mutation).
 * Uses shared `buildComposedPromptPreviewPayload` so all agents share one preview shape.
 */

const { composeAgentPrompt } = require("./prompts/promptComposer");
const { computeDetectiveCatalogInstructionIds } = require("./detective/detectivePromptPolicy");
const { buildPhilosophersCustomPrompt } = require("./philosophers/philosophersCustomPrompt");
const { buildComposedPromptPreviewPayload } = require("./agents/llmPayloadPreview");
const {
  createInitialAttacheSessionState,
  composeAttacheSystemPromptForSession,
} = require("./attache/attacheRuntime");
const { createAttacheState, computeCurrentPhaseId } = require("./attache/attacheMachine");
const { createEmptyDossier, normalizeDossier } = require("./dossier_and_summarize/dossier");
const { buildDossierSnippet } = require("./dossier_and_summarize/dossier");
const {
  pickExistentialTherapyPhase,
  pickNarrativePhase,
} = require("./chatScenarioLabPhases");
const { classifyTimeAway, getTimeAwayThresholds } = require("./orchestration/timeAwayClassification");
const { runChatTurn } = require("./orchestration/chatMachine");
const { classifyFromSessionAndDossier } = require("./session/returnClassification");
const { isDossierStaleByAge } = require("./dossier_and_summarize/dossierRecency");

/**
 * Same ms derivation as `chatTestSeed.deriveMs` (avoid importing `chatTestSeed` — circular with this module).
 *
 * @param {object} preset
 * @returns {number}
 */
function deriveLabPresetMs(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  if (typeof p.msSinceLastVisit === "number" && Number.isFinite(p.msSinceLastVisit)) {
    return Math.max(0, p.msSinceLastVisit);
  }
  const bin = p.timeAwayBin;
  if (typeof bin === "string" && bin.length > 0) {
    const { briefMs, moderateMs, longMs } = getTimeAwayThresholds();
    switch (bin) {
      case "brief":
        return Math.min(1000, Math.max(0, briefMs - 1));
      case "moderate":
        return briefMs + Math.floor((moderateMs - briefMs) / 2);
      case "long":
        return moderateMs + Math.floor((longMs - moderateMs) / 2);
      case "stale":
        return longMs + 60 * 60 * 1000;
      default:
        return 0;
    }
  }
  return 0;
}

/**
 * Mirrors `chatService.temporalGreetingModeForDetective` (kept local to avoid pulling in chatService).
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
 * Map lab UI phase keys → attaché machine state (see `chat-scenario.html` options).
 *
 * @param {string} phaseKey
 * @returns {object}
 */
function attacheStateFromLabPhase(phaseKey) {
  const p = String(phaseKey || "start");
  if (p === "close_final") {
    return createAttacheState({
      phase: "close",
      phase_before_close: "baseline3",
      question_index_before_close: 0,
    });
  }
  if (p === "close") {
    return createAttacheState({
      phase: "close",
      phase_before_close: "baseline1",
    });
  }
  return createAttacheState({ phase: p });
}

/**
 * Optional lab fields merged onto attaché state (`potential_next_phase`, `question_index`).
 * `n_questions_in_baseline` comes from attaché machine defaults only (not lab overrides).
 *
 * @param {object} attacheState
 * @param {object} preset
 * @returns {object}
 */
function mergeAttacheLabOverrides(attacheState, preset) {
  const base = attacheState && typeof attacheState === "object" ? { ...attacheState } : {};
  const p = preset && typeof preset === "object" ? preset : {};
  if (p.potential_next_phase != null && String(p.potential_next_phase).trim() !== "") {
    const v = String(p.potential_next_phase).trim();
    const allowed = new Set(["baseline1", "baseline2", "baseline3", "close"]);
    if (allowed.has(v)) {
      base.potential_next_phase = v;
    }
  }
  if (typeof p.question_index === "number" && Number.isFinite(p.question_index) && p.question_index >= 0) {
    base.question_index = Math.floor(p.question_index);
  }
  base.current_phase_id = computeCurrentPhaseId(base);
  return base;
}

/**
 * Full preset → attaché domain state for lab preview and seed (includes optional overrides).
 *
 * @param {object} preset
 * @returns {object}
 */
function attacheStateFromLabPreset(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  const phaseKey =
    typeof p.attachePhase === "string" && p.attachePhase.trim() !== "" ? p.attachePhase.trim() : "start";
  const base = attacheStateFromLabPhase(phaseKey);
  return mergeAttacheLabOverrides(base, p);
}

/**
 * Validate optional attaché override fields on a preset (for HTTP dev routes).
 *
 * @param {object} preset
 * @returns {{ error: string }|null}
 */
function validateAttachePresetOverrides(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  if (p.potential_next_phase != null && String(p.potential_next_phase).trim() !== "") {
    const allowed = new Set(["baseline1", "baseline2", "baseline3", "close"]);
    if (!allowed.has(String(p.potential_next_phase).trim())) {
      return { error: "Invalid potential_next_phase." };
    }
  }
  if (p.question_index != null) {
    if (typeof p.question_index !== "number" || !Number.isFinite(p.question_index) || p.question_index < 0) {
      return { error: "Invalid question_index." };
    }
  }
  return null;
}

/**
 * Same routing derivation as `seedSessionScenario` (without side effects).
 *
 * @param {object} p
 * @returns {"attache"|"detective"}
 */
function deriveActiveAgent(p) {
  if (typeof p.baselineCompleted === "boolean") {
    return p.baselineCompleted ? "detective" : "attache";
  }
  return p.activeAgent === "detective" ? "detective" : "attache";
}

/**
 * Same session shape as `buildPhilosopherComposeSession` in chatService when there is no
 * persisted narrative snapshot (turn 0 → `Exposition`) and optional dossier — used only for lab preview.
 *
 * @param {boolean} hasDossier
 * @param {object} preset — lab preset (for `narrativePhase`)
 * @returns {Record<string, unknown>}
 */
function buildPhilosopherSessionForLabPreview(hasDossier, preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  /** @type {Record<string, unknown>} */
  const session = {
    narrative_phase: pickNarrativePhase(p),
  };
  if (hasDossier) {
    const base = createEmptyDossier("preview");
    base.meta.lastBaselineCompletedAt = Date.now();
    session.dossier_summary = buildDossierSnippet(normalizeDossier(base, "preview"));
  }
  return session;
}

/**
 * Lab-only: attaché + detective completed-turn counts (mirrors server maps for closure math).
 *
 * @param {object} p
 * @returns {{ attache_exchange_count: number, detective_turn_count: number, total_turn_count: number }}
 */
function labTurnCountsFromPreset(p) {
  const preset = p && typeof p === "object" ? p : {};
  const attRaw = preset.attacheTurnCount;
  const detRaw = preset.detectiveTurnCount;
  const att =
    typeof attRaw === "number" && Number.isFinite(attRaw) && attRaw >= 0 ? Math.floor(attRaw) : 0;
  const det =
    typeof detRaw === "number" && Number.isFinite(detRaw) && detRaw >= 0 ? Math.floor(detRaw) : 0;
  return {
    attache_exchange_count: att,
    detective_turn_count: det,
    total_turn_count: att + det,
  };
}

const DEFAULT_MAX_USER_EXCHANGES = 1_000_000;

/**
 * Same cap as production `chatService` / `MAX_USER_EXCHANGES`. Preset may set `maxUserExchanges`
 * so the lab matches without relying on `process.env` (e.g. in tests).
 *
 * @param {object} preset
 * @returns {number}
 */
function resolveLabMaxUserExchanges(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  if (typeof p.maxUserExchanges === "number" && Number.isFinite(p.maxUserExchanges) && p.maxUserExchanges >= 0) {
    return Math.floor(p.maxUserExchanges);
  }
  const env = Number(process.env.MAX_USER_EXCHANGES);
  if (typeof env === "number" && Number.isFinite(env) && env >= 0) return Math.floor(env);
  return DEFAULT_MAX_USER_EXCHANGES;
}

/**
 * Mirrors `chatService.detectiveClosurePhaseFromExchangeSum`: uses **attaché + detective**
 * completed turns vs cap (not detective count alone).
 *
 * @param {{ attache_exchange_count: number, detective_turn_count: number }} counts
 * @param {number} maxEx
 * @returns {"penultimate"|"ultimate"|null}
 */
function labClosurePhaseFromTurnCounts(counts, maxEx) {
  const sumBefore = counts.attache_exchange_count + counts.detective_turn_count;
  if (maxEx < 1) return null;
  if (sumBefore === maxEx - 1) return "penultimate";
  if (sumBefore === maxEx) return "ultimate";
  return null;
}

/**
 * Mirrors `chatService.composeChatResponse`: when completed attaché + detective exchanges before
 * the next reply satisfy `sumBefore >= maxEx + 1`, the API returns HTTP 204 and runs no assistant LLM.
 *
 * @param {{ attache_exchange_count: number, detective_turn_count: number }} counts
 * @param {number} maxEx
 * @returns {boolean}
 */
function labNoAssistantLlmDueToExchangeCap(counts, maxEx) {
  const sumBefore = counts.attache_exchange_count + counts.detective_turn_count;
  return sumBefore >= maxEx + 1;
}

/**
 * Build preview of what would be sent to the LLM for the next turn.
 *
 * @param {object} preset
 * @returns {object}
 */
function buildPromptPreviewFromPreset(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  const hasDossier = p.hasDossier === true;
  const activeAgent = deriveActiveAgent(p);
  const labTurnCounts = labTurnCountsFromPreset(p);
  const maxEx = resolveLabMaxUserExchanges(p);
  if (labNoAssistantLlmDueToExchangeCap(labTurnCounts, maxEx)) {
    return {
      noAssistantLlm: true,
      activeAgent,
      title: "No assistant LLM (session exchange cap)",
      labTurnCounts,
      labMaxUserExchanges: maxEx,
    };
  }

  if (activeAgent === "detective") {
    const ms = deriveLabPresetMs(p);
    const visitTier = classifyTimeAway(ms);
    const nowMs = Date.now();
    let dossierForClassification = null;
    let dossierStale = false;
    if (hasDossier) {
      const base = createEmptyDossier("preview");
      base.meta.lastBaselineCompletedAt = Date.now();
      dossierForClassification = normalizeDossier(base, "preview");
      dossierStale = isDossierStaleByAge(dossierForClassification, nowMs);
    }
    const classification = classifyFromSessionAndDossier(
      { msSinceLastVisit: ms },
      dossierForClassification,
      new Date(nowMs)
    );
    const detTurnRaw = p.detectiveTurnCount;
    const detTurn =
      typeof detTurnRaw === "number" && Number.isFinite(detTurnRaw) && detTurnRaw >= 0
        ? Math.floor(detTurnRaw)
        : 0;
    const closurePhase = labClosurePhaseFromTurnCounts(labTurnCounts, maxEx);
    /** @type {Record<string, unknown>} */
    const sessionPayload = {
      detective_turn_count: detTurn,
      detective_first_turn: detTurn === 0,
      closure_phase: closurePhase || undefined,
      existential_therapy_phase: pickExistentialTherapyPhase(p),
      visit_bin: visitTier.bin,
      ms_since_last_visit: ms,
      time_away_context_line: visitTier.description,
      temporal_greeting_mode: temporalGreetingModeForDetective(
        visitTier.bin,
        dossierStale,
        hasDossier
      ),
      dossier_stale_by_age: dossierStale,
      lastReturnClassification: { returnCategory: classification.returnCategory },
    };
    if (hasDossier && dossierForClassification) {
      sessionPayload.dossier_summary = buildDossierSnippet(dossierForClassification);
    }
    sessionPayload.detective_prompt_instruction_ids = computeDetectiveCatalogInstructionIds({
      visit_bin: visitTier.bin,
      temporal_greeting_mode: sessionPayload.temporal_greeting_mode,
      dossier_stale_by_age: dossierStale,
      returnCategory: classification.returnCategory,
      closure_phase: closurePhase,
    });
    const composed = composeAgentPrompt({
      agentKey: "detective",
      session: sessionPayload,
      internalState: {},
      debugContext: { activeAgent: "detective" },
    });
    const primary = buildComposedPromptPreviewPayload({
      activeAgent: "detective",
      title: "Detective — next turn LLM payload (preview)",
      composed,
    });

    const philSession = buildPhilosopherSessionForLabPreview(hasDossier, p);
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

    return {
      ...primary,
      labTurnCounts,
      labMaxUserExchanges: maxEx,
      labClosurePhase: closurePhase,
      parallelPhilosophers: [
        buildComposedPromptPreviewPayload({
          activeAgent: "lumen",
          title: "Lumen — parallel LLM (same turn as detective)",
          composed: composedLumen,
        }),
        buildComposedPromptPreviewPayload({
          activeAgent: "umbra",
          title: "Umbra — parallel LLM (same turn as detective)",
          composed: composedUmbra,
        }),
      ],
    };
  }

  const attacheState = attacheStateFromLabPreset(p);
  /** Same time-away + classification as detective preview so return-tier catalog ids match the form. */
  const ms = deriveLabPresetMs(p);
  const visitTier = classifyTimeAway(ms);
  const nowMs = Date.now();
  let dossierForClassification = null;
  let dossierStale = false;
  if (hasDossier) {
    const base = createEmptyDossier("preview");
    base.meta.lastBaselineCompletedAt = Date.now();
    dossierForClassification = normalizeDossier(base, "preview");
    dossierStale = isDossierStaleByAge(dossierForClassification, nowMs);
  }
  const classification = classifyFromSessionAndDossier(
    { msSinceLastVisit: ms },
    dossierForClassification,
    new Date(nowMs)
  );

  const sessionState = createInitialAttacheSessionState({
    attacheState,
    /** Lab "Attaché turn #" drives start-phase second-turn baseline copy and policy parity with server session. */
    attache_turn_count: labTurnCounts.attache_exchange_count,
    visit_bin: visitTier.bin,
    ms_since_last_visit: ms,
    time_away_context_line: visitTier.description,
  });
  sessionState.dossier_stale_by_age = dossierStale;
  sessionState.lastReturnClassification = { returnCategory: classification.returnCategory };
  if (hasDossier && dossierForClassification) {
    sessionState.dossier_summary = buildDossierSnippet(dossierForClassification);
  }

  const composed = composeAttacheSystemPromptForSession(sessionState);
  return {
    ...buildComposedPromptPreviewPayload({
      activeAgent: "attache",
      title: "Attaché — next turn LLM payload (preview)",
      composed,
      phaseId: composed.attacheState && composed.attacheState.current_phase_id,
    }),
    labTurnCounts,
    labMaxUserExchanges: maxEx,
  };
}

/**
 * Dry-run `chatMachine.runChatTurn` with preset ms/dossier — does not persist snapshot (`persist: false`).
 * Use after POST `/api/dev/chat-scenario` seed so `sessionId` has a snapshot to restore; envelope reflects routing.
 *
 * @param {string|null|undefined} sessionId
 * @param {object} preset
 * @returns {{ visit_bin: string, ms_since_last_visit: number, time_away_description: string, envelope: object }}
 */
function previewChatMachineRouting(sessionId, preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  const ms = deriveLabPresetMs(p);
  const hasDossier = p.hasDossier === true;
  const sid = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : "preview";
  let dossier = null;
  if (hasDossier) {
    const base = createEmptyDossier(sid);
    base.meta.lastBaselineCompletedAt = Date.now();
    dossier = normalizeDossier(base, sid);
  }
  const tier = classifyTimeAway(ms);
  const turn = runChatTurn(sid, "__preview__", { msSinceLastVisit: ms, dossier, persist: false });
  return {
    visit_bin: tier.bin,
    ms_since_last_visit: ms,
    time_away_description: tier.description,
    envelope: turn.envelope,
  };
}

module.exports = {
  attacheStateFromLabPhase,
  mergeAttacheLabOverrides,
  attacheStateFromLabPreset,
  validateAttachePresetOverrides,
  deriveActiveAgent,
  deriveLabPresetMs,
  labTurnCountsFromPreset,
  resolveLabMaxUserExchanges,
  labClosurePhaseFromTurnCounts,
  labNoAssistantLlmDueToExchangeCap,
  buildPromptPreviewFromPreset,
  previewChatMachineRouting,
};
