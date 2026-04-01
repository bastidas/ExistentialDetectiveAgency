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
} = require("./attacheOrchestrator");
const {
  getSystemPrompt,
  getPromptPattern,
  BASELINE1_INSTRUCTIONS,
  BASELINE2_INSTRUCTIONS,
  BASELINE3_INSTRUCTIONS,
} = require("./attachePrompts");
const { composeAgentPrompt } = require("../prompts/promptComposer");

// Baseline question banks for the new AttacheState phases.
// Shape:
// {
//   "baseline1": { questions: ["...", "...", ...] },
//   "baseline2": { questions: [...] },
//   "baseline3": { questions: [...] }
// }
const BASELINE_QUESTIONS = require("../../prompts/attache/attache_baseline_questions.json");

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

// Opening lines are stored as markdown-style bullet entries where
// each "-" starts a new multi-line block. Everything after the "-"
// (including blank lines and paragraphs) belongs to that entry until
// the next "-" or end of file.
function loadIntroEntries() {
  try {
    if (!fs.existsSync(ATTACHE_INTRO_FILE)) return [];
    const raw = fs.readFileSync(ATTACHE_INTRO_FILE, "utf8");
    const lines = raw.split(/\r?\n/);
    const entries = [];
    let current = null;

    for (const line of lines) {
      const m = line.match(/^\s*-\s*(.*)$/);
      if (m) {
        // Start a new entry; push any previous one first.
        if (current != null && current.trim()) {
          entries.push(current.trim());
        }
        current = m[1] || "";
      } else if (current != null) {
        // Continuation of the current entry (preserve newlines).
        current += "\n" + line;
      }
    }

    if (current != null && current.trim()) {
      entries.push(current.trim());
    }

    return entries;
  } catch (_) {
    return [];
  }
}

function getRandomIntroLine() {
  const entries = loadIntroEntries();
  if (!entries.length) return null;
  return entries[Math.floor(Math.random() * entries.length)];
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
 * @param {import("./attacheOrchestrator").AttacheState|undefined|null} prevState
 * @param {import("./attacheOrchestrator").AttacheState|undefined|null} nextState
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

/**
 * Build the prompt context object for getSystemPrompt from the
 * current AttacheState plus optional session-level info.
 *
 * This centralizes how we translate baseline_number/question_index
 * into concrete baseline question text and per-baseline intro
 * instructions. The returned keys intentionally match the {tokens}
 * used in attachePrompts templates.
 *
 * @param {import("./attacheOrchestrator").AttacheState|null} state
 * @param {object|null} sessionState
 * @param {number|null} baselineNumberHint
 * @returns {{ baselineN_questionQ?: string, baselineN_instructions?: string }}
 */
function buildPromptContextFromState(state, sessionState, baselineNumberHint) {
  if (!state) return {};

  const pattern = getPromptPattern(state);

  // Prefer explicit hint, then state.baseline_number, then pattern.
  const baselineNumber =
    (typeof baselineNumberHint === "number" && baselineNumberHint) ? baselineNumberHint :
    (state.baseline_number != null ? state.baseline_number : pattern.baselineNumber);

  const qIndex =
    typeof state.question_index === "number" && state.question_index >= 0
      ? state.question_index
      : 0;

  if (!baselineNumber && baselineNumber !== 0) return {};
  const key = "baseline" + String(baselineNumber);
  const entry = BASELINE_QUESTIONS[key];
  if (!entry || !Array.isArray(entry.questions)) return {};

  // Optionally shuffle baseline questions: when RANDOM_Q_ORDER is true,
  // we store a per-baseline index order in the session state and use
  // that mapping to choose which concrete question is at question_index.
  let effectiveIndex = qIndex;
  if (sessionState && sessionState.baseline_question_order && baselineNumber != null) {
    const order = sessionState.baseline_question_order[baselineNumber];
    if (Array.isArray(order) && qIndex >= 0 && qIndex < order.length) {
      effectiveIndex = order[qIndex];
    }
  }

  const question = entry.questions[effectiveIndex];
  if (!question) return {};

  let baselineInstructions;
  if (baselineNumber === 1) baselineInstructions = BASELINE1_INSTRUCTIONS;
  else if (baselineNumber === 2) baselineInstructions = BASELINE2_INSTRUCTIONS;
  else if (baselineNumber === 3) baselineInstructions = BASELINE3_INSTRUCTIONS;

  const ctx = { baselineN_questionQ: question };
  if (baselineInstructions) {
    ctx.baselineN_instructions = baselineInstructions;
  }
  return ctx;
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
      const key = "baseline" + String(baselineNumber);
      const entry = BASELINE_QUESTIONS[key];
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
  // Normalize persisted/in-memory state each turn so required derived/default
  // fields (notably n_questions_in_baseline) are always present.
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
  // We only surface a baseline question while in a baseline phase; once we
  // move into close (e.g. after finishing baseline3), question_at_hand should
  // be cleared so we don't keep echoing the last question into close turns.
  const question_at_hand =
    state.phase && state.phase.startsWith("baseline")
      ? context.baselineN_questionQ || null
      : null;

  // Scenario-specific turn instruction derived from AttacheState and
  // baseline question; this is the third segment of the final system
  // message used by attacheCall.
  const turn_instruction = getSystemPrompt(state, context) || "";

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
  };
  const pseudoSession = {
    ...safeSession,
    lastReturnClassification:
      safeSession.baseline_return_greeting_pending === true &&
      safeSession.baseline_refresh_return_category
        ? { returnCategory: safeSession.baseline_refresh_return_category }
        : null,
  };
  const composedPrompt = composeAgentPrompt({
    agentKey: "attache",
    session: pseudoSession,
    internalState: { mainState: { attache: { baselineCompleted: false } } },
    attacheTurnInstruction: {
      turnInstruction: turn_instruction,
      attachePromptFamilyKey: pattern && pattern.key ? pattern.key : null,
    },
  });
  input.composed_system_prompt = composedPrompt.content;

  const callAttache = config.OFFLINE
    ? async () => {
        const phaseIdLocal = state.current_phase_id || computeCurrentPhaseId(state);
        return {
          user_response: `[OFFLINE] ${phaseIdLocal} :: ${turn_instruction}`,
          user_intends_explore: false,
          user_intends_close: false,
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
        `${ansi.cyan}question_at_hand=${question_at_hand || "(none)"}${ansi.reset}`
    );
  }

  const output = await callAttache(input);

  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: output.user_response });

  const intent = normalizeIntent(output);
  const askedBaselineQuestionRaw = !!output.asked_baseline_question;
  let askedBaselineQuestion = askedBaselineQuestionRaw;
  // Offline dev mode: pretend the LLM always asked the baseline question
  // whenever we are in a baseline phase and have a concrete question_at_hand,
  // so the FSM can progress through baselines without getting stuck.
  if (config.OFFLINE) {
    if (state.phase && state.phase.startsWith("baseline") && question_at_hand) {
      askedBaselineQuestion = true;
    }
  } else {
    // Online heuristic: if the LLM forgot to set asked_baseline_question but
    // clearly printed the baseline question text, treat it as having asked.
    if (
      !askedBaselineQuestion &&
      question_at_hand &&
      typeof output.user_response === "string" &&
      output.user_response.includes(question_at_hand)
    ) {
      askedBaselineQuestion = true;
    }
  }
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
    baseline_return_greeting_pending: returnPreamblePending ? false : !!safeSession.baseline_return_greeting_pending,
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
        `${ansi.yellow}asked_baseline_question_raw=${askedBaselineQuestionRaw}${ansi.reset} ` +
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
    user_response: output.user_response,
    sessionEnded,
  };
}

module.exports = {
  createInitialAttacheSessionState,
  runAttacheTurn,
  getRandomIntroLine,
  getRandomFinalLine,
  buildPromptContextFromState,
  getPhaseNotesForTransition,
};
