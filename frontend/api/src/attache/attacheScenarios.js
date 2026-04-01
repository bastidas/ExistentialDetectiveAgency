"use strict";

// Canonical scenarios for the attaché orchestrator.

const { createAttacheState } = require("./attacheOrchestrator");

// Helper to generate all baseline-related scenarios for a single baseline number.
function makeBaselineScenarios(baselineNumber, midQuestionIndex) {
  const baselinePhase = `baseline${baselineNumber}`;
  const nextBaselinePhase = `baseline${baselineNumber + 1}`;

  const scenarios = [];

  // Explore from baselineN before having started it (user needs instructions).
  scenarios.push({
    id: `explore_from_baseline${baselineNumber}`,
    alt_id: `explore_while_baseline${baselineNumber}`,
    description: `In explore, having paused baseline${baselineNumber} before start; user needs instructions.`,
    initState: () =>
      createAttacheState({
        phase: "explore",
        potential_next_phase: baselinePhase,
        question_index: 0,
      }),
  });

  // Explore from mid-baselineN
  scenarios.push({
    id: `explore_from_mid_baseline${baselineNumber}`,
    alt_id: `explore_while_mid_baseline${baselineNumber}`,
    description: `In explore, having paused mid baseline${baselineNumber}.`,
    initState: () =>
      createAttacheState({
        phase: "explore",
        potential_next_phase: baselinePhase,
        question_index: midQuestionIndex,
      }),
  });

  // Enter baseline (N+1) from previous baseline N (only if such a next phase exists).
  if (baselineNumber < 3) {
    scenarios.push({
      id: `baseline${baselineNumber + 1}_from_mid_baseline${baselineNumber}`,
      alt_id: `baseline${baselineNumber + 1}_while_mid_baseline${baselineNumber}`,
      description: `Entering baseline${baselineNumber + 1} phase for the first time, user needs instructions.`,
      initState: () =>
        createAttacheState({
          phase: nextBaselinePhase,
          potential_next_phase: nextBaselinePhase,
          question_index: 0,
        }),
    });
  }

  // Mid-baselineN question.
  // this ONLY MAKES SENSE IF nextBaselinePhase=baselinePhase
  scenarios.push({
    id: `baseline${baselineNumber}_from_mid_baseline${baselineNumber}`,
    alt_id: `baseline${baselineNumber}_while_mid_baseline${baselineNumber}`,
    description: `In baseline${baselineNumber} phase, asking a question mid-phase.`,
    initState: () =>
      createAttacheState({
        phase: baselinePhase,
        // still in the same baseline phase; potential next phase is this phase
        potential_next_phase: baselinePhase,
        question_index: midQuestionIndex,
      }),
  });

  // Close from completed/started baselineN (simple resume point at index 0).
  scenarios.push({
    id: `close_from_baseline${baselineNumber}`,
    alt_id: `close_while_baseline${baselineNumber}`,
    description: `In close, having come from start baseline phase ${baselineNumber}; user still needs instructions.`,
    initState: () =>
      createAttacheState({
        phase: "close",
        potential_next_phase: baselinePhase,
        // We conceptually closed from the start of this baseline.
        question_index: 0,
        previous_phase: baselinePhase,
        previous_question_index: 0,
      }),
  });

  // Close from mid-baselineN.
  scenarios.push({
    id: `close_from_mid_baseline${baselineNumber}`,
    alt_id: `close_from_mid_baseline${baselineNumber}`,
    description: `In close, having come from the middle of baseline phase ${baselineNumber}.`,
    initState: () =>
      createAttacheState({
        phase: "close",
        potential_next_phase: baselinePhase,
        // We conceptually closed from the middle of this baseline.
        question_index: midQuestionIndex,
        previous_phase: baselinePhase,
        previous_question_index: midQuestionIndex,
      }),
  });

  return scenarios;
}

// Default baseline numbers and a canonical "mid-phase" index (> 0).
const DEFAULT_BASELINE_NUMBERS = [1, 2, 3];
const DEFAULT_MID_QUESTION_INDEX = 1;

// Public helper to generate the full scenario list (enumerates baseline numbers).
function makeAllScenarios(options = {}) {
  const baselines = options.baselines || DEFAULT_BASELINE_NUMBERS;
  const midQuestionIndex =
    options.midQuestionIndex !== undefined ? options.midQuestionIndex : DEFAULT_MID_QUESTION_INDEX;

  const scenarios = [];

  // Start from a null state.
  scenarios.push({
    id: "start_from_null",
    alt_id: "start_while_baseline1",
    description:
      "In the lobby/start phase, starting from a null state (e.g. new session with no prior state).",
    initState: () =>
      createAttacheState({
        phase: "start",
        potential_next_phase: "baseline1",
        question_index: 0,
      }),
  });

  // Close directly from start (no baseline ever started).
  scenarios.push({
    id: "close_from_start",
    alt_id: "close_from_start_no_baseline",
    description:
      "In close, having come directly from start (no baseline was ever started).",
    initState: () =>
      createAttacheState({
        phase: "close",
        potential_next_phase: "start",
        // Closed directly from start; no baseline history.
        question_index: 0,
        previous_phase: "start",
        previous_question_index: 0,
      }),
  });

  // All baseline-related scenarios.
  for (const n of baselines) {
    scenarios.push(...makeBaselineScenarios(n, midQuestionIndex));
  }

  return scenarios;
}

// Default, fully-enumerated canonical scenarios.
const SCENARIOS = makeAllScenarios();

module.exports = {
  SCENARIOS,
  makeAllScenarios,
};
