"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAttacheState } = require("./attacheMachine");
const {
  computeAttacheCatalogInstructionIds,
  computeAttachePhaseInstructionIds,
  classifyAttacheFirstTurnReturnPrimary,
} = require("./attachePromptPolicy");

test("computeAttachePhaseInstructionIds: start first vs second turn", () => {
  assert.deepEqual(
    computeAttachePhaseInstructionIds({
      attacheState: createAttacheState({ phase: "start" }),
      attache_turn_count: 0,
    }),
    ["ATTACHE_START_ORIENTATION"]
  );
  assert.deepEqual(
    computeAttachePhaseInstructionIds({
      attacheState: createAttacheState({ phase: "start" }),
      attache_turn_count: 1,
    }),
    ["ATTACHE_START_ORIENTATION", "ATTACHE_BASELINE_DELIVERY_START"]
  );
});

test("computeAttachePhaseInstructionIds: explore general vs resume baseline", () => {
  assert.deepEqual(
    computeAttachePhaseInstructionIds({
      attacheState: createAttacheState({ phase: "explore", potential_next_phase: "start" }),
    }),
    ["ATTACHE_EXPLORE_GENERAL", "ATTACHE_BASELINE_DELIVERY_START"]
  );
  assert.deepEqual(
    computeAttachePhaseInstructionIds({
      attacheState: createAttacheState({
        phase: "explore",
        potential_next_phase: "baseline2",
      }),
    }),
    ["ATTACHE_EXPLORE_RESUME_BASELINE", "ATTACHE_BASELINE_DELIVERY_START"]
  );
});

test("computeAttachePhaseInstructionIds: baseline first vs mid question", () => {
  assert.deepEqual(
    computeAttachePhaseInstructionIds({
      attacheState: createAttacheState({
        phase: "baseline1",
        question_index: 0,
        baseline_number: 1,
      }),
    }),
    ["ATTACHE_BASELINE_DELIVERY_START"]
  );
  assert.deepEqual(
    computeAttachePhaseInstructionIds({
      attacheState: createAttacheState({
        phase: "baseline1",
        question_index: 1,
        baseline_number: 1,
      }),
    }),
    ["ATTACHE_BASELINE_MID_QUESTION"]
  );
});

test("computeAttachePhaseInstructionIds: close branches", () => {
  assert.deepEqual(
    computeAttachePhaseInstructionIds({
      attacheState: createAttacheState({
        phase: "close",
        phase_before_close: "baseline1",
        current_phase_id: "close_from_baseline1",
      }),
      attache_close_count: 1,
    }),
    ["ATTACHE_CLOSE_EARLY_EXIT_CONFIRM"]
  );
  assert.deepEqual(
    computeAttachePhaseInstructionIds({
      attacheState: createAttacheState({
        phase: "close",
        phase_before_close: "baseline3",
        current_phase_id: "close_from_final_baseline3",
      }),
    }),
    ["ATTACHE_CLOSE_FINAL"]
  );
  assert.deepEqual(
    computeAttachePhaseInstructionIds({
      attacheState: createAttacheState({
        phase: "close",
        phase_before_close: "explore",
        current_phase_id: "close_from_explore",
      }),
    }),
    ["ATTACHE_CLOSE_DEFAULT"]
  );
});

test("computeAttacheCatalogInstructionIds: return tier precedes phase tier", () => {
  const ids = computeAttacheCatalogInstructionIds({
    attacheState: createAttacheState({ phase: "baseline1", question_index: 0, baseline_number: 1 }),
    attache_turn_count: 0,
    attache_close_count: 0,
    visit_bin: "moderate",
    baseline_return_greeting_pending: false,
    stale_dossier_rebaseline: false,
    returnCategory: "",
  });
  assert.equal(ids[0], "ATTACHE_RETURN_DAY_OR_SO");
  assert.equal(ids[1], "ATTACHE_RETURN_APPEND_NO_DOSSIER");
  assert.ok(ids.includes("ATTACHE_BASELINE_DELIVERY_START"));
});

test("computeAttacheCatalogInstructionIds: omits ATTACHE_RETURN_* when attache_turn_count > 0", () => {
  const ids = computeAttacheCatalogInstructionIds({
    attacheState: createAttacheState({ phase: "start" }),
    attache_turn_count: 1,
    attache_close_count: 0,
    visit_bin: "moderate",
    baseline_return_greeting_pending: false,
    stale_dossier_rebaseline: false,
    returnCategory: "",
  });
  assert.ok(!ids.includes("ATTACHE_RETURN_DAY_OR_SO"));
  assert.ok(!ids.some((id) => String(id).startsWith("ATTACHE_RETURN_APPEND_")));
  assert.deepEqual(ids, ["ATTACHE_START_ORIENTATION", "ATTACHE_BASELINE_DELIVERY_START"]);
});

test("classifyAttacheFirstTurnReturnPrimary: buckets mirror computeAttacheReturnTierInstructionIds", () => {
  const base = {
    baseline_return_greeting_pending: false,
    stale_dossier_rebaseline: false,
    returnCategory: "",
    has_dossier: false,
    dossier_stale_by_age: false,
  };
  assert.equal(classifyAttacheFirstTurnReturnPrimary({ ...base, visit_bin: "moderate" }), "dayOrSo");
  assert.equal(classifyAttacheFirstTurnReturnPrimary({ ...base, visit_bin: "brief" }), "none");
  assert.equal(
    classifyAttacheFirstTurnReturnPrimary({
      ...base,
      visit_bin: "stale",
      baseline_return_greeting_pending: true,
    }),
    "staleVisit"
  );
  assert.equal(
    classifyAttacheFirstTurnReturnPrimary({
      ...base,
      visit_bin: "long",
      baseline_return_greeting_pending: true,
    }),
    "longGone"
  );
  assert.equal(
    classifyAttacheFirstTurnReturnPrimary({
      ...base,
      visit_bin: "brief",
      stale_dossier_rebaseline: true,
    }),
    "staleVisit"
  );
});
