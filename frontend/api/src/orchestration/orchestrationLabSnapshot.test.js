"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildOrchestrationLabSnapshot,
  runOrchestrationLabStep,
} = require("./orchestrationLabSnapshot");
const { attacheStateFromLabPreset, mergeAttacheLabOverrides } = require("../chatScenarioPreview");
const { createAttacheState } = require("../attache/attacheMachine");
const { setAttacheSessionForDevSession } = require("../chatService");
const { createInitialAttacheSessionState } = require("../attache/attacheRuntime");

test("buildOrchestrationLabSnapshot: empty sessionId returns null sections", () => {
  const o = buildOrchestrationLabSnapshot("");
  assert.equal(o.sessionId, null);
  assert.equal(o.chat, null);
  assert.equal(o.detective, null);
  assert.equal(o.philosophers, null);
  assert.equal(o.attache, null);
});

test("attacheStateFromLabPreset merges overrides", () => {
  const s = attacheStateFromLabPreset({
    attachePhase: "explore",
    potential_next_phase: "baseline2",
    question_index: 1,
  });
  assert.equal(s.phase, "explore");
  assert.equal(s.potential_next_phase, "baseline2");
  assert.equal(s.question_index, 1);
  assert.ok(typeof s.current_phase_id === "string");
});

test("mergeAttacheLabOverrides ignores invalid potential_next_phase", () => {
  const base = createAttacheState({ phase: "explore" });
  const prev = base.potential_next_phase;
  const m = mergeAttacheLabOverrides(base, { potential_next_phase: "invalid" });
  assert.equal(m.potential_next_phase, prev);
});

test("runOrchestrationLabStep throws on invalid type", () => {
  assert.throws(
    () => runOrchestrationLabStep("lab-test-session-orchestration", { type: "UNKNOWN" }),
    /Invalid orchestration step type/
  );
});

test("runOrchestrationLabStep ATTACHE_TURN_BASELINE advances session", () => {
  const sid = "lab-attache-adv-" + Date.now();
  const attacheState = attacheStateFromLabPreset({ attachePhase: "baseline1" });
  setAttacheSessionForDevSession(
    sid,
    createInitialAttacheSessionState({ attacheState })
  );
  runOrchestrationLabStep(sid, { type: "ATTACHE_TURN_BASELINE", payload: { askedBaselineQuestion: true } });
  const o = buildOrchestrationLabSnapshot(sid);
  assert.ok(o.attache && o.attache.attacheState);
  assert.ok(typeof o.attache.attacheState.phase === "string");
});

test("runOrchestrationLabStep ATTACHE_ADVANCE_QUESTION_INDEX increments index within baseline phase", () => {
  const sid = "lab-attache-qidx-" + Date.now();
  const attacheState = createAttacheState({
    phase: "baseline1",
    question_index: 0,
    n_questions_in_baseline: 3,
    baseline_number: 1,
    potential_next_phase: "baseline2",
  });
  setAttacheSessionForDevSession(
    sid,
    createInitialAttacheSessionState({
      attacheState,
      baseline_question_counts: { 1: 3, 2: 2, 3: 2 },
    })
  );
  runOrchestrationLabStep(sid, { type: "ATTACHE_ADVANCE_QUESTION_INDEX" });
  const o = buildOrchestrationLabSnapshot(sid);
  assert.ok(o.attache && o.attache.attacheState);
  assert.equal(o.attache.attacheState.phase, "baseline1");
  assert.equal(o.attache.attacheState.question_index, 1);
});

test("runOrchestrationLabStep ATTACHE_ADVANCE_QUESTION_INDEX throws at last question in block", () => {
  const sid = "lab-attache-qidx-last-" + Date.now();
  const attacheState = createAttacheState({
    phase: "baseline1",
    question_index: 2,
    n_questions_in_baseline: 3,
    baseline_number: 1,
    potential_next_phase: "baseline2",
  });
  setAttacheSessionForDevSession(
    sid,
    createInitialAttacheSessionState({
      attacheState,
      baseline_question_counts: { 1: 3, 2: 2, 3: 2 },
    })
  );
  assert.throws(
    () => runOrchestrationLabStep(sid, { type: "ATTACHE_ADVANCE_QUESTION_INDEX" }),
    /Already at the last question/
  );
});
