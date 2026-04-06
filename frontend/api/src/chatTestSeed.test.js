"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { clearPersistedChatMachineSnapshot } = require("./orchestration/chatMachine");
const { seedSessionScenario } = require("./chatTestSeed");
const { getExistentialTherapyPhaseForSession } = require("./detective/detectiveExistentialSession");
const { getPhilosopherNarrativeSnapshotForSession } = require("./chatService");
const { narrativePhaseFromTurn } = require("./narrativePhases");
const { buildDetectiveOrchestrationFacts } = require("./detective/buildDetectiveOrchestrationFacts");

test("seedSessionScenario: attaché, no dossier, brief", () => {
  const sid = "seed-test-attache-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  const { envelope } = seedSessionScenario(sid, {
    hasDossier: false,
    activeAgent: "attache",
    timeAwayBin: "brief",
  });
  assert.ok(envelope);
  assert.equal(envelope.active_agent, "attache");
  assert.equal(envelope.baseline_completed, false);
  assert.equal(envelope.has_dossier, false);
  clearPersistedChatMachineSnapshot(sid);
});

test("seedSessionScenario: detective via handoff, no dossier", () => {
  const sid = "seed-test-det-handoff-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  const { envelope } = seedSessionScenario(sid, {
    hasDossier: false,
    activeAgent: "detective",
    timeAwayBin: "brief",
  });
  assert.ok(envelope);
  assert.equal(envelope.active_agent, "detective");
  assert.equal(envelope.baseline_completed, true);
  assert.equal(envelope.has_dossier, false);
  clearPersistedChatMachineSnapshot(sid);
});

test("seedSessionScenario: detective preset syncs lab orchestrator state (therapy + narrative)", () => {
  const sid = "seed-test-lab-sync-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  seedSessionScenario(sid, {
    baselineCompleted: true,
    hasDossier: false,
    existentialTherapyPhase: "middle",
    narrativePhase: "Climax",
    timeAwayBin: "brief",
  });
  assert.equal(getExistentialTherapyPhaseForSession(sid), "middle");
  const phil = getPhilosopherNarrativeSnapshotForSession(sid);
  const ctx = phil && typeof phil === "object" ? phil.context : null;
  const turn = ctx && typeof ctx.narrativeTurn === "number" ? ctx.narrativeTurn : -1;
  assert.equal(narrativePhaseFromTurn(turn), "Climax");
  clearPersistedChatMachineSnapshot(sid);
});

test("seedSessionScenario: baselineCompleted false overrides activeAgent detective", () => {
  const sid = "seed-test-bc-false-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  const { envelope } = seedSessionScenario(sid, {
    baselineCompleted: false,
    activeAgent: "detective",
    hasDossier: false,
    timeAwayBin: "brief",
  });
  assert.ok(envelope);
  assert.equal(envelope.active_agent, "attache");
  assert.equal(envelope.baseline_completed, false);
  clearPersistedChatMachineSnapshot(sid);
});

test("seedSessionScenario: baselineCompleted true overrides activeAgent attache", () => {
  const sid = "seed-test-bc-true-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  const { envelope } = seedSessionScenario(sid, {
    baselineCompleted: true,
    activeAgent: "attache",
    hasDossier: false,
    timeAwayBin: "brief",
  });
  assert.ok(envelope);
  assert.equal(envelope.active_agent, "detective");
  assert.equal(envelope.baseline_completed, true);
  clearPersistedChatMachineSnapshot(sid);
});

test("seedSessionScenario: detective with dossier (time-away clamped)", () => {
  const sid = "seed-test-det-dossier-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  const { envelope } = seedSessionScenario(sid, {
    hasDossier: true,
    activeAgent: "detective",
    timeAwayBin: "long",
  });
  assert.ok(envelope);
  assert.equal(envelope.active_agent, "detective");
  assert.equal(envelope.has_dossier, true);
  clearPersistedChatMachineSnapshot(sid);
});

test("seedSessionScenario: attaché after long absence with dossier", () => {
  const sid = "seed-test-long-abs-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  const { envelope } = seedSessionScenario(sid, {
    hasDossier: true,
    activeAgent: "attache",
    timeAwayBin: "long",
  });
  assert.ok(envelope);
  assert.equal(envelope.active_agent, "attache");
  assert.equal(envelope.has_dossier, true);
  clearPersistedChatMachineSnapshot(sid);
});

test("returnClassification: classifyFromSessionAndDossier resolves", () => {
  const { classifyFromSessionAndDossier } = require("./session/returnClassification");
  const d = require("./dossier_and_summarize/dossier").createEmptyDossier("u1");
  d.meta.lastBaselineCompletedAt = Date.now();
  const c = classifyFromSessionAndDossier({ msSinceLastVisit: 999 }, d, new Date());
  assert.ok(c.returnCategory);
  assert.equal(typeof c.needsBaselineRefresh, "boolean");
});

test("buildDetectiveOrchestrationFacts uses returnClassification", () => {
  const facts = buildDetectiveOrchestrationFacts({ msSinceLastVisit: 1000 }, null, null, new Date());
  assert.ok(facts.returnCategory);
});
