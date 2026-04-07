"use strict";

const { setup, assign, createMachine } = require("xstate");

// Default ranges for how many questions each baseline phase can have.
const MIN_BASELINE1_QUESTIONS = 1;
const MAX_BASELINE1_QUESTIONS = 2;
const MIN_BASELINE2_QUESTIONS = 1;
const MAX_BASELINE2_QUESTIONS = 2;
const MIN_BASELINE3_QUESTIONS = 1;
const MAX_BASELINE3_QUESTIONS = 2;

// Safety cap enforced in attacheRuntime.
const ATTACHE_MAX_TURNS = 100;
const RANDOM_Q_ORDER = true;

/**
 * @typedef {Object} AttacheState
 * @property {"start"|"explore"|"baseline1"|"baseline2"|"baseline3"|"close"} phase
 * @property {1|2|3|null} baseline_number
 * @property {number} question_index
 * @property {number} n_questions_in_baseline
 * @property {"baseline1"|"baseline2"|"baseline3"|"close"|null} potential_next_phase
 * @property {"start"|"explore"|"baseline1"|"baseline2"|"baseline3"|"close"|null} previous_phase
 * @property {number|null} previous_question_index
 * @property {string|null} current_phase_id
 * @property {"start"|"baseline1"|"baseline2"|"baseline3"|null} [phase_before_close]
 * @property {number|null} [question_index_before_close]
 */

function getRandomBaselineQuestionCount(baselineNumber) {
  let min = MIN_BASELINE1_QUESTIONS;
  let max = MAX_BASELINE1_QUESTIONS;
  if (baselineNumber === 2) {
    min = MIN_BASELINE2_QUESTIONS;
    max = MAX_BASELINE2_QUESTIONS;
  } else if (baselineNumber === 3) {
    min = MIN_BASELINE3_QUESTIONS;
    max = MAX_BASELINE3_QUESTIONS;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

function getBaselineNumberFromPhase(phase) {
  if (phase === "baseline1") return 1;
  if (phase === "baseline2") return 2;
  if (phase === "baseline3") return 3;
  return null;
}

/**
 * @param {Partial<AttacheState>} partial
 * @returns {AttacheState}
 */
function createAttacheState(partial = {}) {
  const phase = partial.phase != null ? partial.phase : "start";
  const bn = getBaselineNumberFromPhase(phase);
  const nDefault = bn != null ? getRandomBaselineQuestionCount(bn) : getRandomBaselineQuestionCount(1);
  const base = {
    phase,
    baseline_number:
      partial.baseline_number != null ? partial.baseline_number : bn,
    question_index:
      typeof partial.question_index === "number" ? partial.question_index : 0,
    n_questions_in_baseline:
      typeof partial.n_questions_in_baseline === "number" && partial.n_questions_in_baseline > 0
        ? partial.n_questions_in_baseline
        : nDefault,
    potential_next_phase:
      partial.potential_next_phase !== undefined ? partial.potential_next_phase : "baseline1",
    previous_phase: partial.previous_phase !== undefined ? partial.previous_phase : null,
    previous_question_index:
      partial.previous_question_index !== undefined ? partial.previous_question_index : null,
    current_phase_id: partial.current_phase_id !== undefined ? partial.current_phase_id : null,
    phase_before_close: partial.phase_before_close !== undefined ? partial.phase_before_close : null,
    question_index_before_close:
      partial.question_index_before_close !== undefined ? partial.question_index_before_close : null,
  };
  base.current_phase_id = base.current_phase_id || computeCurrentPhaseId(base);
  return /** @type {AttacheState} */ (base);
}

/**
 * @param {{ user_intends_explore?: boolean, user_intends_close?: boolean }} output
 * @returns {"explore"|"close"|"baseline"}
 */
function normalizeIntent(output) {
  if (!output || typeof output !== "object") return "baseline";
  if (output.user_intends_explore) return "explore";
  if (output.user_intends_close) return "close";
  return "baseline";
}

/**
 * @param {AttacheState} state
 * @returns {string}
 */
function computeCurrentPhaseId(state) {
  if (!state || typeof state !== "object") return "unknown";
  const { phase, question_index, phase_before_close, potential_next_phase } = state;
  if (phase === "start") return "start";
  if (phase === "explore") {
    const hint = potential_next_phase && String(potential_next_phase).startsWith("baseline")
      ? potential_next_phase
      : "start";
    return `explore_from_${hint}`;
  }
  if (phase && phase.startsWith("baseline")) {
    const q = typeof question_index === "number" ? question_index : 0;
    return `${phase}_q${q}`;
  }
  if (phase === "close") {
    if (phase_before_close === "baseline3") return "close_from_final_baseline3";
    if (phase_before_close) return `close_from_${phase_before_close}`;
    return "close";
  }
  return "unknown";
}

/**
 * Pure transition (see attacheOrchestrator-plan.md).
 * Third arg: `asked_baseline_question` from the attaché LLM JSON this turn.
 * When true, baseline `question_index` advances (or moves to the next baseline phase
 * after the last question in the current one). When false, baseline state is unchanged.
 *
 * @param {AttacheState} state
 * @param {"explore"|"close"|"baseline"} intent
 * @param {boolean} [askedBaselineQuestion]
 * @returns {AttacheState}
 */
function transition(state, intent, askedBaselineQuestion = true) {
  const s = createAttacheState(state);
  const { phase, question_index, n_questions_in_baseline, potential_next_phase } = s;
  /** @type {AttacheState} */
  let next = createAttacheState(s);

  if (phase === "start") {
    if (intent === "explore") {
      next.phase = "explore";
      next.potential_next_phase = "baseline1";
      next.question_index = 0;
      next.baseline_number = null;
    } else if (intent === "close") {
      next.phase = "close";
      next.potential_next_phase = "start";
      next.phase_before_close = "start";
      next.question_index_before_close = 0;
      next.baseline_number = null;
    } else {
      next.phase = "baseline1";
      next.question_index = 0;
      next.baseline_number = 1;
      next.n_questions_in_baseline = getRandomBaselineQuestionCount(1);
      next.potential_next_phase = "baseline2";
    }
    next.current_phase_id = computeCurrentPhaseId(next);
    return next;
  }

  if (phase.startsWith("baseline")) {
    const currentBaseline = phase;
    if (intent === "explore") {
      next.phase = "explore";
      next.potential_next_phase = currentBaseline;
      next.previous_phase = currentBaseline;
      next.previous_question_index = question_index;
      next.baseline_number = getBaselineNumberFromPhase(currentBaseline);
    } else if (intent === "close") {
      next.phase = "close";
      next.phase_before_close = currentBaseline;
      next.question_index_before_close = question_index;
      next.potential_next_phase = currentBaseline;
      next.baseline_number = getBaselineNumberFromPhase(currentBaseline);
    } else {
      const nextIndex = question_index + 1;
      if (nextIndex < n_questions_in_baseline) {
        if (!askedBaselineQuestion) {
          return createAttacheState(s);
        }
        next.phase = currentBaseline;
        next.question_index = nextIndex;
        next.potential_next_phase = currentBaseline;
        next.baseline_number = getBaselineNumberFromPhase(currentBaseline);
      } else if (currentBaseline === "baseline1") {
        if (!askedBaselineQuestion) {
          return createAttacheState(s);
        }
        next.phase = "baseline2";
        next.question_index = 0;
        next.n_questions_in_baseline = getRandomBaselineQuestionCount(2);
        next.potential_next_phase = "baseline3";
        next.baseline_number = 2;
      } else if (currentBaseline === "baseline2") {
        if (!askedBaselineQuestion) {
          return createAttacheState(s);
        }
        next.phase = "baseline3";
        next.question_index = 0;
        next.n_questions_in_baseline = getRandomBaselineQuestionCount(3);
        next.potential_next_phase = "close";
        next.baseline_number = 3;
      } else {
        if (!askedBaselineQuestion) {
          return createAttacheState(s);
        }
        next.phase = "close";
        next.phase_before_close = "baseline3";
        next.question_index_before_close = question_index;
        next.potential_next_phase = "close";
        next.baseline_number = 3;
      }
    }
    next.current_phase_id = computeCurrentPhaseId(next);
    return next;
  }

  if (phase === "explore") {
    if (intent === "explore") {
      next.current_phase_id = computeCurrentPhaseId(next);
      return next;
    }
    if (intent === "close") {
      next.phase = "close";
      next.phase_before_close = potential_next_phase || "start";
      next.question_index_before_close = question_index;
    } else if (intent === "baseline") {
      if (potential_next_phase && potential_next_phase.startsWith("baseline")) {
        next.phase = potential_next_phase;
        next.baseline_number = getBaselineNumberFromPhase(potential_next_phase);
        next.n_questions_in_baseline = getRandomBaselineQuestionCount(
          /** @type {1|2|3} */ (next.baseline_number || 1)
        );
      } else {
        next.phase = "baseline1";
        next.question_index = 0;
        next.n_questions_in_baseline = getRandomBaselineQuestionCount(1);
        next.potential_next_phase = "baseline2";
        next.baseline_number = 1;
      }
    }
    next.current_phase_id = computeCurrentPhaseId(next);
    return next;
  }

  if (phase === "close") {
    if (intent === "explore") {
      next.phase = "explore";
    } else if (intent === "close") {
      return next;
    } else if (
      potential_next_phase &&
      String(potential_next_phase).startsWith("baseline") &&
      next.phase_before_close &&
      String(next.phase_before_close).startsWith("baseline")
    ) {
      // Resume interrupted baseline only when we *exited* with a baseline still in play
      // (`potential_next_phase` still points at baseline1/2/3). Nominal completion of
      // baseline3 sets `potential_next_phase` to `"close"`; generic LLM intent "baseline"
      // (neither explore nor close) must *not* snap back to baseline during the handoff turn.
      next.phase = next.phase_before_close;
      next.question_index = next.question_index_before_close ?? 0;
    }
    next.current_phase_id = computeCurrentPhaseId(next);
    return next;
  }

  next.current_phase_id = computeCurrentPhaseId(next);
  return next;
}

/**
 * One-step domain phase adjacency for `transition()` (used for docs + optional dev asserts).
 * Orchestrator nodes map 1:1: start→intro, explore→exploring, baseline*→baseline*, close→closing.
 * Resume-from-close picks the baseline in `phase_before_close` / `potential_next_phase`; explore
 * returns via `potential_next_phase` to the interrupted baseline.
 *
 * @type {Record<string, ReadonlySet<string>>}
 */
const ATTACHE_DOMAIN_ONE_STEP_PHASES = {
  start: new Set(["explore", "baseline1", "close"]),
  explore: new Set(["explore", "baseline1", "baseline2", "baseline3", "close"]),
  baseline1: new Set(["explore", "close", "baseline1", "baseline2"]),
  baseline2: new Set(["explore", "close", "baseline2", "baseline3"]),
  baseline3: new Set(["explore", "close", "baseline3"]),
  close: new Set(["explore", "close", "baseline1", "baseline2", "baseline3"]),
};

/**
 * @param {string|undefined} prevPhase
 * @param {string|undefined} nextPhase
 * @returns {boolean}
 */
function isValidAttacheOneStepPhasePair(prevPhase, nextPhase) {
  if (prevPhase === nextPhase) return true;
  const allowed = ATTACHE_DOMAIN_ONE_STEP_PHASES[prevPhase];
  return Boolean(allowed && nextPhase && allowed.has(nextPhase));
}

/**
 * XState chart for attaché phases (invoked from `chatMachine`).
 * - **intro** ↔ `AttacheState.phase === "start"`
 * - **exploring** ↔ `"explore"`
 * - **baseline1** | **baseline2** | **baseline3** ↔ baseline phases
 * - **closing** ↔ `"close"`
 *
 * `context.attacheState` is the source of truth for prompts/runtime; each `ATTACHE_TURN`
 * applies the pure `transition()`, then `always` routes to the matching state node.
 *
 * Logical domain edges (see `ATTACHE_DOMAIN_ONE_STEP_PHASES`):
 * - **start** → explore | baseline1 | close
 * - **explore** → same | any baseline | close (resume target lives in `potential_next_phase`)
 * - **baseline1** → explore | close | baseline2 | same (mid-question)
 * - **baseline2** → explore | close | baseline3 | same
 * - **baseline3** → explore | close | same (then close when block completes)
 * - **close** → explore | same | resume baseline only if `potential_next_phase` still names a baseline
 *   (early exit). After nominal baseline3 completion, `potential_next_phase` is `"close"`—generic
 *   `baseline` intent then stays in close for the handoff turn.
 *
 * Prompt catalog ids (`attache_prompt_instruction_ids`) are chosen from **AttacheState + session facts**
 * in `attachePromptPolicy`, not from XState node ids—keep `attacheState` and this machine in sync.
 */
const attacheOrchestratorMachine = setup({
  actions: {
    applyAttacheTransition: assign(({ context, event }) => {
      const e = event && event.type === "ATTACHE_TURN" ? event : null;
      let intent = "baseline";
      let asked = true;
      if (e && e.llmOutput && typeof e.llmOutput === "object") {
        intent = normalizeIntent(e.llmOutput);
        asked = !!e.llmOutput.asked_baseline_question;
      } else if (
        e &&
        (e.intent === "explore" || e.intent === "close" || e.intent === "baseline")
      ) {
        intent = e.intent;
        asked = typeof e.askedBaselineQuestion === "boolean" ? e.askedBaselineQuestion : true;
      }
      const prev = context.attacheState != null ? context.attacheState : createAttacheState({});
      const next = transition(prev, intent, asked);
      if (
        process.env.ATTACHE_ASSERT_DOMAIN_TRANSITIONS === "1" &&
        !isValidAttacheOneStepPhasePair(prev.phase, next.phase)
      ) {
        throw new Error(
          `Invalid attache domain transition ${String(prev.phase)} -> ${String(next.phase)} (intent=${intent})`
        );
      }
      return { attacheState: next };
    }),
  },
  guards: {
    phaseIsStart: ({ context }) => context.attacheState?.phase === "start",
    phaseIsExplore: ({ context }) => context.attacheState?.phase === "explore",
    phaseIsBaseline1: ({ context }) => context.attacheState?.phase === "baseline1",
    phaseIsBaseline2: ({ context }) => context.attacheState?.phase === "baseline2",
    phaseIsBaseline3: ({ context }) => context.attacheState?.phase === "baseline3",
    phaseIsClose: ({ context }) => context.attacheState?.phase === "close",
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QEMAurkGMAWYDyATjnKgWgPYEDEAggCp00DCAEgKID6dAqgEoByAbQAMAXUSgADuVgBLVLPIA7CSAAeiAIwA2YQDoALMIAcAVgDsAJnPCD1zeYA0IAJ6IAtAE5zegMy7TX0thYU9fTwNtTwBfaOc0DGJCYlhSCmoRcSQQaTkFZVUNBAtnNwRfYV89S0tTYU1fTRNLTQNfWPj0LFxk3FSyVEoqQU0sqRl5RRVsopLXRCNTPWNNY3NtY39PbVNTGLiQBO78Ij60wYzLMZyJ-OnQWad54pNDTVrLf0bQ81MDDsOXSSpxIAyGgl811ykwKM0QczK2k0mj0IW01mMxk8tXCmgBR2BKXO4IMUNuU0K8KeZXMDT0uhCvgMmkCnmMwm0+KBPRB-XSw1MZLyFLhxWpiGC+m0jVq5mMkXMVk2sQOSnIEDgqgJPKJYIIqmhd0pCE8pUQWL07zqlWl2gMbQaXMSOrOer0siUpHIBvJsIeEoihlCuNMxks7PqBjNCGsnmqq3WFSsbKdx16oPSejAakkABtKB6oD7hX71AGDEGwp4WWGI61o74VssratfEy7CzU4TXZmAEbIWBgXMesCaYsw+5lmOBoxVmvhkL154GeVB9HmXx7UPSvEHbUnXV9gdDkeWcdG0WWGfB6uhheR6OhnwhELhswb2zGLsujMXPT9wdhyUMBfHPEV-WnCtZxDWtFyjZ4NjjPZfDlZkE0if4925A8ez-TB8zkJQi2yQ1wKnK8oJvec63gsoHG0elahCOVkUCYxORVIA */
  id: "attacheOrchestrator",
  initial: "intro",
  context: {
    /** @type {AttacheState|null} */
    attacheState: createAttacheState({ phase: "start" }),
  },
  states: {
    intro: {
      description: "Opening / orientation (phase start)",

      meta: {
        domainPhase: "start",
        domainNextPhases: ["explore", "baseline1", "close"],
      }
    },

    exploring: {
      description: "Agency exploration, baseline paused",
      meta: {
        domainPhase: "explore",
        domainNextPhases: ["explore", "baseline1", "baseline2", "baseline3", "close"],
        note: "Resume target is potential_next_phase (interrupted baseline).",
      },
    },

    baseline1: {
      description: "Baseline phase 1",
      meta: {
        domainPhase: "baseline1",
        domainNextPhases: ["baseline1", "baseline2", "explore", "close"],
      },
    },

    baseline2: {
      description: "Baseline phase 2",
      meta: {
        domainPhase: "baseline2",
        domainNextPhases: ["baseline2", "baseline3", "explore", "close"],
      },
    },

    baseline3: {
      description: "Baseline phase 3",
      meta: {
        domainPhase: "baseline3",
        domainNextPhases: ["baseline3", "explore", "close"],
      },
    },

    closing: {
      description: "Handoff / farewell toward detective",
      meta: {
        domainPhase: "close",
        domainNextPhases: ["close", "explore", "baseline1", "baseline2", "baseline3"],
        note: "Resume baseline uses phase_before_close + question_index_before_close when applicable.",
      },
    }
  },
  on: {
    ATTACHE_TURN: {
      actions: ["applyAttacheTransition"],
    },
  },
  /** Sync orchestrator node to `context.attacheState.phase` after each `ATTACHE_TURN`. */
  always: [
    { guard: "phaseIsStart", target: ".intro" },
    { guard: "phaseIsExplore", target: ".exploring" },
    { guard: "phaseIsBaseline1", target: ".baseline1" },
    { guard: "phaseIsBaseline2", target: ".baseline2" },
    { guard: "phaseIsBaseline3", target: ".baseline3" },
    { guard: "phaseIsClose", target: ".closing" },
  ],
});

module.exports = {
  ATTACHE_MAX_TURNS,
  RANDOM_Q_ORDER,
  MIN_BASELINE1_QUESTIONS,
  MAX_BASELINE1_QUESTIONS,
  MIN_BASELINE2_QUESTIONS,
  MAX_BASELINE2_QUESTIONS,
  MIN_BASELINE3_QUESTIONS,
  MAX_BASELINE3_QUESTIONS,
  ATTACHE_DOMAIN_ONE_STEP_PHASES,
  isValidAttacheOneStepPhasePair,
  getRandomBaselineQuestionCount,
  getBaselineNumberFromPhase,
  createAttacheState,
  normalizeIntent,
  transition,
  computeCurrentPhaseId,
  attacheOrchestratorMachine,
};
