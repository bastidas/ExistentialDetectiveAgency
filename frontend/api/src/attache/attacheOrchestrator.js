"use strict";

const { setup, assign, createActor } = require("xstate");

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

function computeCurrentPhaseId(state) {
  const { phase, question_index, previous_phase, previous_question_index, n_questions_in_baseline } =
    state;

  if (phase === "start") return "start_from_null";
  if (phase === "explore") {
    const bNumber = getBaselineNumberFromPhase(state.potential_next_phase || "");
    if (bNumber && question_index > 0) return `explore_from_mid_baseline${bNumber}`;
    if (bNumber) return `explore_from_baseline${bNumber}`;
    return "explore_from_start";
  }
  if (phase === "close") {
    if (!previous_phase || previous_phase === "start") return "close_from_start";
    const bNumber = getBaselineNumberFromPhase(previous_phase);
    if (bNumber == null) return "close";
    if (
      typeof n_questions_in_baseline === "number" &&
      n_questions_in_baseline > 0 &&
      previous_question_index != null &&
      previous_question_index >= n_questions_in_baseline - 1
    ) {
      return `close_from_final_baseline${bNumber}`;
    }
    if (previous_question_index && previous_question_index > 0) {
      return `close_from_mid_baseline${bNumber}`;
    }
    return `close_from_baseline${bNumber}`;
  }
  if (phase.startsWith("baseline")) {
    const bNumber = getBaselineNumberFromPhase(phase);
    if (bNumber == null) return phase;
    if (question_index > 0) return `baseline${bNumber}_from_mid_baseline${bNumber}`;

    const originIsBaseline = previous_phase && previous_phase.startsWith("baseline");
    if (originIsBaseline && previous_phase !== phase) {
      const fromNum = getBaselineNumberFromPhase(previous_phase);
      if (fromNum != null) return `baseline${bNumber}_from_mid_baseline${fromNum}`;
    }
    return `baseline${bNumber}_from_start`;
  }
  return phase;
}

function createAttacheState(options = {}) {
  const phase = options.phase || "start";
  const baseline_number =
    options.baseline_number !== undefined && options.baseline_number !== null
      ? options.baseline_number
      : getBaselineNumberFromPhase(phase);

  const n_questions_in_baseline =
    options.n_questions_in_baseline != null
      ? options.n_questions_in_baseline
      : phase.startsWith("baseline")
      ? getRandomBaselineQuestionCount(
          baseline_number != null ? baseline_number : getBaselineNumberFromPhase(phase)
        )
      : 0;

  const state = {
    phase,
    baseline_number,
    question_index: options.question_index != null ? options.question_index : 0,
    n_questions_in_baseline,
    potential_next_phase:
      options.potential_next_phase !== undefined ? options.potential_next_phase : null,
    previous_phase: options.previous_phase !== undefined ? options.previous_phase : null,
    previous_question_index:
      options.previous_question_index !== undefined ? options.previous_question_index : null,
    current_phase_id: options.current_phase_id || null,
  };

  if (!state.current_phase_id) {
    state.current_phase_id = computeCurrentPhaseId(state);
  }
  return state;
}

function transitionPure(state, intent, askedBaselineQuestion) {
  const phase = state.phase;
  const qIndex = state.question_index;
  const nQuestions = state.n_questions_in_baseline;

  function make(overrides, carryQuestions) {
    const base = { ...overrides };
    if (carryQuestions && typeof nQuestions === "number") {
      base.n_questions_in_baseline = nQuestions;
    }
    return createAttacheState(base);
  }

  if (phase === "start") {
    if (intent === "explore") {
      return make(
        {
          phase: "explore",
          question_index: 0,
          potential_next_phase: "baseline1",
          previous_phase: "start",
          previous_question_index: qIndex,
        },
        true
      );
    }
    if (intent === "close") {
      return make(
        {
          phase: "close",
          question_index: qIndex,
          potential_next_phase: "start",
          previous_phase: "start",
          previous_question_index: qIndex,
        },
        true
      );
    }
    return make(
      {
        phase: "baseline1",
        question_index: askedBaselineQuestion ? 1 : 0,
        potential_next_phase: "baseline2",
        previous_phase: "start",
        previous_question_index: qIndex,
      },
      false
    );
  }

  if (phase.startsWith("baseline")) {
    const currentBaseline = phase;

    if (intent === "explore") {
      return make(
        {
          phase: "explore",
          question_index: qIndex,
          potential_next_phase: currentBaseline,
          previous_phase: currentBaseline,
          previous_question_index: qIndex,
        },
        true
      );
    }

    if (intent === "close") {
      return make(
        {
          phase: "close",
          question_index: qIndex,
          potential_next_phase: currentBaseline,
          previous_phase: currentBaseline,
          previous_question_index: qIndex,
        },
        true
      );
    }

    if (!askedBaselineQuestion) return state;
    if (typeof nQuestions !== "number" || nQuestions <= 0) return state;

    const nextIndex = qIndex + 1;
    if (nextIndex < nQuestions) {
      return make(
        {
          phase: currentBaseline,
          question_index: nextIndex,
          potential_next_phase: currentBaseline,
          previous_phase: currentBaseline,
          previous_question_index: qIndex,
        },
        true
      );
    }

    if (currentBaseline === "baseline1") {
      return make(
        {
          phase: "baseline2",
          question_index: 0,
          potential_next_phase: "baseline3",
          previous_phase: "baseline1",
          previous_question_index: qIndex,
        },
        false
      );
    }
    if (currentBaseline === "baseline2") {
      return make(
        {
          phase: "baseline3",
          question_index: 0,
          potential_next_phase: "close",
          previous_phase: "baseline2",
          previous_question_index: qIndex,
        },
        false
      );
    }
    if (currentBaseline === "baseline3") {
      return make(
        {
          phase: "close",
          question_index: qIndex,
          potential_next_phase: "close",
          previous_phase: "baseline3",
          previous_question_index: qIndex,
        },
        true
      );
    }
    return state;
  }

  if (phase === "explore") {
    if (intent === "explore") return state;

    if (intent === "close") {
      const originPhase = state.previous_phase || "start";
      const originIndex = state.previous_question_index != null ? state.previous_question_index : qIndex;
      return make(
        {
          phase: "close",
          question_index: qIndex,
          potential_next_phase: originPhase.startsWith("baseline") ? originPhase : "start",
          previous_phase: originPhase,
          previous_question_index: originIndex,
        },
        true
      );
    }

    if (state.potential_next_phase && state.potential_next_phase.startsWith("baseline")) {
      return make(
        {
          phase: state.potential_next_phase,
          question_index: qIndex,
          potential_next_phase: state.potential_next_phase,
          previous_phase: "explore",
          previous_question_index: qIndex,
        },
        true
      );
    }

    return make(
      {
        phase: "baseline1",
        question_index: 0,
        potential_next_phase: "baseline2",
        previous_phase: "explore",
        previous_question_index: qIndex,
      },
      false
    );
  }

  if (phase === "close") {
    if (intent === "close") return state;

    if (intent === "explore") {
      const originPhase = state.previous_phase || "start";
      const originIndex = state.previous_question_index != null ? state.previous_question_index : qIndex;
      return make(
        {
          phase: "explore",
          question_index: originIndex,
          potential_next_phase: originPhase.startsWith("baseline") ? originPhase : "baseline1",
          previous_phase: "close",
          previous_question_index: qIndex,
        },
        true
      );
    }

    if (state.previous_phase && state.previous_phase.startsWith("baseline")) {
      if (state.previous_phase === "baseline3" && typeof nQuestions === "number") {
        const lastIndex = nQuestions > 0 ? nQuestions - 1 : 0;
        const prevIdx = state.previous_question_index != null ? state.previous_question_index : qIndex;
        if (prevIdx >= lastIndex) return state;
      }
      const resumeIndex = state.previous_question_index != null ? state.previous_question_index : 0;
      return make(
        {
          phase: state.previous_phase,
          question_index: resumeIndex,
          potential_next_phase: state.previous_phase,
          previous_phase: "close",
          previous_question_index: qIndex,
        },
        true
      );
    }
    return state;
  }

  return state;
}

const attacheOrchestrationMachine = setup({
  types: {},
  actions: {
    applyTransition: assign(({ context, event }) => {
      if (!event || event.type !== "TRANSITION") return context;
      return transitionPure(context, event.intent, !!event.askedBaselineQuestion);
    }),
  },
}).createMachine({
  id: "attacheOrchestration",
  initial: "active",
  context: ({ input }) => createAttacheState(input && input.state ? input.state : {}),
  states: {
    active: {
      on: {
        TRANSITION: {
          actions: "applyTransition",
        },
      },
    },
  },
});

function transition(state, intent, askedBaselineQuestion) {
  const actor = createActor(attacheOrchestrationMachine, {
    input: { state: createAttacheState(state || {}) },
  });
  actor.start();
  actor.send({
    type: "TRANSITION",
    intent,
    askedBaselineQuestion: !!askedBaselineQuestion,
  });
  return actor.getSnapshot().context;
}

function normalizeIntent(raw) {
  const explore = !!(raw && raw.user_intends_explore);
  const close = !!(raw && raw.user_intends_close);

  if (close && !explore) return "close";
  if (explore && !close) return "explore";
  if (explore && close) return "close";
  return "baseline";
}

module.exports = {
  MIN_BASELINE1_QUESTIONS,
  MAX_BASELINE1_QUESTIONS,
  MIN_BASELINE2_QUESTIONS,
  MAX_BASELINE2_QUESTIONS,
  MIN_BASELINE3_QUESTIONS,
  MAX_BASELINE3_QUESTIONS,
  ATTACHE_MAX_TURNS,
  RANDOM_Q_ORDER,
  attacheOrchestrationMachine,
  getRandomBaselineQuestionCount,
  getBaselineNumberFromPhase,
  computeCurrentPhaseId,
  createAttacheState,
  transition,
  normalizeIntent,
};
