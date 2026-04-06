"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  narrativePhaseFromTurn,
  narrativeTurnForPhaseLabel,
  NARRATIVE_PHASE_OPTIONS,
  pickNarrativePhaseForLab,
} = require("./narrativePhases");

test("NARRATIVE_PHASE_OPTIONS lists dramatic arc stages", () => {
  assert.deepEqual(NARRATIVE_PHASE_OPTIONS, [
    "Exposition",
    "Rising Action",
    "Climax",
    "Falling Action",
    "Denouement",
    "Coda",
  ]);
});

test("narrativePhaseFromTurn maps turn index modulo six", () => {
  assert.equal(narrativePhaseFromTurn(0), "Exposition");
  assert.equal(narrativePhaseFromTurn(5), "Coda");
  assert.equal(narrativePhaseFromTurn(6), "Exposition");
});

test("pickNarrativePhaseForLab defaults and validates", () => {
  assert.equal(pickNarrativePhaseForLab({}), "Exposition");
  assert.equal(pickNarrativePhaseForLab({ narrativePhase: "Climax" }), "Climax");
  assert.equal(pickNarrativePhaseForLab({ narrativePhase: "bogus" }), "Exposition");
});

test("narrativeTurnForPhaseLabel matches arc index", () => {
  assert.equal(narrativeTurnForPhaseLabel("Exposition"), 0);
  assert.equal(narrativeTurnForPhaseLabel("Climax"), 2);
  assert.equal(narrativePhaseFromTurn(narrativeTurnForPhaseLabel("Denouement")), "Denouement");
});
