"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getTimeAwayThresholds } = require("../orchestration/timeAwayClassification");
const {
  getExistentialTherapyPhaseMarkdown,
  normalizeExistentialTherapyPhaseId,
} = require("./existentialTherapyPhaseContent");
const {
  getExistentialTherapyPhaseForSession,
  applyExistentialPhaseSuggestionAfterDetectiveTurn,
  advanceExistentialPhaseOneStepForLab,
  clearDetectiveExistentialSession,
  runDetectivePromptPolicyTurn,
  getDetectivePromptInstructionIdsForSession,
  setExistentialTherapyPhaseForLabSession,
} = require("./detectiveExistentialSession");

const minimalDossier = Object.freeze({
  meta: { baselineQuestionsAnswered: 1 },
  explicit: { name: "Test" },
});

test("getExistentialTherapyPhaseMarkdown loads initial/middle/final markdown", () => {
  const a = getExistentialTherapyPhaseMarkdown("initial");
  const b = getExistentialTherapyPhaseMarkdown("middle");
  const c = getExistentialTherapyPhaseMarkdown("final");
  assert.ok(a.length > 20 && a.includes("Phenomenological"));
  assert.ok(b.length > 20 && b.includes("responsibility"));
  assert.ok(c.length > 20 && c.includes("authenticity"));
});

test("normalizeExistentialTherapyPhaseId defaults unknown to initial", () => {
  assert.equal(normalizeExistentialTherapyPhaseId("bogus"), "initial");
  assert.equal(normalizeExistentialTherapyPhaseId("middle"), "middle");
});

test("advanceExistentialPhaseOneStepForLab advances initial→middle→final", () => {
  const sid = "test-lab-step";
  clearDetectiveExistentialSession(sid);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "initial");
  advanceExistentialPhaseOneStepForLab(sid);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "middle");
  advanceExistentialPhaseOneStepForLab(sid);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "final");
  advanceExistentialPhaseOneStepForLab(sid);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "final");
  clearDetectiveExistentialSession(sid);
});

test("applyExistentialPhaseSuggestionAfterDetectiveTurn: single suggestion does not advance", () => {
  const sid = "test-streak-one";
  clearDetectiveExistentialSession(sid);
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "middle", {
    hasDossier: true,
    dossier: minimalDossier,
    nowMs: Date.now(),
  });
  assert.equal(getExistentialTherapyPhaseForSession(sid), "initial");
  clearDetectiveExistentialSession(sid);
});

test("applyExistentialPhaseSuggestionAfterDetectiveTurn: two middle + dossier advances to middle", () => {
  const sid = "test-streak-two";
  clearDetectiveExistentialSession(sid);
  const ctx = { hasDossier: true, dossier: minimalDossier, nowMs: Date.now() };
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "middle", ctx);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "initial");
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "middle", ctx);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "middle");
  clearDetectiveExistentialSession(sid);
});

test("applyExistentialPhaseSuggestionAfterDetectiveTurn: initial→middle blocked without dossier", () => {
  const sid = "test-no-dossier";
  clearDetectiveExistentialSession(sid);
  const ctx = { hasDossier: false, dossier: null, nowMs: Date.now() };
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "middle", ctx);
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "middle", ctx);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "initial");
  clearDetectiveExistentialSession(sid);
});

test("applyExistentialPhaseSuggestionAfterDetectiveTurn: middle→final requires stale createdAt", () => {
  const sid = "test-final-age";
  clearDetectiveExistentialSession(sid);
  setExistentialTherapyPhaseForLabSession(sid, "middle");
  const { longMs } = getTimeAwayThresholds();
  const now = Date.now();
  const tooNew = {
    meta: { createdAt: now - Math.floor(longMs / 2), baselineQuestionsAnswered: 1 },
    explicit: { name: "Y" },
  };
  const ctxNew = { hasDossier: true, dossier: tooNew, nowMs: now };
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "final", ctxNew);
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "final", ctxNew);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "middle");

  const oldEnough = {
    meta: { createdAt: now - longMs - 60_000, baselineQuestionsAnswered: 1 },
    explicit: { name: "Z" },
  };
  const ctxOld = { hasDossier: true, dossier: oldEnough, nowMs: now };
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "final", ctxOld);
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "final", ctxOld);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "final");
  clearDetectiveExistentialSession(sid);
});

test("applyExistentialPhaseSuggestionAfterDetectiveTurn: regression final→middle with two suggestions", () => {
  const sid = "test-regress";
  clearDetectiveExistentialSession(sid);
  setExistentialTherapyPhaseForLabSession(sid, "final");
  const ctx = { hasDossier: true, dossier: minimalDossier, nowMs: Date.now() };
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "middle", ctx);
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "middle", ctx);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "middle");
  clearDetectiveExistentialSession(sid);
});

test("runDetectivePromptPolicyTurn shares persisted snapshot with existential phase", () => {
  const sid = "test-orchestrator-unified";
  clearDetectiveExistentialSession(sid);
  const ids = runDetectivePromptPolicyTurn(sid, {
    visit_bin: "moderate",
    temporal_greeting_mode: "continuation",
    dossier_stale_by_age: false,
    returnCategory: "DAY_OR_SO",
  });
  assert.ok(ids.includes("DETECTIVE_RETURN_CONTINUATION"));
  assert.deepEqual(getDetectivePromptInstructionIdsForSession(sid), ids);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "initial");
  const ctx = { hasDossier: true, dossier: minimalDossier, nowMs: Date.now() };
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "middle", ctx);
  applyExistentialPhaseSuggestionAfterDetectiveTurn(sid, "middle", ctx);
  assert.equal(getExistentialTherapyPhaseForSession(sid), "middle");
  runDetectivePromptPolicyTurn(sid, {
    visit_bin: "moderate",
    temporal_greeting_mode: "continuation",
    dossier_stale_by_age: false,
    returnCategory: "DAY_OR_SO",
  });
  assert.equal(getExistentialTherapyPhaseForSession(sid), "middle");
  clearDetectiveExistentialSession(sid);
});
