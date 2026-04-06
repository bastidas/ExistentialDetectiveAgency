"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAttacheState } = require("../attache/attacheMachine");
const { getPromptPattern } = require("../attache/attachePrompts");
const { composeAgentPrompt } = require("./promptComposer");
const { buildAgentTurn } = require("./turnBuilderRegistry");

/** Deterministic session slice for compose (baseline question order). */
function mockSession() {
  return {
    baseline_question_counts: { 1: 2, 2: 2, 3: 2 },
    baseline_question_order: {
      1: [0, 1],
      2: [0, 1],
      3: [0, 1],
    },
    attache_close_count: 0,
    attache_turn_count: 0,
  };
}

function composedForState(attacheState, sessionOverrides = {}) {
  const session = {
    ...mockSession(),
    attacheState,
    ...sessionOverrides,
  };
  const out = composeAgentPrompt({
    agentKey: "attache",
    session,
    internalState: {},
    custom: "",
    attacheTurnInstruction: { attachePromptFamilyKey: null },
  });
  const pattern = getPromptPattern(attacheState);
  return { content: out.content, pattern };
}

test("buildAgentTurn rejects unknown agentKey", () => {
  assert.throws(
    () => buildAgentTurn({ agentKey: "not_a_registered_agent", state: createAttacheState({}) }),
    /unknown agentKey/
  );
});

test("buildAgentTurn(attache): empty custom; catalog tail via composeAgentPrompt", () => {
  const state = createAttacheState({ phase: "start" });
  const result = buildAgentTurn({
    agentKey: "attache",
    state,
    context: {},
  });
  assert.equal(result.custom, "");
  assert.equal(result.metadata && result.metadata.promptFamilyKey, getPromptPattern(state).key);

  const { content } = composedForState(state);
  assert.ok(content.includes("# TURN INSTRUCTIONS"));
  assert.ok(content.includes("The querent is just arriving"));
});

test("composeAgentPrompt(attache) start / explore / baselines / close: catalog turn block + metadata key", () => {
  const cases = [
    {
      name: "start",
      state: createAttacheState({ phase: "start" }),
      includes: ["# TURN INSTRUCTIONS", "The querent is just arriving"],
      excludes: ["If you have NOT yet shown the user"],
    },
    {
      name: "start_second_turn_includes_baseline_delivery",
      state: createAttacheState({ phase: "start" }),
      sessionOverrides: { attache_turn_count: 1 },
      includes: ["# TURN INSTRUCTIONS", "If you have NOT yet shown the user"],
    },
    {
      name: "explore",
      state: createAttacheState({ phase: "explore", potential_next_phase: "baseline1" }),
      includes: ["# TURN INSTRUCTIONS", "middle of a baseline test"],
    },
    {
      name: "baseline1_q0",
      state: createAttacheState({ phase: "baseline1", question_index: 0, baseline_number: 1 }),
      includes: ["# TURN INSTRUCTIONS", "Phase 1"],
    },
    {
      name: "baseline1_q1",
      state: createAttacheState({ phase: "baseline1", question_index: 1, baseline_number: 1 }),
      includes: ["# TURN INSTRUCTIONS", "Ask the user this exact question"],
    },
    {
      name: "baseline2",
      state: createAttacheState({ phase: "baseline2", question_index: 0, baseline_number: 2 }),
      includes: ["# TURN INSTRUCTIONS", "Despite the numerous anomalies"],
    },
    {
      name: "baseline3",
      state: createAttacheState({ phase: "baseline3", question_index: 0, baseline_number: 3 }),
      includes: ["# TURN INSTRUCTIONS", "go deeper"],
    },
    {
      name: "close_generic",
      state: createAttacheState({
        phase: "close",
        phase_before_close: "explore",
        current_phase_id: "close_from_explore",
      }),
      includes: ["# TURN INSTRUCTIONS", "The user may be ready to end"],
    },
    {
      name: "close_from_final_baseline3",
      state: createAttacheState({
        phase: "close",
        phase_before_close: "baseline3",
        current_phase_id: "close_from_final_baseline3",
      }),
      includes: ["# TURN INSTRUCTIONS", "completed all the baseline questions"],
    },
  ];

  for (const { name, state, includes, excludes, sessionOverrides } of cases) {
    const { content, pattern } = composedForState(state, sessionOverrides || {});
    assert.ok(content && content.length > 0, `${name}: composed content non-empty`);
    for (const sub of includes) {
      assert.ok(
        content.includes(sub),
        `${name}: expected content to include ${JSON.stringify(sub)}`
      );
    }
    if (Array.isArray(excludes)) {
      for (const sub of excludes) {
        assert.ok(
          !content.includes(sub),
          `${name}: expected content NOT to include ${JSON.stringify(sub)}`
        );
      }
    }
    const r = buildAgentTurn({
      agentKey: "attache",
      state,
      context: {},
    });
    assert.equal(
      r.metadata && r.metadata.promptFamilyKey,
      pattern.key,
      `${name}: promptFamilyKey matches getPromptPattern`
    );
  }
});
