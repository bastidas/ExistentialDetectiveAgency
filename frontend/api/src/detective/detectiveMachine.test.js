"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const config = require("../config");
const { buildDetectiveOrchestrationFacts } = require("./buildDetectiveOrchestrationFacts");
const {
  applyDetectiveOrchestrationSync,
  mergeDetectiveOrchestrationIntoConversationState,
  buildDetectiveStateInstruction,
} = require("./detectiveMachine");

function isoMs(ms) {
  return new Date(ms).toISOString();
}

describe("buildDetectiveOrchestrationFacts", () => {
  it("maps return categories and baseline vintage from classification", () => {
    const classification = {
      returnCategory: "DAY_OR_SO",
      timeAwayMs: 3_600_000,
      needsBaselineRefresh: true,
      baselineReason: "day_or_so_stale_baseline",
      lastActivityAtIso: null,
    };
    const session = { attacheCompleted: true, lastReturnClassification: classification };
    const dossier = { explicit: { name: "  Sam  " } };
    const facts = buildDetectiveOrchestrationFacts(session, dossier, classification, new Date());
    assert.deepEqual(facts, {
      sessionRecency: "mid",
      baselineHandoff: "completed",
      knownName: "named",
      baselineVintage: "stale",
      returnCategory: "DAY_OR_SO",
      timeAwayMs: 3_600_000,
    });
  });

  it("treats missing dossier as no_dossier and not_applicable vintage when baseline incomplete", () => {
    const c = {
      returnCategory: "UNKNOWN",
      timeAwayMs: null,
      needsBaselineRefresh: false,
      baselineReason: "no_last_activity_or_unparsed",
      lastActivityAtIso: null,
    };
    const facts = buildDetectiveOrchestrationFacts({ attacheCompleted: false }, null, c, new Date());
    assert.equal(facts.knownName, "no_dossier");
    assert.equal(facts.baselineHandoff, "not_completed");
    assert.equal(facts.baselineVintage, "not_applicable");
  });
});

describe("detective orchestration machine", () => {
  const nowMs = Date.UTC(2025, 5, 10, 12, 0, 0);
  const now = new Date(nowMs);

  it("mergeDetectiveOrchestrationIntoConversationState uses return policy + dossier", () => {
    const lastMs = nowMs - Math.floor(config.TIME_AWAY_BRIEF_MS / 2);
    const session = {
      attacheCompleted: true,
      returnPolicyLastActivityAt: isoMs(lastMs),
      lastReturnClassification: null,
    };
    const dossier = {
      explicit: { name: null },
      meta: {
        baselineQuestionsAnswered: 2,
        lastBaselineCompletedAt: lastMs,
      },
    };
    const state = mergeDetectiveOrchestrationIntoConversationState(
      { turn_count: 0, mode: "normal" },
      session,
      dossier,
      now
    );

    assert.equal(state.detective_orchestration.sessionRecency, "brief");
    assert.equal(state.detective_orchestration.baselineHandoff, "completed");
    assert.equal(state.detective_orchestration.knownName, "unnamed");
    assert.equal(state.detective_orchestration.baselineVintage, "fresh");
    assert.ok(state.detective_xstate_snapshot);
  });

  it("persists and restores XState snapshot across syncs", () => {
    const factsA = {
      sessionRecency: "long",
      baselineHandoff: "completed",
      knownName: "named",
      baselineVintage: "stale",
      returnCategory: "LONG_GONE",
      timeAwayMs: 9e8,
    };
    const first = applyDetectiveOrchestrationSync(undefined, factsA);
    const factsB = {
      ...factsA,
      sessionRecency: "brief",
      baselineVintage: "fresh",
      returnCategory: "JUST_STEPPED_AWAY",
      timeAwayMs: 60_000,
    };
    const second = applyDetectiveOrchestrationSync(first.persistedSnapshot, factsB);
    assert.equal(second.view.sessionRecency, "brief");
    assert.equal(second.view.baselineVintage, "fresh");
    assert.equal(second.view.returnCategory, "JUST_STEPPED_AWAY");
    assert.equal(second.view.timeAwayMs, 60_000);
  });
});

describe("buildDetectiveStateInstruction", () => {
  it("returns brief-return guidance", () => {
    const text = buildDetectiveStateInstruction({
      detective_orchestration: { sessionRecency: "brief" },
    });
    assert.match(text, /returned briefly/i);
    assert.match(text, /direct continuation/i);
  });

  it("falls back to unknown guidance when missing state", () => {
    const text = buildDetectiveStateInstruction(null);
    assert.match(text, /recency is uncertain/i);
    assert.match(text, /neutral/i);
  });
});
