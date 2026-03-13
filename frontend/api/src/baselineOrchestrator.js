/**
 * Stub orchestrator for orchestration verification tests.
 *
 * Contract (architecture plan §4, §3, §5): one attaché call per turn; input shape
 * { chat_history, question_at_hand, phase_instructions, is_phase_start, next_phase_instructions, turn_instruction? };
 * when turn_instruction is set it is the contextual instruction for this turn (attacheCall uses it and omits raw # Question / # Is first).
 * output shape { user_response, user_intends_explore, user_intends_close }; state has phase,
 * chat_history, phase_questions (or phase1/2/3_questions), question_index, etc.
 *
 * This stub implements the call contract and minimal state shape so contract tests can pass.
 * Transition and scenario tests will fail until full transition logic is implemented.
 *
 * When LIVE_LLM_CALLS is true, processTurn creates an OpenAI client and uses createAttacheCall
 * (real LLM). Otherwise it uses the provided callAttache stub.
 * Env: OPENAI_API_KEY (required for live calls), OPENAI_MODEL (optional; default gpt-4o, via config).
 */

const path = require("path");
const fs = require("fs");

// Load .env before any module that reads config (e.g. attacheCall → config) so OPENAI_API_KEY and OPENAI_MODEL are set
try {
  const dotenv = require("dotenv");
  dotenv.config();
  dotenv.config({ path: path.join(__dirname, ".env") });
} catch (_) {
  // dotenv not installed
}

const { createAttacheCall } = require("./attacheCall");

/** When true, processTurn calls OpenAI via createAttacheCall (requires OPENAI_API_KEY). */
const LIVE_LLM_CALLS = true;

const apiKey = process.env.OPENAI_API_KEY;
const openaiClient = LIVE_LLM_CALLS && apiKey ? new (require("openai"))({ apiKey }) : null;

if (LIVE_LLM_CALLS && !openaiClient) {
  console.warn(
    "[baselineOrchestrator] LIVE_LLM_CALLS is true but OPENAI_API_KEY is not set. Using stub attaché. Set OPENAI_API_KEY or add a .env file in frontend/api."
  );
}

const VALID_PHASES = ["start", "explore", "administerBaseline1", "administerBaseline2", "administerBaseline3", "close"];
const BASELINE_PHASES = ["administerBaseline1", "administerBaseline2", "administerBaseline3"];

const ATTACHE_QUESTIONS_FILE = path.join(__dirname, "testOrchestration", "attache_questions.json");
let attacheQuestionsByPhase = {};
try {
  if (fs.existsSync(ATTACHE_QUESTIONS_FILE)) {
    attacheQuestionsByPhase = JSON.parse(fs.readFileSync(ATTACHE_QUESTIONS_FILE, "utf8"));
  }
} catch (_) {}

const N_MIN_QUESTIONS = 2;
const N_MAX_QUESTIONS = 3;

const RANDOM_Q_ORDER = false;

/**
 * Sample n questions from bank (n random in [N_MIN_QUESTIONS, N_MAX_QUESTIONS], capped by bank length).
 * When RANDOM_Q_ORDER=FALSE, takes first n in original order. Returns a new array; does not mutate bank.
 */
function sampleQuestions(bank) {
  if (!Array.isArray(bank) || bank.length === 0) return [];
  const n = RANDOM_Q_ORDER
    ? Math.min(
        bank.length,
        N_MIN_QUESTIONS + Math.floor(Math.random() * (N_MAX_QUESTIONS - N_MIN_QUESTIONS + 1))
      )
    : Math.min(bank.length, N_MAX_QUESTIONS);
  const ordered = RANDOM_Q_ORDER ? [...bank].sort(() => Math.random() - 0.5) : [...bank];
  return ordered.slice(0, n);
}

function createInitialState(options = {}) {
  const phase1Bank = options.phase1_questions ?? options.phase1_bank ?? ["Q1"];
  const phase2Bank = options.phase2_questions ?? options.phase2_bank ?? ["Q2"];
  const phase3Bank = options.phase3_questions ?? options.phase3_bank ?? ["Q3"];
  return {
    phase: options.phase ?? "start",
    chat_history: options.chat_history ?? [],
    question_index: options.question_index ?? 0,
    phase1_bank: phase1Bank,
    phase2_bank: phase2Bank,
    phase3_bank: phase3Bank,
    phase1_questions: options.phase1_questions ?? sampleQuestions(phase1Bank),
    phase2_questions: options.phase2_questions ?? sampleQuestions(phase2Bank),
    phase3_questions: options.phase3_questions ?? sampleQuestions(phase3Bank),
    baseline_phase_when_exploring: options.baseline_phase_when_exploring ?? null,
    phase_before_close: options.phase_before_close ?? null,
    question_index_before_close: options.question_index_before_close ?? null,
    question_at_hand_before_close: options.question_at_hand_before_close ?? null,
    phase1_index: options.phase1_index ?? 0,
    phase2_index: options.phase2_index ?? 0,
    phase3_index: options.phase3_index ?? 0,
  };
}

/** Returns additional_instructions for the phase from attache_questions.json, or a fallback label. */
function getPhaseInstructions(phase) {
  const entry = attacheQuestionsByPhase[phase];
  const text = entry && typeof entry.additional_instructions === "string" ? entry.additional_instructions : null;
  return text ?? `(${phase})`;
}

/** Returns phase_intro_sentence for a baseline phase from attache_questions.json, or a default. */
function getPhaseIntroSentence(phase) {
  const entry = attacheQuestionsByPhase[phase];
  const text = entry && typeof entry.phase_intro_sentence === "string" ? entry.phase_intro_sentence : null;
  return text ?? `This is ${phase}.`;
}

/** Human-readable label for a phase name (for in-instruction text). */
function getPhaseLabel(phaseName) {
  if (!phaseName || typeof phaseName !== "string") return "that phase";
  if (phaseName === "administerBaseline1") return "Phase 1";
  if (phaseName === "administerBaseline2") return "Phase 2";
  if (phaseName === "administerBaseline3") return "Phase 3";
  if (phaseName === "close") return "end of session";
  if (phaseName === "start" || phaseName === "explore") return phaseName;
  return phaseName;
}

const PRESENT_QUESTION_UNLESS =
  " unless they are strongly indicating they would like to stop the entire baseline or strongly indicating they have questions about what is going on.";

/**
 * Returns the full instruction string for this turn. Always returns a string (never null).
 * Includes question_at_hand, transition, and resume context where relevant so the agent needs no separate raw fields.
 *
 * @param {string} phase - Current phase
 * @param {string|null} question_at_hand - Question to present this turn (or null)
 * @param {boolean} is_phase_start - True when first question of a baseline phase (or transition into one)
 * @param {string} phase_instructions - Generic phase instructions from JSON
 * @param {{ state: object, nextPhaseName: string|null, next_phase_instructions: string|null }} context - State and next-phase info
 * @returns {string} Single instruction for this turn
 */
function buildTurnInstruction(phase, question_at_hand, is_phase_start, phase_instructions, context = {}) {
  const { state = {}, nextPhaseName = null, next_phase_instructions = null } = context;
  const q = question_at_hand && typeof question_at_hand === "string" ? question_at_hand : null;

  if (phase === "start") {
    const firstQ = q ?? "(first question of Phase 1)";
    return (
      "Greet briefly and ask whether the user wants to proceed to the baseline, explore, or close. " +
      `If they say they want the baseline (or similar), reply in one go with the Phase 1 intro and this first question: \`${firstQ}\`. ` +
      "Otherwise respond according to their choice and set the intent flags."
    );
  }

  if (phase === "explore") {
    const resumePhase = state.baseline_phase_when_exploring;
    const resumeLabel = getPhaseLabel(resumePhase);
    const resumeQ = q ? ` with this question: \`${q}\`` : "";
    const resumeLine = resumePhase
      ? ` When they say they're ready to continue, they will resume at ${resumeLabel}${resumeQ}—reply accordingly (e.g. "Here we are again—[question]" or, if starting Phase 1, state the Phase 1 intro then the question).`
      : " When they say they're ready to continue, you will start Phase 1 with the first question—state the Phase 1 intro and that question.";
    const closeLine =
      nextPhaseName === "close"
        ? " When they indicate they want to end, set user_intends_close; when they confirm, deliver the closing line."
        : "";
    return (
      "They are exploring (they paused the baseline). Answer their questions." +
      resumeLine +
      closeLine +
      " Set intent flags so the system does not advance the question index until they choose."
    );
  }

  if (phase === "close") {
    const returnPhase = state.phase_before_close;
    const returnLabel = getPhaseLabel(returnPhase);
    const returnQ = state.question_at_hand_before_close
      ? ` with the same question: \`${state.question_at_hand_before_close}\``
      : "";
    return (
      "Ask for confirmation to end the session. If they confirm, deliver the closing line. " +
      `If they do not confirm or want to go back, set the intent so they return to ${returnLabel}${returnQ}. ` +
      "If they want to explore (e.g. \"I have a question\"), set user_intends_explore; when they say continue they will return to that phase and question."
    );
  }

  if (phase === "administerBaseline1" || phase === "administerBaseline2" || phase === "administerBaseline3") {
    if (!q) return phase_instructions;
    const intro = getPhaseIntroSentence(phase);
    let base =
      is_phase_start
        ? `State in one sentence: ${intro} Then say exactly this question to the user: \`${q}\`${PRESENT_QUESTION_UNLESS}`
        : `State this exact question to the user \`${q}\`${PRESENT_QUESTION_UNLESS}`;
    if (nextPhaseName && next_phase_instructions) {
      const nextLabel = getPhaseLabel(nextPhaseName);
      if (nextPhaseName === "close") {
        base += " If they indicate they want to move on or end the session, deliver the closing line for your reply.";
      } else {
        const nextFirstQ =
          nextPhaseName === "administerBaseline1"
            ? state.phase1_questions?.[0]
            : nextPhaseName === "administerBaseline2"
              ? state.phase2_questions?.[0]
              : state.phase3_questions?.[0];
        const nextIntro = getPhaseIntroSentence(nextPhaseName);
        base += ` If they indicate they want to move on or end the session, use the following for your reply: ${nextLabel} intro (${nextIntro}) and first question: \`${nextFirstQ ?? "…"}\`.`;
      }
    }
    return base;
  }

  return phase_instructions;
}

function getQuestionAtHand(state, options = {}) {
  const phase = state.phase;
  const nextPhase = options.nextPhase ?? null;

  if (nextPhase === "administerBaseline1" && state.phase1_questions?.length) return state.phase1_questions[0];
  if (nextPhase === "administerBaseline2" && state.phase2_questions?.length) return state.phase2_questions[0];
  if (nextPhase === "administerBaseline3" && state.phase3_questions?.length) return state.phase3_questions[0];

  if (phase === "start" || phase === "close") return null;
  if (phase === "administerBaseline1") {
    const qs = state.phase1_questions;
    const idx = Math.min(state.question_index ?? state.phase1_index ?? 0, (qs?.length ?? 1) - 1);
    return qs?.[idx] ?? null;
  }
  if (phase === "administerBaseline2") {
    const qs = state.phase2_questions;
    const idx = Math.min(state.question_index ?? state.phase2_index ?? 0, (qs?.length ?? 1) - 1);
    return qs?.[idx] ?? null;
  }
  if (phase === "administerBaseline3") {
    const qs = state.phase3_questions;
    const idx = Math.min(state.question_index ?? state.phase3_index ?? 0, (qs?.length ?? 1) - 1);
    return qs?.[idx] ?? null;
  }
  if (phase === "explore" && state.baseline_phase_when_exploring === "administerBaseline1") {
    const idx = state.question_index ?? state.phase1_index ?? 0;
    return state.phase1_questions?.[idx] ?? null;
  }
  if (phase === "explore" && state.baseline_phase_when_exploring === "administerBaseline2") {
    const idx = state.question_index ?? state.phase2_index ?? 0;
    return state.phase2_questions?.[idx] ?? null;
  }
  if (phase === "explore" && state.baseline_phase_when_exploring === "administerBaseline3") {
    const idx = state.question_index ?? state.phase3_index ?? 0;
    return state.phase3_questions?.[idx] ?? null;
  }
  return null;
}

function getIsPhaseStart(state) {
  const phase = state.phase;
  if (phase === "administerBaseline1") return (state.question_index ?? state.phase1_index ?? 0) === 0;
  if (phase === "administerBaseline2") return (state.question_index ?? state.phase2_index ?? 0) === 0;
  if (phase === "administerBaseline3") return (state.question_index ?? state.phase3_index ?? 0) === 0;
  return false;
}

function getNextPhaseInstructions(state) {
  const phase = state.phase;
  if (phase === "start" || phase === "explore") return state.baseline_phase_when_exploring ? "close" : "administerBaseline1";
  if (phase === "close") return state.phase_before_close ?? null;
  if (phase === "administerBaseline1") {
    const idx = state.question_index ?? state.phase1_index ?? 0;
    const len = state.phase1_questions?.length ?? 0;
    if (len > 0 && idx >= len - 1) return "administerBaseline2";
    return null;
  }
  if (phase === "administerBaseline2") {
    const idx = state.question_index ?? state.phase2_index ?? 0;
    const len = state.phase2_questions?.length ?? 0;
    if (len > 0 && idx >= len - 1) return "administerBaseline3";
    return null;
  }
  if (phase === "administerBaseline3") {
    const idx = state.question_index ?? state.phase3_index ?? 0;
    const len = state.phase3_questions?.length ?? 0;
    if (len > 0 && idx >= len - 1) return "close";
    return null;
  }
  return null;
}

async function processTurn(userMessage, state, callAttache) {
  const history = [...(state.chat_history || [])];
  const phase = state.phase;
  const nextPhaseName = getNextPhaseInstructions(state);
  const question_at_hand =
    phase === "start" || phase === "explore"
      ? (getQuestionAtHand(state, { nextPhase: nextPhaseName }) ?? getQuestionAtHand(state))
      : getQuestionAtHand(state);
  const phase_instructions = getPhaseInstructions(phase);
  const next_phase_instructions = nextPhaseName ? getPhaseInstructions(nextPhaseName) : null;
  const is_phase_start =
    getIsPhaseStart(state) ||
    phase === "close" ||
    ((phase === "start" || phase === "explore") && nextPhaseName && BASELINE_PHASES.includes(nextPhaseName));

  const turn_instruction = buildTurnInstruction(phase, question_at_hand, is_phase_start, phase_instructions, {
    state,
    nextPhaseName,
    next_phase_instructions,
  });
  const input = {
    chat_history: history,
    question_at_hand,
    phase_instructions,
    is_phase_start,
    next_phase_instructions,
    turn_instruction,
  };

  // When LIVE_LLM_CALLS and we have an OpenAI client, call the real LLM. Otherwise use callAttache stub.
  const effectiveCallAttache =
    openaiClient ? createAttacheCall(openaiClient, { userMessage }) : callAttache;
  const output = await effectiveCallAttache(input);

  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: output.user_response });

  const nextState = { ...state, chat_history: history };

  if (output.user_intends_close) {
    if (phase !== "close") {
      nextState.phase_before_close = phase === "explore" ? (state.baseline_phase_when_exploring ?? "start") : phase;
      nextState.question_index_before_close = state.question_index ?? state.phase1_index ?? state.phase2_index ?? state.phase3_index ?? 0;
      nextState.question_at_hand_before_close = question_at_hand ?? null;
    }
    nextState.phase = "close";
    const sessionEnded = phase === "close";
    return { state: nextState, user_response: output.user_response, sessionEnded };
  }

  if (output.user_intends_explore) {
    if (phase === "start") nextState.baseline_phase_when_exploring = null;
    if (phase === "close") {
      nextState.baseline_phase_when_exploring = nextState.phase_before_close ?? null;
      nextState.question_index = nextState.question_index_before_close ?? 0;
      if (nextState.baseline_phase_when_exploring === "administerBaseline1") nextState.phase1_index = nextState.question_index;
      if (nextState.baseline_phase_when_exploring === "administerBaseline2") nextState.phase2_index = nextState.question_index;
      if (nextState.baseline_phase_when_exploring === "administerBaseline3") nextState.phase3_index = nextState.question_index;
    }
    nextState.phase = "explore";
    return { state: nextState, user_response: output.user_response };
  }

  if (phase === "close") {
    if (!output.user_intends_close && !output.user_intends_explore) {
      nextState.phase = nextState.phase_before_close ?? "start";
      nextState.question_index = nextState.question_index_before_close ?? 0;
      if (nextState.phase === "administerBaseline1") nextState.phase1_index = nextState.question_index;
      if (nextState.phase === "administerBaseline2") nextState.phase2_index = nextState.question_index;
      if (nextState.phase === "administerBaseline3") nextState.phase3_index = nextState.question_index;
    }
    return { state: nextState, user_response: output.user_response };
  }

  if (phase === "explore") {
    const base = state.baseline_phase_when_exploring;
    if (base && BASELINE_PHASES.includes(base)) {
      nextState.phase = base;
      nextState.question_index = state.question_index ?? state.phase1_index ?? state.phase2_index ?? state.phase3_index ?? 0;
      if (base === "administerBaseline1") nextState.phase1_index = nextState.question_index;
      if (base === "administerBaseline2") nextState.phase2_index = nextState.question_index;
      if (base === "administerBaseline3") nextState.phase3_index = nextState.question_index;
    } else {
      nextState.phase = "administerBaseline1";
      nextState.question_index = 0;
      nextState.phase1_index = 0;
      nextState.phase1_questions = sampleQuestions(nextState.phase1_bank ?? nextState.phase1_questions);
    }
    return { state: nextState, user_response: output.user_response };
  }

  if (phase === "start") {
    // Plan §5: in start, if not explore and not close → transition to administerBaseline1 (sample phase 1, question_index 0).
    if (!output.user_intends_explore && !output.user_intends_close) {
      nextState.phase = "administerBaseline1";
      nextState.phase1_questions = sampleQuestions(nextState.phase1_bank ?? nextState.phase1_questions);
      nextState.question_index = 0;
      nextState.phase1_index = 0;
    }
    return { state: nextState, user_response: output.user_response };
  }

  if (BASELINE_PHASES.includes(phase)) {
    const idx = state.question_index ?? state.phase1_index ?? state.phase2_index ?? state.phase3_index ?? 0;
    const nextIdx = idx + 1;
    nextState.question_index = nextIdx;
    if (phase === "administerBaseline1") nextState.phase1_index = nextIdx;
    if (phase === "administerBaseline2") nextState.phase2_index = nextIdx;
    if (phase === "administerBaseline3") nextState.phase3_index = nextIdx;

    const len =
      phase === "administerBaseline1"
        ? (state.phase1_questions?.length ?? 0)
        : phase === "administerBaseline2"
          ? (state.phase2_questions?.length ?? 0)
          : (state.phase3_questions?.length ?? 0);
    if (nextIdx >= len) {
      if (phase === "administerBaseline1") {
        nextState.phase = "administerBaseline2";
        nextState.question_index = 0;
        nextState.phase2_index = 0;
        nextState.phase2_questions = sampleQuestions(nextState.phase2_bank ?? nextState.phase2_questions);
      } else if (phase === "administerBaseline2") {
        nextState.phase = "administerBaseline3";
        nextState.question_index = 0;
        nextState.phase3_index = 0;
        nextState.phase3_questions = sampleQuestions(nextState.phase3_bank ?? nextState.phase3_questions);
      } else {
        nextState.phase = "close";
        nextState.phase_before_close = "administerBaseline3";
        nextState.question_index_before_close = idx;
      }
    }
  }

  return { state: nextState, user_response: output.user_response };
}

module.exports = {
  createInitialState,
  createState: createInitialState,
  processTurn,
  LIVE_LLM_CALLS,
  VALID_PHASES,
};
