"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createActor } = require("xstate");
const {
  chatMachine,
  runChatTurn,
  clearPersistedChatMachineSnapshot,
  notifyAttachePreludeComplete,
  getChatEnvelopeForSession,
} = require("./chatMachine");
const {
  attacheOrchestratorMachine,
  createAttacheState,
  getAttachePromptInstructionIdsFromSnapshot,
  migrateAttacheOrchestratorMachineSnapshot,
  migratePersistedChatSnapshotAttacheOrchestrator,
} = require("../attache/attacheMachine");

test("chatMachine: dossier sync + USER_MESSAGE reaches attache agent + visit timeAway", () => {
  const actor = createActor(chatMachine);
  actor.start();
  actor.send({ type: "DOSSIER_CLEARED" });
  actor.send({ type: "USER_MESSAGE", msSinceLastVisit: 1000 });
  const snap = actor.getSnapshot();
  assert.equal(snap.value.agent, "attache");
  assert.equal(snap.value.visit.timeAway, "brief");
  assert.equal(snap.context.activeAgent, "attache");
  assert.equal(snap.context.hasDossier, false);
  actor.stop();
});

test("getPersistedSnapshot retains invoked attacheOrchestrator child", () => {
  const a = createActor(chatMachine);
  a.start();
  a.send({ type: "DOSSIER_CLEARED" });
  a.send({ type: "USER_MESSAGE", msSinceLastVisit: 1000 });
  const persisted = a.getPersistedSnapshot();
  a.stop();
  assert.ok(persisted.children && persisted.children.attacheOrchestrator);
  assert.ok(persisted.children.attacheOrchestrator.snapshot);
  assert.ok(persisted.children.attacheOrchestrator.snapshot.context.attacheState);

  const b = createActor(chatMachine, { snapshot: persisted });
  b.start();
  const v = b.getSnapshot().value;
  assert.equal(v.agent, "attache");
  b.stop();
});

test("attacheOrchestratorMachine: ATTACHE_BEGIN_TURN sets ids; ATTACHE_TURN preserves attachePromptInstructionIds", () => {
  const actor = createActor(attacheOrchestratorMachine);
  actor.start();
  actor.send({
    type: "ATTACHE_BEGIN_TURN",
    payload: {
      attacheState: createAttacheState({ phase: "start" }),
      attache_turn_count: 0,
      attache_close_count: 0,
      visit_bin: "brief",
      baseline_return_greeting_pending: false,
      stale_dossier_rebaseline: false,
      returnCategory: "",
      has_dossier: false,
      dossier_stale_by_age: false,
    },
  });
  const snap1 = actor.getSnapshot();
  const ids = snap1.context.attachePromptInstructionIds;
  assert.ok(Array.isArray(ids) && ids.includes("ATTACHE_START_ORIENTATION"));
  actor.send({
    type: "ATTACHE_TURN",
    llmOutput: {
      user_intends_explore: false,
      user_intends_close: false,
      asked_baseline_question: true,
    },
  });
  const after = actor.getSnapshot().context.attachePromptInstructionIds;
  assert.deepEqual(after, ids);
  assert.equal(actor.getSnapshot().context.attacheState.phase, "baseline1");
  const persisted =
    typeof actor.getPersistedSnapshot === "function" ? actor.getPersistedSnapshot() : null;
  if (persisted) {
    assert.deepEqual(getAttachePromptInstructionIdsFromSnapshot(persisted), ids);
  }
  actor.stop();
});

test("attacheOrchestratorMachine: states expose Stately tags (hasTag)", () => {
  const actor = createActor(attacheOrchestratorMachine);
  actor.start();
  const snap = actor.getSnapshot();
  assert.deepEqual(snap.value, { start: "introFirstNoReturn" });
  assert.equal(typeof snap.hasTag, "function");
  assert.equal(snap.hasTag("phase:start"), true);
  assert.equal(snap.hasTag("phase:baseline"), false);
  actor.send({
    type: "ATTACHE_TURN",
    llmOutput: {
      user_intends_explore: false,
      user_intends_close: false,
      asked_baseline_question: true,
    },
  });
  const snap2 = actor.getSnapshot();
  assert.equal(snap2.hasTag("phase:baseline"), true);
  assert.equal(snap2.hasTag("baseline:1"), true);
  actor.stop();
});

test("attacheOrchestratorMachine: explicit states follow AttacheState.phase", () => {
  const actor = createActor(attacheOrchestratorMachine);
  actor.start();
  assert.deepEqual(actor.getSnapshot().value, { start: "introFirstNoReturn" });
  assert.equal(actor.getSnapshot().context.attacheState.phase, "start");
  actor.send({
    type: "ATTACHE_TURN",
    llmOutput: {
      user_intends_explore: false,
      user_intends_close: false,
      asked_baseline_question: true,
    },
  });
  assert.deepEqual(actor.getSnapshot().value, { baseline: "baseline1" });
  assert.equal(actor.getSnapshot().context.attacheState.phase, "baseline1");
  actor.stop();
});

test("migrateAttacheOrchestratorMachineSnapshot: flat value → compound", () => {
  const flat = { status: "active", value: "intro", context: { attacheState: createAttacheState({ phase: "start" }) } };
  const out = migrateAttacheOrchestratorMachineSnapshot(flat);
  assert.deepEqual(/** @type {{ value: unknown }} */ (out).value, { start: "introFirstNoReturn" });
});

test("attacheOrchestratorMachine: ATTACHE_BEGIN_TURN routes start by return tier (moderate → introFirstDayOrSo)", () => {
  const actor = createActor(attacheOrchestratorMachine);
  actor.start();
  actor.send({
    type: "ATTACHE_BEGIN_TURN",
    payload: {
      attacheState: createAttacheState({ phase: "start" }),
      attache_turn_count: 0,
      attache_close_count: 0,
      visit_bin: "moderate",
      baseline_return_greeting_pending: false,
      stale_dossier_rebaseline: false,
      returnCategory: "",
      has_dossier: true,
      dossier_stale_by_age: false,
    },
  });
  assert.deepEqual(actor.getSnapshot().value, { start: "introFirstDayOrSo" });
  const ids = actor.getSnapshot().context.attachePromptInstructionIds;
  assert.ok(ids.includes("ATTACHE_RETURN_DAY_OR_SO"));
  assert.ok(ids.includes("ATTACHE_START_ORIENTATION"));
  actor.stop();
});

test("attacheOrchestratorMachine: ATTACHE_BEGIN_TURN start + turn_count>0 → introReentrySubsequent", () => {
  const actor = createActor(attacheOrchestratorMachine);
  actor.start();
  actor.send({
    type: "ATTACHE_BEGIN_TURN",
    payload: {
      attacheState: createAttacheState({ phase: "start" }),
      attache_turn_count: 1,
      attache_close_count: 0,
      visit_bin: "moderate",
      baseline_return_greeting_pending: false,
      stale_dossier_rebaseline: false,
      returnCategory: "",
      has_dossier: false,
      dossier_stale_by_age: false,
    },
  });
  assert.deepEqual(actor.getSnapshot().value, { start: "introReentrySubsequent" });
  const ids = actor.getSnapshot().context.attachePromptInstructionIds;
  assert.ok(!ids.some((id) => String(id).startsWith("ATTACHE_RETURN_")));
  actor.stop();
});

test("migratePersistedChatSnapshotAttacheOrchestrator: nested child flat value", () => {
  const root = {
    children: {
      attacheOrchestrator: {
        snapshot: { status: "active", value: "baseline1", context: {} },
      },
    },
  };
  const out = migratePersistedChatSnapshotAttacheOrchestrator(root);
  assert.deepEqual(out.children.attacheOrchestrator.snapshot.value, { baseline: "baseline1" });
});

test("runChatTurn session persistence restores agent + envelope", () => {
  const sid = "test-persist-invoke-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  const r1 = runChatTurn(sid, "a", { msSinceLastVisit: 2000 });
  assert.equal(r1.envelope.active_agent, "attache");
  const r2 = runChatTurn(sid, "b", { msSinceLastVisit: 2000 });
  assert.equal(r2.envelope.active_agent, "attache");
  clearPersistedChatMachineSnapshot(sid);
});

test("notifyAttachePreludeComplete switches envelope to detective + baseline_completed", () => {
  const sid = "test-handoff-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  const r1 = runChatTurn(sid, "x", { msSinceLastVisit: 1000 });
  assert.equal(r1.envelope.active_agent, "attache");
  assert.equal(r1.envelope.baseline_completed, false);
  notifyAttachePreludeComplete(sid);
  const env = getChatEnvelopeForSession(sid);
  assert.ok(env);
  assert.equal(env.active_agent, "detective");
  assert.equal(env.baseline_completed, true);
  assert.equal(env.agent_label, "DETECTIVE");
  clearPersistedChatMachineSnapshot(sid);
});

test("runChatTurn: detective stays detective across turns (no DOSSIER_CLEARED spam)", () => {
  const sid = "test-no-flip-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  runChatTurn(sid, "a", { msSinceLastVisit: 1000 });
  notifyAttachePreludeComplete(sid);
  assert.equal(getChatEnvelopeForSession(sid).active_agent, "detective");
  const r2 = runChatTurn(sid, "b", { msSinceLastVisit: 1000 });
  assert.equal(r2.envelope.active_agent, "detective");
  const r3 = runChatTurn(sid, "c", { msSinceLastVisit: 2000 });
  assert.equal(r3.envelope.active_agent, "detective");
  clearPersistedChatMachineSnapshot(sid);
});

const H = 60 * 60 * 1000;
const sampleDossier = { meta: { lastBaselineCompletedAt: 1 } };

test("runChatTurn: stale visit bin + fresh dossier → attaché", () => {
  const sid = "test-stale-fresh-dossier-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  runChatTurn(sid, "a", { msSinceLastVisit: 1000 });
  notifyAttachePreludeComplete(sid);
  const freshDossier = { meta: { lastBaselineCompletedAt: Date.now() } };
  runChatTurn(sid, "b", { msSinceLastVisit: 1000, dossier: freshDossier });
  assert.equal(getChatEnvelopeForSession(sid).active_agent, "detective");
  const rStale = runChatTurn(sid, "c", { msSinceLastVisit: 100 * H, dossier: freshDossier });
  assert.equal(rStale.envelope.active_agent, "attache");
  clearPersistedChatMachineSnapshot(sid);
});

test("runChatTurn: persist false does not update persisted snapshot", () => {
  const sid = "test-persist-off-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  runChatTurn(sid, "a", { msSinceLastVisit: 1000 });
  assert.equal(getChatEnvelopeForSession(sid).active_agent, "attache");
  runChatTurn(sid, "preview", { msSinceLastVisit: 100 * H, persist: false });
  assert.equal(getChatEnvelopeForSession(sid).active_agent, "attache");
  clearPersistedChatMachineSnapshot(sid);
});

test("runChatTurn: dossier + stale absence → attaché (LONG_ABSENCE_USE_ATTACHE)", () => {
  const sid = "test-long-abs-" + Date.now();
  clearPersistedChatMachineSnapshot(sid);
  runChatTurn(sid, "a", { msSinceLastVisit: 1000 });
  notifyAttachePreludeComplete(sid);
  runChatTurn(sid, "b", { msSinceLastVisit: 1000, dossier: sampleDossier });
  assert.equal(getChatEnvelopeForSession(sid).active_agent, "detective");
  const rStale = runChatTurn(sid, "c", { msSinceLastVisit: 33 * H, dossier: sampleDossier });
  assert.equal(rStale.envelope.active_agent, "attache");
  clearPersistedChatMachineSnapshot(sid);
});

test("chatMachine: DOSSIER_LOADED moves to detective (no separate philosophers agent state)", () => {
  const actor = createActor(chatMachine);
  actor.start();
  actor.send({ type: "DOSSIER_LOADED" });
  assert.equal(actor.getSnapshot().value.agent, "detective");
  actor.stop();
});
