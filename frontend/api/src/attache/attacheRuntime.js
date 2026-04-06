"use strict";

// Runtime wiring for the new attaché orchestrator.
// Bridges AttacheState + scenario prompts + attacheCall into
// a single per-turn helper used by chatService.

const path = require("path");
const fs = require("fs");

const config = require("../config");
const logger = require("../logger");
const { ansi } = logger;
const { createAttacheCall } = require("./attacheCall");
const {
  createAttacheState,
  transition,
  normalizeIntent,
  ATTACHE_MAX_TURNS,
  RANDOM_Q_ORDER,
  computeCurrentPhaseId,
  getBaselineNumberFromPhase,
  getRandomBaselineQuestionCount,
} = require("./attacheMachine");
const { getPromptPattern } = require("./attachePrompts");
const {
  buildPromptContextFromState,
} = require("./attachePromptContext");
const { composeAgentPrompt } = require("../prompts/promptComposer");
const { buildAgentTurn } = require("../prompts/turnBuilderRegistry");
const { buildMockAttacheLlmOutput } = require("./attacheMockLlmOutput");
const {
  getAttacheCustomStateInstructionsPlaceholder,
  formatAttacheMockQueryLine,
  formatAttacheMockQueryBody,
} = require("./attacheStateInstructions");
const { getPromptRegistryEntry } = require("../prompts/promptRegistry");
const { buildMockAgentReply } = require("../agents/mockAgentTurn");
const { getRandomIntroLine } = require("./attacheOpeningLines");

// Baseline question pools (`administerBaseline1` … `administerBaseline3`); counts per phase are
// drawn between MIN/MAX when entering each baseline (see `attacheMachine.transition`).
const ATTACHE_QUESTIONS_BANK = require("../../prompts/attache/attache_questions.json");
const ADMINISTER_BASELINE_KEYS = {
  1: "administerBaseline1",
  2: "administerBaseline2",
  3: "administerBaseline3",
};

/**
 * @param {1|2|3} baselineNumber
 * @returns {{ questions: string[] }|null}
 */
function getBaselineQuestionPoolEntry(baselineNumber) {
  const k = ADMINISTER_BASELINE_KEYS[baselineNumber];
  if (!k) return null;
  const entry = ATTACHE_QUESTIONS_BANK[k];
  if (!entry || !Array.isArray(entry.questions)) return null;
  return entry;
}

/** Same shape as dossier.meta.baselineQuestionStats (for persistence + consistency). */
function emptyBaselineQuestionStats() {
  return {
    askedTotal: 0,
    answeredTotal: 0,
    byBaseline: {
      1: { asked: 0, answered: 0 },
      2: { asked: 0, answered: 0 },
      3: { asked: 0, answered: 0 },
    },
  };
}

function cloneBaselineQuestionStats(s) {
  if (!s || typeof s !== "object") return emptyBaselineQuestionStats();
  try {
    return JSON.parse(JSON.stringify(s));
  } catch (_) {
    return emptyBaselineQuestionStats();
  }
}

function bumpBaselineQuestionStats(prev, baselineNum, { asked, answered }) {
  const base = prev
    ? JSON.parse(JSON.stringify(prev))
    : emptyBaselineQuestionStats();
  if (
    typeof baselineNum !== "number" ||
    baselineNum < 1 ||
    baselineNum > 3
  ) {
    return base;
  }
  if (asked) {
    base.byBaseline[baselineNum].asked += 1;
    base.askedTotal += 1;
  }
  if (answered) {
    base.byBaseline[baselineNum].answered += 1;
    base.answeredTotal += 1;
  }
  return base;
}

const ATTACHE_PROMPTS_DIR = path.join(config.PROMPTS_DIR, "attache");
const ATTACHE_INTRO_FILE = path.join(ATTACHE_PROMPTS_DIR, "attache_opening_lines.md");
const ATTACHE_FINAL_FILE = path.join(ATTACHE_PROMPTS_DIR, "attache_final_lines.md");

// Lazily loaded phil annotations (shared with frontend notes system) so
// we can reuse respondText entries as backend-driven phase notes.
let cachedPhilAnnotations = null;
function loadPhilAnnotations() {
  if (cachedPhilAnnotations) return cachedPhilAnnotations;
  try {
    if (config.PHIL_ANNOTATIONS_FILE && fs.existsSync(config.PHIL_ANNOTATIONS_FILE)) {
      const raw = fs.readFileSync(config.PHIL_ANNOTATIONS_FILE, "utf8");
      const data = JSON.parse(raw);
      cachedPhilAnnotations = Array.isArray(data) ? data : [];
    } else {
      cachedPhilAnnotations = [];
    }
  } catch (e) {
    cachedPhilAnnotations = [];
  }
  return cachedPhilAnnotations;
}

// Generic helper for simple one-line lists (used for final lines).
function loadLines(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const lines = raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      return lines.length ? lines : [];
    }
  } catch (_) {}
  return [];
}

function getRandomFinalLine() {
  const lines = loadLines(ATTACHE_FINAL_FILE);
  if (!lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * Compute one-time phase notes when transitioning into baseline1
 * (after baseline1's first question) and baseline2 at question_index 0.
 * Uses the first two entries in PHIL_ANNOTATIONS_FILE (if present) as
 * the note bodies.
 *
 * @param {import("./attacheMachine").AttacheState|undefined|null} prevState
 * @param {import("./attacheMachine").AttacheState|undefined|null} nextState
 * @returns {string[]} note texts to append (may be empty)
 */
function getPhaseNotesForTransition(prevState, nextState) {
  if (!nextState) return [];
  const rules = loadPhilAnnotations();
  const notes = [];

  const enteringBaseline1 =
    // Baseline1 "first note" should be queued after the first baseline
    // question has been asked (i.e. when question_index advances from 0→1).
    //
    // The attaché FSM sometimes enters baseline1 with question_index=1 in
    // the same turn that the first question is asked, so we also allow the
    // prev phase to be non-baseline1.
    nextState.phase === "baseline1" &&
    nextState.question_index === 1 &&
    (
      !prevState ||
      prevState.phase !== "baseline1" ||
      (prevState.phase === "baseline1" && prevState.question_index === 0)
    );

  const enteringBaseline2 =
    nextState.phase === "baseline2" &&
    nextState.question_index === 0 &&
    (!prevState || prevState.phase !== "baseline2");

  // Use first two rules' respondText as phase-1/phase-2 notes when available.
  if (enteringBaseline1 && rules[0] && rules[0].respondText) {
    notes.push(String(rules[0].respondText));
  }
  if (enteringBaseline2 && rules[1] && rules[1].respondText) {
    notes.push(String(rules[1].respondText));
  }

  return notes;
}

function makeDefaultBaselineQuestionCounts() {
  return {
    1: getRandomBaselineQuestionCount(1),
    2: getRandomBaselineQuestionCount(2),
    3: getRandomBaselineQuestionCount(3),
  };
}

function normalizeBaselineQuestionCounts(raw) {
  const fallback = makeDefaultBaselineQuestionCounts();
  if (!raw || typeof raw !== "object") return fallback;
  const out = { ...fallback };
  [1, 2, 3].forEach((n) => {
    const v = Number(raw[n]);
    if (Number.isFinite(v) && v > 0) out[n] = Math.floor(v);
  });
  return out;
}

function withPresetBaselineQuestionCount(state, baseline_question_counts) {
  if (!state || typeof state !== "object") return createAttacheState({});
  const baselineNum = getBaselineNumberFromPhase(state.phase);
  if (baselineNum == null) return createAttacheState(state);
  const counts = normalizeBaselineQuestionCounts(baseline_question_counts);
  const forcedCount = counts[baselineNum];
  return createAttacheState({ ...state, n_questions_in_baseline: forcedCount });
}

/**
 * Create an initial attaché session state.
 * Contains both the AttacheState (phase/question info) and
 * a simple chat_history array for the attaché prelude.
 */
function createInitialAttacheSessionState(options) {
  const baseline_question_counts = normalizeBaselineQuestionCounts(
    options && options.baseline_question_counts
  );
  const baseAttacheState = withPresetBaselineQuestionCount(
    createAttacheState(options && options.attacheState ? options.attacheState : {}),
    baseline_question_counts
  );

  // Pre-compute a random order of baseline question indices per baseline
  // when RANDOM_Q_ORDER is enabled. This order is then used by
  // getBaselineContextForState to decide which concrete question text
  // corresponds to a given question_index.
  let baseline_question_order = options && options.baseline_question_order
    ? options.baseline_question_order
    : null;
  if (!baseline_question_order) {
    baseline_question_order = {};
    [1, 2, 3].forEach((baselineNumber) => {
      const entry = getBaselineQuestionPoolEntry(
        /** @type {1|2|3} */ (baselineNumber)
      );
      if (!entry || !Array.isArray(entry.questions)) return;
      const indices = entry.questions.map((_, i) => i);
      if (RANDOM_Q_ORDER) {
        // Fisher-Yates shuffle
        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = indices[i];
          indices[i] = indices[j];
          indices[j] = tmp;
        }
      }
      const maxCount = baseline_question_counts[baselineNumber];
      baseline_question_order[baselineNumber] = indices.slice(0, maxCount);
    });
  }

  return {
    attacheState: baseAttacheState,
    chat_history: Array.isArray(options && options.chat_history)
      ? options.chat_history.slice()
      : [],
    // Total number of turns where user_intends_close was true.
    attache_close_count: typeof (options && options.attache_close_count) === "number"
      ? options.attache_close_count
      : 0,
    // Total number of attaché turns taken in this session (including
    // explore/baseline/close). Used together with ATTACHE_MAX_TURNS as
    // a hard cap to guarantee eventual handoff to the detective.
    attache_turn_count: typeof (options && options.attache_turn_count) === "number"
      ? options.attache_turn_count
      : 0,
    baseline_question_counts,
    baseline_question_order,
    // Count of baseline questions the user has answered. Used for
    // downstream logging (e.g., in the dossier meta).
    baseline_answer_count: typeof (options && options.baseline_answer_count) === "number"
      ? options.baseline_answer_count
      : 0,
    baseline_question_stats: cloneBaselineQuestionStats(
      options && options.baseline_question_stats
    ),
    // Return-policy: first LLM turn after baseline refresh gets an extra preamble.
    baseline_refresh_return_category:
      options && options.baseline_refresh_return_category != null
        ? String(options.baseline_refresh_return_category)
        : null,
    baseline_return_greeting_pending:
      options && options.baseline_return_greeting_pending === true,
    /** When true, attaché prompt includes `ATTACHE_STALE_DOSSIER_REBASELINE` (chatService re-baseline path). */
    stale_dossier_rebaseline: options && options.stale_dossier_rebaseline === true,
    /** Mirrors `classifyTimeAway` for this request (attaché catalog + LLM-safe state). */
    visit_bin: options && options.visit_bin != null ? String(options.visit_bin) : null,
    ms_since_last_visit:
      typeof (options && options.ms_since_last_visit) === "number" &&
      Number.isFinite(options.ms_since_last_visit)
        ? Math.max(0, options.ms_since_last_visit)
        : null,
    time_away_context_line:
      options && options.time_away_context_line != null ? String(options.time_away_context_line) : null,
    attacheOrchestratorSnapshot:
      options && options.attacheOrchestratorSnapshot != null
        ? options.attacheOrchestratorSnapshot
        : undefined,
  };
}

/**
 * Full multi-line `[Mock LLM] …` diagnostic (state + baseline question in `mockQueryBody`).
 * Used for OFFLINE and when the real/stub `createAttacheCall` returns an empty `user_response`
 * so `chatService` does not fall back to `buildMockReplyFromRegistry` (empty custom → `**`).
 */
function buildAttacheDiagnosticMockReply({
  state,
  userMessage,
  composedPrompt,
  customSegment,
  mockQueryBody,
  machineStateExtra,
}) {
  const phaseIdLocal = state.current_phase_id || computeCurrentPhaseId(state);
  const reg = getPromptRegistryEntry("attache");
  return buildMockAgentReply({
    agentKey: "attache",
    userMessage,
    machineStateSummary: {
      phase: state.phase,
      phaseId: phaseIdLocal,
      ...(machineStateExtra && typeof machineStateExtra === "object" ? machineStateExtra : {}),
    },
    promptPaths: reg
      ? {
          persona: reg.personaPath,
          instructions: reg.instructionsPath,
          outputSchema: reg.outputSchemaPath,
          prompts: reg.promptsPath,
        }
      : {},
    llmSafeState: composedPrompt.llmSafeState,
    custom: customSegment,
    mockQueryBody,
  });
}

/**
 * Build the attaché composed system prompt for a session snapshot (same path as `runAttacheTurn`, no LLM).
 *
 * @param {object} [sessionState] — attaché session (`attacheState`, `chat_history`, …); default initial.
 * @returns {{ content: string, outputSchema: object|null, structuredOutputsResponseFormat: object|null, llmSafeState: object|null, attacheState: object }}
 */
function composeAttacheSystemPromptForSession(sessionState) {
  const safeSession = sessionState || createInitialAttacheSessionState({});
  const baseline_question_counts = normalizeBaselineQuestionCounts(
    safeSession.baseline_question_counts
  );
  const state = withPresetBaselineQuestionCount(
    safeSession.attacheState && typeof safeSession.attacheState === "object"
      ? safeSession.attacheState
      : createAttacheState({}),
    baseline_question_counts
  );
  const pattern = getPromptPattern(state);
  const context = buildPromptContextFromState(state, safeSession, pattern.baselineNumber);
  context.attache_close_count =
    typeof safeSession.attache_close_count === "number" ? safeSession.attache_close_count : 0;
  context.attache_turn_count =
    typeof safeSession.attache_turn_count === "number" ? safeSession.attache_turn_count : 0;
  const question_at_hand =
    state.phase && state.phase.startsWith("baseline")
      ? context.baselineN_questionQ || null
      : null;

  const customStateInstructions = getAttacheCustomStateInstructionsPlaceholder(state.phase);

  const turnBuilt = buildAgentTurn({
    agentKey: "attache",
    state,
    context,
  });
  const customSegment = turnBuilt.custom;

  const pseudoSession = {
    ...safeSession,
    stale_dossier_rebaseline: !!safeSession.stale_dossier_rebaseline,
    lastReturnClassification:
      safeSession.lastReturnClassification &&
      typeof safeSession.lastReturnClassification === "object"
        ? safeSession.lastReturnClassification
        : safeSession.baseline_return_greeting_pending === true &&
            safeSession.baseline_refresh_return_category
          ? { returnCategory: safeSession.baseline_refresh_return_category }
          : null,
  };
  const composedPrompt = composeAgentPrompt({
    agentKey: "attache",
    session: pseudoSession,
    internalState: { mainState: { attache: { baselineCompleted: false } } },
    custom: customSegment,
    attacheTurnInstruction: {
      attachePromptFamilyKey: turnBuilt.metadata?.promptFamilyKey ?? null,
    },
    debugContext: { activeAgent: "attache" },
  });
  return {
    content: composedPrompt.content,
    outputSchema: composedPrompt.outputSchema,
    structuredOutputsResponseFormat: composedPrompt.structuredOutputsResponseFormat,
    llmSafeState: composedPrompt.llmSafeState,
    attacheState: state,
  };
}

/**
 * Single attaché turn: given the current session-level attaché state
 * and a user message, build the scenario-specific instruction,
 * call the LLM via attacheCall, and update AttacheState.
 *
 * The sessionEnded flag indicates when the attaché prelude should
 * hand off control to the detective system (after two closes).
 */
async function runAttacheTurn({ userMessage, sessionState, openaiClient }) {
  const safeSession = sessionState || createInitialAttacheSessionState({});
  const baseline_question_counts = normalizeBaselineQuestionCounts(
    safeSession.baseline_question_counts
  );
  const state = withPresetBaselineQuestionCount(
    safeSession.attacheState && typeof safeSession.attacheState === "object"
      ? safeSession.attacheState
      : createAttacheState({}),
    baseline_question_counts
  );
  const history = Array.isArray(safeSession.chat_history)
    ? safeSession.chat_history.slice()
    : [];

  const pattern = getPromptPattern(state);
  const context = buildPromptContextFromState(state, safeSession, pattern.baselineNumber);
  context.attache_close_count =
    typeof safeSession.attache_close_count === "number" ? safeSession.attache_close_count : 0;
  context.attache_turn_count =
    typeof safeSession.attache_turn_count === "number" ? safeSession.attache_turn_count : 0;
  const question_at_hand =
    state.phase && state.phase.startsWith("baseline")
      ? context.baselineN_questionQ || null
      : null;

  const customStateInstructions = getAttacheCustomStateInstructionsPlaceholder(state.phase);

  const turnBuilt = buildAgentTurn({
    agentKey: "attache",
    state,
    context,
  });
  const customSegment = turnBuilt.custom;
  const turn_instruction = customSegment;

  const mockQueryBody = formatAttacheMockQueryBody({
    customStateInstructions,
    baselineQuestion: question_at_hand,
  });
  const mockQueryLine = formatAttacheMockQueryLine({
    customStateInstructions,
    baselineQuestion: question_at_hand,
  });

  const is_phase_start =
    (state.phase === "baseline1" || state.phase === "baseline2" || state.phase === "baseline3") &&
    state.question_index === 0;

  const input = {
    chat_history: history,
    question_at_hand,
    phase_instructions: "",
    is_phase_start,
    next_phase_instructions: null,
    turn_instruction,
    mock_query: mockQueryLine,
  };
  const composedResult = composeAttacheSystemPromptForSession(safeSession);
  const composedPrompt = {
    content: composedResult.content,
    llmSafeState: composedResult.llmSafeState,
    structuredOutputsResponseFormat: composedResult.structuredOutputsResponseFormat,
  };
  input.composed_system_prompt = composedPrompt.content;
  input.structured_outputs_response_format = composedResult.structuredOutputsResponseFormat;

  const prevTurnCountForMock =
    typeof safeSession.attache_turn_count === "number" ? safeSession.attache_turn_count : 0;

  const callAttache = config.OFFLINE
    ? async () => {
        const diagnosticReply = buildAttacheDiagnosticMockReply({
          state,
          userMessage,
          composedPrompt,
          customSegment,
          mockQueryBody,
        });
        return {
          ...buildMockAttacheLlmOutput({ turnNumber: prevTurnCountForMock }),
          user_response: diagnosticReply,
        };
      }
    : createAttacheCall(openaiClient, { userMessage });

  if (config.DEBUG_LOGS) {
    const phaseIdBefore = state.current_phase_id || computeCurrentPhaseId(state);
    const patternKeyBefore = pattern && pattern.key ? pattern.key : "(no_pattern)";
    logger.info(
      "attacheRuntime",
      `${ansi.bold}${ansi.magenta}[ATTACHÉ REQUEST]${ansi.reset} ` +
        `${ansi.cyan}phase=${state.phase}[q=${state.question_index}]${ansi.reset} ` +
        `${ansi.yellow}pattern=${patternKeyBefore}${ansi.reset} ` +
        `${ansi.green}phase_id=${phaseIdBefore}${ansi.reset} ` +
        `${ansi.cyan}question_at_hand=${question_at_hand || "(none)"}${ansi.reset} ` +
        `${ansi.dim}${mockQueryLine}${ansi.reset}`
    );
  }

  const output = await callAttache(input);

  let userFacingResponse =
    typeof output.user_response === "string" ? output.user_response : "";
  if (!userFacingResponse.trim()) {
    userFacingResponse = buildAttacheDiagnosticMockReply({
      state,
      userMessage,
      composedPrompt,
      customSegment,
      mockQueryBody,
      machineStateExtra: { note: "empty_user_response_filled_with_diagnostic" },
    });
  }

  const intent = normalizeIntent(output);
  // Advance baseline question_index only when the LLM JSON sets asked_baseline_question
  // (see attache_turn.schema.json and attacheMachine.transition).
  const askedBaselineQuestion = !!output.asked_baseline_question;

  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: userFacingResponse });

  const nextAttacheState = withPresetBaselineQuestionCount(
    transition(state, intent, askedBaselineQuestion),
    baseline_question_counts
  );

  const prevCloseCount = typeof safeSession.attache_close_count === "number"
    ? safeSession.attache_close_count
    : 0;
  const nextCloseCount = prevCloseCount + (output.user_intends_close ? 1 : 0);
  const prevTurnCount = typeof safeSession.attache_turn_count === "number"
    ? safeSession.attache_turn_count
    : 0;
  const nextTurnCount = prevTurnCount + 1;

  // Track how many baseline questions the user has answered. We treat
  // a turn as answering a baseline question when we are currently in a
  // baseline phase, there is a concrete question_at_hand, and the user
  // message is non-empty.
  const prevAnswerCount = typeof safeSession.baseline_answer_count === "number"
    ? safeSession.baseline_answer_count
    : 0;
  const answeredThisTurn =
    state.phase && state.phase.startsWith("baseline") &&
    !!question_at_hand &&
    askedBaselineQuestion &&
    typeof userMessage === "string" &&
    userMessage.trim().length > 0;
  const nextAnswerCount = prevAnswerCount + (answeredThisTurn ? 1 : 0);

  const baselineNumForStats = getBaselineNumberFromPhase(state.phase);
  let baseline_question_stats =
    safeSession.baseline_question_stats || emptyBaselineQuestionStats();
  if (baselineNumForStats != null) {
    if (askedBaselineQuestion) {
      baseline_question_stats = bumpBaselineQuestionStats(
        baseline_question_stats,
        baselineNumForStats,
        { asked: true, answered: false }
      );
    }
    if (answeredThisTurn) {
      baseline_question_stats = bumpBaselineQuestionStats(
        baseline_question_stats,
        baselineNumForStats,
        { asked: false, answered: true }
      );
    }
  }

  // Attaché → detective handoff rule:
  // - Nominal completion (close_from_final_baseline3): we end after the
  //   turn where we are already in that state (attaché gave the closing
  //   speech). Do not wait for user_intends_close.
  // - Early/uncertain close: require two close intents (confirm then
  //   FINAL_CLOSE speech), then end.
  // - Safety cap: end after ATTACHE_MAX_TURNS turns.
  const phaseIdCurrent = state.current_phase_id || computeCurrentPhaseId(state);
  const endedByFinalBaseline =
    state.phase === "close" && phaseIdCurrent === "close_from_final_baseline3";
  // For return-policy baseline refresh sessions, allow a single explicit
  // close intent to hand control back to detective quickly.
  const closeThreshold =
    safeSession.baseline_refresh_return_category != null ? 1 : 2;
  const endedByClose = nextCloseCount >= closeThreshold;
  const endedByTurnCap = nextTurnCount >= ATTACHE_MAX_TURNS;
  const sessionEnded = endedByFinalBaseline || endedByClose || endedByTurnCap;

  // Clear return-greeting pending after the turn where the composed prompt
  // actually carried the return preamble (same condition as pseudoSession.lastReturnClassification).
  const returnPreambleConsumedThisTurn =
    safeSession.baseline_return_greeting_pending === true &&
    safeSession.baseline_refresh_return_category != null;

  const nextSessionState = {
    attacheState: nextAttacheState,
    chat_history: history,
    attache_close_count: nextCloseCount,
    attache_turn_count: nextTurnCount,
    baseline_question_counts,
    baseline_question_order: safeSession.baseline_question_order,
    baseline_answer_count: nextAnswerCount,
    baseline_question_stats,
    baseline_refresh_return_category: safeSession.baseline_refresh_return_category || null,
    baseline_return_greeting_pending: returnPreambleConsumedThisTurn
      ? false
      : !!safeSession.baseline_return_greeting_pending,
    stale_dossier_rebaseline: false,
  };

  if (config.DEBUG_LOGS) {
    const fromPhase = state.phase;
    const fromIndex = state.question_index;
    const toPhase = nextAttacheState.phase;
    const toIndex = nextAttacheState.question_index;
    const phaseId = nextAttacheState.current_phase_id || state.current_phase_id || "(unknown_phase_id)";
    const patternKey = pattern && pattern.key ? pattern.key : "(no_pattern)";

    // Single high-visibility line logging both from/to state and core counters.
    logger.info(
      "attacheRuntime",
      `${ansi.bold}${ansi.magenta}[ATTACHÉ PHASE]${ansi.reset} ` +
        `${ansi.cyan}from=${fromPhase}[q=${fromIndex}]${ansi.reset} ` +
        `${ansi.cyan}to=${toPhase}[q=${toIndex}]${ansi.reset} ` +
        `${ansi.yellow}intent=${intent}${ansi.reset} ` +
        `${ansi.yellow}pattern=${patternKey}${ansi.reset} ` +
        `${ansi.yellow}asked_baseline_question=${askedBaselineQuestion}${ansi.reset} ` +
        `${ansi.green}phase_id=${phaseId}${ansi.reset} ` +
        `${ansi.red}close_count=${nextCloseCount}${ansi.reset} ` +
        `${ansi.magenta}turn_count=${nextTurnCount}${ansi.reset} ` +
        `${ansi.green}baseline_answers=${nextAnswerCount}${ansi.reset}`
    );
  }

  if (sessionEnded) {
    const reason = endedByFinalBaseline
      ? "final_baseline_complete"
      : endedByClose
      ? "close_intent_threshold"
      : endedByTurnCap
      ? "max_turns_reached"
      : "unknown";
    logger.info("attacheRuntime", "Attaché prelude complete; handing off to detective", {
      reason,
      attache_close_count: nextCloseCount,
      attache_turn_count: nextTurnCount,
      final_phase: nextAttacheState.phase,
      final_phase_id: nextAttacheState.current_phase_id || phaseId,
    });
  }

  return {
    sessionState: nextSessionState,
    user_response: userFacingResponse,
    sessionEnded,
    llmOutput: output,
  };
}

module.exports = {
  createInitialAttacheSessionState,
  runAttacheTurn,
  composeAttacheSystemPromptForSession,
  getRandomIntroLine,
  getRandomFinalLine,
  buildPromptContextFromState,
  getPhaseNotesForTransition,
};
