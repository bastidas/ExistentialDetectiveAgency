"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  transition,
  createAttacheState,
  isValidAttacheOneStepPhasePair,
  ATTACHE_DOMAIN_ONE_STEP_PHASES,
} = require("./attacheMachine");

/**
 * Minimal valid `AttacheState` per domain phase for exercising `transition()`.
 * @param {string} phase
 */
function minimalStateForPhase(phase) {
  if (phase === "start") {
    return createAttacheState({ phase: "start" });
  }
  if (phase === "explore") {
    return createAttacheState({
      phase: "explore",
      potential_next_phase: "baseline1",
      question_index: 0,
    });
  }
  if (phase === "baseline1") {
    return createAttacheState({
      phase: "baseline1",
      question_index: 0,
      n_questions_in_baseline: 2,
      baseline_number: 1,
      potential_next_phase: "baseline2",
    });
  }
  if (phase === "baseline2") {
    return createAttacheState({
      phase: "baseline2",
      question_index: 0,
      n_questions_in_baseline: 2,
      baseline_number: 2,
      potential_next_phase: "baseline3",
    });
  }
  if (phase === "baseline3") {
    return createAttacheState({
      phase: "baseline3",
      question_index: 0,
      n_questions_in_baseline: 2,
      baseline_number: 3,
      potential_next_phase: "close",
    });
  }
  if (phase === "close") {
    return createAttacheState({
      phase: "close",
      phase_before_close: "baseline1",
      potential_next_phase: "baseline1",
      question_index_before_close: 0,
    });
  }
  return createAttacheState({ phase: "start" });
}

const INTENTS = /** @type {const} */ (["explore", "close", "baseline"]);

test("transition() every sampled intent obeys ATTACHE_DOMAIN_ONE_STEP_PHASES", () => {
  const phases = ["start", "explore", "baseline1", "baseline2", "baseline3", "close"];
  for (const ph of phases) {
    const s = minimalStateForPhase(ph);
    for (const intent of INTENTS) {
      const askedOpts = intent === "baseline" ? [true, false] : [true];
      for (const asked of askedOpts) {
        const next = transition(s, intent, asked);
        assert.ok(
          isValidAttacheOneStepPhasePair(s.phase, next.phase),
          `${ph} + ${intent}(asked=${asked}) -> ${next.phase}`
        );
      }
    }
  }
});

test("ATTACHE_DOMAIN_ONE_STEP_PHASES matches documented adjacency shape", () => {
  assert.ok(ATTACHE_DOMAIN_ONE_STEP_PHASES.start.has("explore"));
  assert.ok(ATTACHE_DOMAIN_ONE_STEP_PHASES.explore.has("baseline2"));
  assert.ok(ATTACHE_DOMAIN_ONE_STEP_PHASES.baseline1.has("baseline2"));
  assert.ok(ATTACHE_DOMAIN_ONE_STEP_PHASES.baseline2.has("baseline3"));
  assert.ok(ATTACHE_DOMAIN_ONE_STEP_PHASES.baseline3.has("close"));
  assert.ok(ATTACHE_DOMAIN_ONE_STEP_PHASES.close.has("baseline1"));
});

test("close + baseline intent: final handoff (potential_next_phase=close) stays in close", () => {
  const s = createAttacheState({
    phase: "close",
    phase_before_close: "baseline3",
    question_index_before_close: 0,
    potential_next_phase: "close",
    baseline_number: 3,
  });
  const next = transition(s, "baseline", true);
  assert.equal(next.phase, "close");
  assert.equal(next.current_phase_id, "close_from_final_baseline3");
});

test("close + baseline intent: early exit still resumes baseline via potential_next_phase", () => {
  const s = createAttacheState({
    phase: "close",
    phase_before_close: "baseline3",
    question_index_before_close: 0,
    potential_next_phase: "baseline3",
    baseline_number: 3,
    n_questions_in_baseline: 2,
  });
  const next = transition(s, "baseline", true);
  assert.equal(next.phase, "baseline3");
  assert.equal(next.question_index, 0);
});
