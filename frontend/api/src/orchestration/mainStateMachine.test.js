"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  transitionMainState,
  MAIN_STATE_SCHEMA_VERSION,
} = require("./mainStateMachine");

describe("mainStateMachine", () => {
  it("follows baseline -> handoff -> detective flow", () => {
    const start = transitionMainState(null, {
      rehydrated: false,
      attache: { completed: false, closingDelivered: false },
    });
    assert.equal(start.view.activeMainSpeaker, "ATTACHE");
    assert.equal(start.view.attache.baselineCompleted, false);

    const completed = transitionMainState(start.snapshots, {
      attache: { completed: true, closingDelivered: true },
    });
    assert.equal(completed.view.machineState, "attache_handoff");
    assert.equal(completed.view.attache.baselineCompleted, true);

    const detective = transitionMainState(completed.snapshots, {
      startDetectiveOnly: true,
    });
    assert.equal(detective.view.machineState, "detective");
    assert.equal(detective.view.activeMainSpeaker, "DETECTIVE");
  });

  it("increments detective turn metadata and closure mode", () => {
    const boot = transitionMainState(null, {
      attache: { completed: true, closingDelivered: true },
    });
    const started = transitionMainState(boot.snapshots, { startDetectiveOnly: true });
    const turn = transitionMainState(started.snapshots, {
      detective: {
        closureTurnThreshold: 1,
        therapyPhase: "MAPPING_INFLUENCE",
        existentialPhase: "VALUE_CONNECTION",
        narrativePhase: "RISING_ACTION",
      },
    });
    assert.equal(turn.view.schemaVersion, MAIN_STATE_SCHEMA_VERSION);
    assert.equal(turn.view.detective.turnCount, 1);
    assert.equal(turn.view.detective.mode, "closure");
    assert.equal(turn.view.philosophers.narrativePhase, "RISING_ACTION");
  });
});

