"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAttacheState } = require("./attacheMachine");
const {
  buildPromptContextFromState,
  resolveBaselineNumberForTemplates,
} = require("./attachePromptContext");

test("resolveBaselineNumberForTemplates: explore uses previous_phase when baseline_number missing", () => {
  const s = createAttacheState({
    phase: "explore",
    question_index: 0,
    potential_next_phase: "baseline1",
    previous_phase: "baseline1",
  });
  s.baseline_number = null;
  assert.equal(resolveBaselineNumberForTemplates(s, null, null), 1);
});

test("resolveBaselineNumberForTemplates: explore uses potential_next_phase when previous missing", () => {
  const s = createAttacheState({
    phase: "explore",
    question_index: 0,
    potential_next_phase: "baseline2",
  });
  s.baseline_number = null;
  s.previous_phase = null;
  assert.equal(resolveBaselineNumberForTemplates(s, null, null), 2);
});

test("buildPromptContextFromState: fills baselineN_* for explore without baseline_number field", () => {
  const s = createAttacheState({
    phase: "explore",
    question_index: 0,
    potential_next_phase: "baseline1",
    previous_phase: "baseline1",
  });
  s.baseline_number = null;
  const ctx = buildPromptContextFromState(s, {}, null);
  assert.ok(typeof ctx.baselineN_questionQ === "string" && ctx.baselineN_questionQ.length > 0);
  assert.ok(typeof ctx.baselineN_instructions === "string" && ctx.baselineN_instructions.length > 0);
  assert.ok(!ctx.baselineN_questionQ.includes("{baselineN_"));
  assert.ok(!ctx.baselineN_instructions.includes("{baselineN_"));
});
