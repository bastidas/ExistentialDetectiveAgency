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
const config = require("./config");

/** When true, processTurn calls OpenAI via createAttacheCall (requires OPENAI_API_KEY). */
const LIVE_LLM_CALLS = true;
const N_MIN_QUESTIONS = 2;
const N_MAX_QUESTIONS = 3;
const RANDOM_Q_ORDER = true;

const apiKey = process.env.OPENAI_API_KEY;
const openaiClient = LIVE_LLM_CALLS && apiKey ? new (require("openai"))({ apiKey }) : null;

if (LIVE_LLM_CALLS && !openaiClient) {
  console.warn(
    "[baselineOrchestrator] LIVE_LLM_CALLS is true but OPENAI_API_KEY is not set. Using stub attaché. Set OPENAI_API_KEY or add a .env file in frontend/api."
  );
}

const VALID_PHASES = ["start", "explore", "administerBaseline1", "administerBaseline2", "administerBaseline3", "close"];
const BASELINE_PHASES = ["administerBaseline1", "administerBaseline2", "administerBaseline3"];

const ATTACHE_PROMPTS_DIR = path.join(config.PROMPTS_DIR, "attache");
const ATTACHE_QUESTIONS_FILE = path.join(ATTACHE_PROMPTS_DIR, "attache_questions.json");
const ATTACHE_INTRO_FILE = path.join(ATTACHE_PROMPTS_DIR, "attache_opening_lines.md");
const ATTACHE_FINAL_FILE = path.join(ATTACHE_PROMPTS_DIR, "attache_final_lines.md");

// Minimum attaché turns before user_intends_close is allowed to fully end the session.
// Turn 0 and 1 are "getting acquainted"; close intents there should not end the session.
const MIN_TURNS_BEFORE_FINAL_CLOSE = 2;

let attacheQuestionsByPhase = {};
try {
  if (fs.existsSync(ATTACHE_QUESTIONS_FILE)) {
    attacheQuestionsByPhase = JSON.parse(fs.readFileSync(ATTACHE_QUESTIONS_FILE, "utf8"));
  }
} catch (_) {}

function loadIntroLines() {
  try {
    if (fs.existsSync(ATTACHE_INTRO_FILE)) {
      const raw = fs.readFileSync(ATTACHE_INTRO_FILE, "utf8");
      const lines = raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      return lines.length ? lines : [];
    }
  } catch (_) {}
  return [];
}

function getRandomIntroLine() {
  const lines = loadIntroLines();
  if (!lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

function loadFinalLines() {
  try {
    if (fs.existsSync(ATTACHE_FINAL_FILE)) {
      const raw = fs.readFileSync(ATTACHE_FINAL_FILE, "utf8");
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
  const lines = loadFinalLines();
  if (!lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

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
    // Turn index: number of attaché turns completed so far (0-based).
    turn_index: options.turn_index ?? 0,
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
    consecutive_close_intents: options.consecutive_close_intents ?? 0,
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
  " unless they are indicating they would like to stop baseline, indicating they have questions about what is going on, or asking to see the detective.";

// // Core instruction text fragments kept as named constants for reuse and clarity.

const START_PHASE_INSTRUCTION_PREFIX =
  "Greet briefly. Make up something about what the Existential Detective Agency could possibly maybe be, or what it could do for the user. Explain that you will call them querent, you who asks questions, like all of us. Tell them you don't know as much about the The Existential Detective agency as you would like, your just the attaché after all. The Detective will be with them soon. All you do is administer the baseline and file the dossier. In closing, ask whether they want to proceed right into to the baseline (and they *really* should), explore, or wait to see if the detective is ready. ";
const START_PHASE_INSTRUCTION_SUFFIX =
  "Otherwise respond according to their choice and set the intent flags.";

const START_BASELINE_INTSRUCTION_PREFIX = "The user is just getting aquanited to the agency so if they have questions, address those first. If the user is hesitating or seems to want to explore, respond to that and set the intent flags so they can explore. If they seem ready to proceed with the baseline, give them a brief intro to what the baseline is and then present the first question. If they want to see the detective instead, set the intent flag for that. Here is the first baseline instruction: ";


const EXPLORE_INSTRUCTION_BASE =
  "They are exploring (they paused the baseline). Answer their questions.";
const EXPLORE_INSTRUCTION_FOOTER =
  " Do not actually resume the baseline or present the full next baseline question until they clearly indicate they want to continue. Set intent flags so the system does not advance the question index until they choose.";

const CLOSING_INSTRUCTION_FROM_PHASE3 =
  "They have completed Phase 3 of the baseline. Tell the user that the baseline is over and that their responses are nominal enough to continue; for example: \"The baseline is over. It is nominal enough to continue, it appears.\" Make it clear there are no further baseline questions to answer.";

const CLOSE_GENERIC_PREFIX =
  "Respond appropriately that you understand they want to end the baseline, they are frustrated, or want to see the detective. If applicable ask for confirmation to end this intake process, tell them the Detective is ready now.";
const CLOSE_GENERIC_SUFFIX =
  "If they want to explore (e.g. \"I have a question\"), set user_intends_explore; when they say continue they will return to that phase and question.";

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
    const phase1Intro = getPhaseIntroSentence("administerBaseline1");
    return (
      START_PHASE_INSTRUCTION_PREFIX +
      `If they say they want the baseline (or similar), reply in one go first with this Phase 1 intro sentence: ${phase1Intro} Then print two newlines, and then say exactly this first question: \`${firstQ}\`. ` +
      START_PHASE_INSTRUCTION_SUFFIX
    );
  }

  if (phase === "explore") {
    const resumePhase = state.baseline_phase_when_exploring;
    const resumeLabel = getPhaseLabel(resumePhase);
    const resumeQ = q ? ` The potential next baseline question is: \`${q}\`.` : "";
    const resumeLine = resumePhase
      ? ` When they seem ready to continue, acknowledge this and let them know you can resume at ${resumeLabel}.${resumeQ}`
      : ` When they seem ready to continue with the baseline, acknowledge this and let them know you can begin Phase 1.${resumeQ}`;
    const closeLine =
      nextPhaseName === "close"
        ? " When they indicate they want to end, set user_intends_close; when they confirm, deliver the closing line."
        : "";
    return EXPLORE_INSTRUCTION_BASE + resumeLine + closeLine + EXPLORE_INSTRUCTION_FOOTER;
  }

  if (phase === "close") {
    const returnPhase = state.phase_before_close;
    const returnLabel = getPhaseLabel(returnPhase);
    const fromPhase3 = returnPhase === "administerBaseline3";
    if (fromPhase3) {
      return CLOSING_INSTRUCTION_FROM_PHASE3;
    }
    return (
      CLOSE_GENERIC_PREFIX +
      `If they do not confirm or want to go back, set the intent so they return to ${returnLabel} and continue with the next baseline question in that phase. ` +
      CLOSE_GENERIC_SUFFIX
    );
  }

  if (phase === "administerBaseline1" || phase === "administerBaseline2" || phase === "administerBaseline3") {
    if (!q) return phase_instructions;
    const intro = getPhaseIntroSentence(phase);
    let base = is_phase_start
      ? `${START_BASELINE_INTSRUCTION_PREFIX} State in one sentence: ${intro} Then print two new lines and say exactly this question to the user: \`${q}\`${PRESENT_QUESTION_UNLESS}`
      : `State this exact question to the user \`${q}\`${PRESENT_QUESTION_UNLESS}`;
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
  const turnIndex = state.turn_index ?? 0;
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

  const nextState = { ...state, chat_history: history, turn_index: turnIndex + 1 };

  // Track consecutive close intents; after two in a row, end the session.
  const prevCloseCount = state.consecutive_close_intents ?? 0;
  const closeCount = output.user_intends_close ? prevCloseCount + 1 : 0;
  nextState.consecutive_close_intents = closeCount;

  // Only allow a final end once we've had at least MIN_TURNS_BEFORE_FINAL_CLOSE
  // turns and we're already in the explicit "close" phase, so that a
  // user_intends_close coming from the start phase always routes through at
  // least one confirmation turn in the close phase before ending.
  const canEndSessionThisTurn = turnIndex >= MIN_TURNS_BEFORE_FINAL_CLOSE && phase === "close";

  if (canEndSessionThisTurn && closeCount >= 2) {
    nextState.phase = "close";
    return { state: nextState, user_response: output.user_response, sessionEnded: true };
  }

  if (output.user_intends_close) {
    if (phase !== "close") {
      if (BASELINE_PHASES.includes(phase)) {
        const idx = state.question_index ?? state.phase1_index ?? state.phase2_index ?? state.phase3_index ?? 0;
        const len =
          phase === "administerBaseline1"
            ? (state.phase1_questions?.length ?? 0)
            : phase === "administerBaseline2"
              ? (state.phase2_questions?.length ?? 0)
              : (state.phase3_questions?.length ?? 0);

        // Move resume position to the next baseline question in this phase when possible.
        const resumeIdx = len > 0 && idx + 1 < len ? idx + 1 : idx;
        nextState.phase_before_close = phase;
        nextState.question_index_before_close = resumeIdx;
        const qs =
          phase === "administerBaseline1"
            ? state.phase1_questions
            : phase === "administerBaseline2"
              ? state.phase2_questions
              : state.phase3_questions;
        nextState.question_at_hand_before_close = qs?.[resumeIdx] ?? null;
      } else {
        nextState.phase_before_close = phase === "explore" ? (state.baseline_phase_when_exploring ?? "start") : phase;
        nextState.question_index_before_close = state.question_index ?? state.phase1_index ?? state.phase2_index ?? state.phase3_index ?? 0;
        nextState.question_at_hand_before_close = question_at_hand ?? null;
      }
    }
    nextState.phase = "close";
    const sessionEnded = phase === "close";
    return { state: nextState, user_response: output.user_response, sessionEnded };
  }

  if (output.user_intends_explore) {
    if (phase === "start") nextState.baseline_phase_when_exploring = null;
    if (phase === "close") {
      // If they reached close from Phase 3, baseline is finished; exploring should not resume baseline questions.
      if (nextState.phase_before_close === "administerBaseline3") {
        nextState.baseline_phase_when_exploring = null;
      } else {
        nextState.baseline_phase_when_exploring = nextState.phase_before_close ?? null;
        nextState.question_index = nextState.question_index_before_close ?? 0;
        if (nextState.baseline_phase_when_exploring === "administerBaseline1") nextState.phase1_index = nextState.question_index;
        if (nextState.baseline_phase_when_exploring === "administerBaseline2") nextState.phase2_index = nextState.question_index;
        if (nextState.baseline_phase_when_exploring === "administerBaseline3") nextState.phase3_index = nextState.question_index;
      }
    }
    nextState.phase = "explore";
    return { state: nextState, user_response: output.user_response };
  }

  if (phase === "close") {
    if (!output.user_intends_close && !output.user_intends_explore) {
      // If they reached close from Phase 3, do not return to baseline questions; stay in close.
      if (nextState.phase_before_close && nextState.phase_before_close !== "administerBaseline3") {
        nextState.phase = nextState.phase_before_close;
        nextState.question_index = nextState.question_index_before_close ?? 0;
        if (nextState.phase === "administerBaseline1") nextState.phase1_index = nextState.question_index;
        if (nextState.phase === "administerBaseline2") nextState.phase2_index = nextState.question_index;
        if (nextState.phase === "administerBaseline3") nextState.phase3_index = nextState.question_index;
      }
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
  getRandomIntroLine,
  getRandomFinalLine,
  CLOSING_INSTRUCTION_FROM_PHASE3,
};
