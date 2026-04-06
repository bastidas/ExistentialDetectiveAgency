"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectSpecialInstructions } = require("./instructionSelection");
const { computeAttacheReturnTierInstructionIds } = require("../attache/attachePromptPolicy");
const { createAttacheState } = require("../attache/attacheMachine");

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

test("computeAttacheReturnTierInstructionIds: visit_bin moderate → DAY_OR_SO", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "moderate",
    baseline_return_greeting_pending: false,
    stale_dossier_rebaseline: false,
  });
  assert.deepEqual(ids, ["ATTACHE_RETURN_DAY_OR_SO"]);
});

test("computeAttacheReturnTierInstructionIds: pending + stale visit → STALE_VISIT", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "stale",
    baseline_return_greeting_pending: true,
    stale_dossier_rebaseline: false,
  });
  assert.deepEqual(ids, ["ATTACHE_RETURN_STALE_VISIT"]);
});

test("computeAttacheReturnTierInstructionIds: pending + long visit → LONG_GONE", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "long",
    baseline_return_greeting_pending: true,
    stale_dossier_rebaseline: false,
  });
  assert.deepEqual(ids, ["ATTACHE_RETURN_LONG_GONE"]);
});

test("computeAttacheReturnTierInstructionIds: stale_dossier_rebaseline without pending visit bins", () => {
  const ids = computeAttacheReturnTierInstructionIds({
    visit_bin: "",
    baseline_return_greeting_pending: false,
    stale_dossier_rebaseline: true,
  });
  assert.deepEqual(ids, ["ATTACHE_STALE_DOSSIER_REBASELINE"]);
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
  assert.deepEqual(ids, ["ATTACHE_RETURN_DAY_OR_SO", "ATTACHE_START_ORIENTATION"]);
});
