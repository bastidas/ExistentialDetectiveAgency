"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectSpecialInstructions } = require("./instructionSelection");
const { computeAttacheReturnTierInstructionIds } = require("../attache/attachePromptPolicy");
const { createAttacheState, getAttachePromptInstructionIdsFromSnapshot } = require("../attache/attacheMachine");
const { advanceAttacheOrchestratorForPromptTurn } = require("../attache/attacheOrchestratorAdvance");
const { resolveAttachePromptInstructionIdsForTurn } = require("./promptCatalogUtils");

test("selectSpecialInstructions attache returns [] (ids from attachePromptPolicy + session merge)", () => {
  assert.deepEqual(
    selectSpecialInstructions("attache", {
      visit_bin: "moderate",
      baseline_return_greeting_pending: false,
      stale_dossier_rebaseline: false,
    }),
    []
  );
});

test("computeAttacheReturnTierInstructionIds: visit_bin moderate → DAY_OR_SO + dossier append", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "moderate",
    baseline_return_greeting_pending: false,
    stale_dossier_rebaseline: false,
  });
  assert.deepEqual(ids, ["ATTACHE_RETURN_DAY_OR_SO", "ATTACHE_RETURN_APPEND_NO_DOSSIER"]);
});

test("computeAttacheReturnTierInstructionIds: moderate + fresh dossier → FRESH append", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "moderate",
    baseline_return_greeting_pending: false,
    stale_dossier_rebaseline: false,
    has_dossier: true,
    dossier_stale_by_age: false,
  });
  assert.deepEqual(ids, ["ATTACHE_RETURN_DAY_OR_SO", "ATTACHE_RETURN_APPEND_FRESH_DOSSIER"]);
});

test("computeAttacheReturnTierInstructionIds: pending + stale visit → STALE_VISIT + append (no dossier)", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "stale",
    baseline_return_greeting_pending: true,
    stale_dossier_rebaseline: false,
  });
  assert.deepEqual(ids, ["ATTACHE_RETURN_STALE_VISIT", "ATTACHE_RETURN_APPEND_NO_DOSSIER"]);
});

test("computeAttacheReturnTierInstructionIds: pending + stale + stale dossier → STALE_VISIT + STALE append", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "stale",
    baseline_return_greeting_pending: true,
    stale_dossier_rebaseline: false,
    has_dossier: true,
    dossier_stale_by_age: true,
  });
  assert.deepEqual(ids, ["ATTACHE_RETURN_STALE_VISIT", "ATTACHE_RETURN_APPEND_STALE_DOSSIER"]);
});

test("computeAttacheReturnTierInstructionIds: pending + long visit → LONG_GONE + append", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "long",
    baseline_return_greeting_pending: true,
    stale_dossier_rebaseline: false,
  });
  assert.deepEqual(ids, ["ATTACHE_RETURN_LONG_GONE", "ATTACHE_RETURN_APPEND_NO_DOSSIER"]);
});

test("computeAttacheReturnTierInstructionIds: stale_dossier_rebaseline without pending visit bins → STALE_VISIT + append", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "",
    baseline_return_greeting_pending: false,
    stale_dossier_rebaseline: true,
  });
  assert.deepEqual(ids, ["ATTACHE_RETURN_STALE_VISIT", "ATTACHE_RETURN_APPEND_NO_DOSSIER"]);
});

test("computeAttacheReturnTierInstructionIds + phase: moderate then start orientation", () => {
  const { computeAttacheCatalogInstructionIds } = require("../attache/attachePromptPolicy");
  const ids = computeAttacheCatalogInstructionIds({
    attacheState: createAttacheState({ phase: "start" }),
    attache_turn_count: 0,
    attache_close_count: 0,
    visit_bin: "moderate",
    baseline_return_greeting_pending: false,
    stale_dossier_rebaseline: false,
    returnCategory: "",
  });
  assert.deepEqual(ids, [
    "ATTACHE_RETURN_DAY_OR_SO",
    "ATTACHE_RETURN_APPEND_NO_DOSSIER",
    "ATTACHE_START_ORIENTATION",
  ]);
});

test("resolveAttachePromptInstructionIdsForTurn prefers orchestrator snapshot over explicit session ids", () => {
  const session = {
    attacheState: createAttacheState({ phase: "baseline1", question_index: 1 }),
    attache_turn_count: 0,
    attache_close_count: 0,
    visit_bin: "brief",
    attache_prompt_instruction_ids: ["SHOULD_NOT_WIN"],
  };
  const snap = advanceAttacheOrchestratorForPromptTurn(null, session);
  const fromSnap = getAttachePromptInstructionIdsFromSnapshot(snap);
  assert.ok(fromSnap.length > 0);
  const resolved = resolveAttachePromptInstructionIdsForTurn(
    { ...session, attacheOrchestratorSnapshot: snap },
    {}
  );
  assert.deepEqual(resolved, fromSnap);
  assert.ok(!resolved.includes("SHOULD_NOT_WIN"));
});

test("resolveAttachePromptInstructionIdsForTurn uses explicit ids when no snapshot ids", () => {
  const resolved = resolveAttachePromptInstructionIdsForTurn(
    {
      attacheState: createAttacheState({ phase: "start" }),
      attache_turn_count: 0,
      attache_prompt_instruction_ids: ["ATTACHE_START_ORIENTATION"],
    },
    {}
  );
  assert.deepEqual(resolved, ["ATTACHE_START_ORIENTATION"]);
});
