"use strict";

const { setup, assign, createActor } = require("xstate");
const {
  MainSpeaker,
  RehydrationStatus,
  TherapyPhase,
  ExistentialPhase,
  NarrativePhase,
  DEFAULT_THERAPY_PHASE_KEY,
  DEFAULT_EXISTENTIAL_PHASE_KEY,
  DEFAULT_NARRATIVE_PHASE_KEY,
} = require("./orchestrationModels");

const MAIN_STATE_SCHEMA_VERSION = 1;

const attacheMachine = setup({
  actions: {
    syncAttache: assign(({ context, event }) => {
      if (event.type !== "SYNC_ATTACHE") return {};
      const done = !!event.completed;
      return {
        baselineCompleted: done,
        baselineActive: !done,
        closingDelivered: done ? !!event.closingDelivered : false,
      };
    }),
  },
}).createMachine({
  id: "attacheSubmachine",
  initial: "active",
  context: {
    baselineCompleted: false,
    baselineActive: true,
    closingDelivered: false,
  },
  states: { active: { on: { SYNC_ATTACHE: { actions: "syncAttache" } } } },
});

const detectiveMachine = setup({
  actions: {
    advanceDetective: assign(({ context, event }) => {
      if (event.type !== "ADVANCE_DETECTIVE") return {};
      const turnCount = context.turnCount + 1;
      const shouldBeginClosure = turnCount >= event.closureTurnThreshold;
      const mode = shouldBeginClosure ? "closure" : "normal";
      const therapy = event.therapyPhase || context.therapyPhase;
      const existential = event.existentialPhase || context.existentialPhase;
      return { turnCount, shouldBeginClosure, mode, therapyPhase: therapy, existentialPhase: existential };
    }),
  },
}).createMachine({
  id: "detectiveSubmachine",
  initial: "active",
  context: {
    turnCount: 0,
    shouldBeginClosure: false,
    mode: "normal",
    therapyPhase: DEFAULT_THERAPY_PHASE_KEY,
    existentialPhase: DEFAULT_EXISTENTIAL_PHASE_KEY,
  },
  states: { active: { on: { ADVANCE_DETECTIVE: { actions: "advanceDetective" } } } },
});

const philosopherMachine = setup({
  actions: {
    syncPhilosophers: assign(({ context, event }) => {
      if (event.type !== "SYNC_PHILOSOPHERS") return {};
      return {
        narrativePhase: event.narrativePhase || context.narrativePhase,
        secretsRevealed: {
          lumen: Array.isArray(event.lumenSecrets) ? event.lumenSecrets : context.secretsRevealed.lumen,
          umbra: Array.isArray(event.umbraSecrets) ? event.umbraSecrets : context.secretsRevealed.umbra,
        },
      };
    }),
  },
}).createMachine({
  id: "philosopherSubmachine",
  initial: "active",
  context: {
    narrativePhase: DEFAULT_NARRATIVE_PHASE_KEY,
    secretsRevealed: { lumen: [], umbra: [] },
  },
  states: {
    active: {
      on: {
        SYNC_PHILOSOPHERS: { actions: "syncPhilosophers" },
      },
    },
  },
});

const rootMachine = setup({
  actions: {
    applyBoot: assign(({ event }) => {
      if (event.type !== "BOOT") return {};
      return {
        schemaVersion: MAIN_STATE_SCHEMA_VERSION,
        rehydrationStatus: event.rehydrated ? RehydrationStatus.REHYDRATED : RehydrationStatus.FRESH,
      };
    }),
    markAttacheSpeaker: assign(() => ({ activeMainSpeaker: MainSpeaker.ATTACHE })),
    markDetectiveSpeaker: assign(() => ({ activeMainSpeaker: MainSpeaker.DETECTIVE })),
    bumpMainTurn: assign(({ context }) => ({ mainTurnIndex: context.mainTurnIndex + 1 })),
    markSummarized: assign(({ context }) => ({
      summaryStatus: {
        ...context.summaryStatus,
        lastSummaryAtTurn: context.mainTurnIndex,
      },
    })),
    setReturnProfile: assign(({ event }) => {
      if (event.type !== "SYNC_RETURN_PROFILE") return {};
      return { returnProfile: event.returnProfile || null };
    }),
    syncSnapshots: assign(({ event }) => {
      if (event.type !== "SYNC_SNAPSHOTS") return {};
      return {
        submachineSnapshots: {
          attache: event.attache || null,
          detective: event.detective || null,
          philosophers: event.philosophers || null,
        },
      };
    }),
  },
}).createMachine({
  id: "mainRootMachine",
  initial: "bootstrap",
  context: {
    schemaVersion: MAIN_STATE_SCHEMA_VERSION,
    activeMainSpeaker: MainSpeaker.ATTACHE,
    mainTurnIndex: 0,
    rehydrationStatus: RehydrationStatus.FRESH,
    summaryStatus: { lastSummaryAtTurn: 0 },
    returnProfile: null,
    submachineSnapshots: {
      attache: null,
      detective: null,
      philosophers: null,
    },
  },
  states: {
    bootstrap: {
      on: {
        BOOT: { actions: "applyBoot", target: "attache" },
      },
    },
    attache: {
      entry: "markAttacheSpeaker",
      on: {
        ATTACHE_TURN: { actions: "bumpMainTurn" },
        ATTACHE_COMPLETE: { actions: "bumpMainTurn", target: "attache_handoff" },
      },
    },
    attache_handoff: {
      entry: "markAttacheSpeaker",
      on: {
        DETECTIVE_START: { actions: "bumpMainTurn", target: "detective" },
      },
    },
    detective: {
      entry: "markDetectiveSpeaker",
      on: {
        DETECTIVE_TURN: { actions: "bumpMainTurn" },
        SUMMARIZED: { actions: "markSummarized" },
      },
    },
  },
  on: {
    SYNC_RETURN_PROFILE: { actions: "setReturnProfile" },
    SYNC_SNAPSHOTS: { actions: "syncSnapshots" },
  },
});

function isUsablePersistedSnapshot(persisted) {
  if (!persisted || typeof persisted !== "object") return false;
  return persisted.context && persisted.context.schemaVersion === MAIN_STATE_SCHEMA_VERSION;
}

function getSnapshotValue(snapshot) {
  return snapshot && snapshot.value ? snapshot.value : "attache";
}

function buildMainStateView(rootSnapshot, snapshots) {
  const rootCtx = rootSnapshot.context || {};
  const rootValue = getSnapshotValue(rootSnapshot);
  const attacheCtx = (snapshots.attache && snapshots.attache.context) || {};
  const detectiveCtx = (snapshots.detective && snapshots.detective.context) || {};
  const philosopherCtx = (snapshots.philosophers && snapshots.philosophers.context) || {};
  return {
    schemaVersion: MAIN_STATE_SCHEMA_VERSION,
    machineState: String(rootValue),
    activeMainSpeaker: rootCtx.activeMainSpeaker || MainSpeaker.ATTACHE,
    mainTurnIndex:
      typeof rootCtx.mainTurnIndex === "number" && Number.isFinite(rootCtx.mainTurnIndex)
        ? rootCtx.mainTurnIndex
        : 0,
    rehydrationStatus: rootCtx.rehydrationStatus || RehydrationStatus.FRESH,
    summaryStatus: rootCtx.summaryStatus || { lastSummaryAtTurn: 0 },
    returnProfile: rootCtx.returnProfile || null,
    attache: {
      baselineCompleted: !!attacheCtx.baselineCompleted,
      baselineActive: !!attacheCtx.baselineActive,
      closingDelivered: !!attacheCtx.closingDelivered,
    },
    detective: {
      turnCount:
        typeof detectiveCtx.turnCount === "number" && Number.isFinite(detectiveCtx.turnCount)
          ? detectiveCtx.turnCount
          : 0,
      shouldBeginClosure: !!detectiveCtx.shouldBeginClosure,
      mode: detectiveCtx.mode === "closure" ? "closure" : "normal",
      therapyPhase: detectiveCtx.therapyPhase || DEFAULT_THERAPY_PHASE_KEY,
      existentialPhase: detectiveCtx.existentialPhase || DEFAULT_EXISTENTIAL_PHASE_KEY,
    },
    philosophers: {
      narrativePhase: philosopherCtx.narrativePhase || DEFAULT_NARRATIVE_PHASE_KEY,
      secretsRevealed: {
        lumen:
          philosopherCtx.secretsRevealed && Array.isArray(philosopherCtx.secretsRevealed.lumen)
            ? philosopherCtx.secretsRevealed.lumen
            : [],
        umbra:
          philosopherCtx.secretsRevealed && Array.isArray(philosopherCtx.secretsRevealed.umbra)
            ? philosopherCtx.secretsRevealed.umbra
            : [],
      },
    },
  };
}

function transitionMainState(persisted, eventPayload) {
  const rootActor = createActor(rootMachine, {
    snapshot: isUsablePersistedSnapshot(persisted && persisted.root) ? persisted.root : undefined,
  });
  const attacheActor = createActor(attacheMachine, {
    snapshot: persisted && persisted.attache ? persisted.attache : undefined,
  });
  const detectiveActor = createActor(detectiveMachine, {
    snapshot: persisted && persisted.detective ? persisted.detective : undefined,
  });
  const philosopherActor = createActor(philosopherMachine, {
    snapshot: persisted && persisted.philosophers ? persisted.philosophers : undefined,
  });

  rootActor.start();
  attacheActor.start();
  detectiveActor.start();
  philosopherActor.start();

  if (getSnapshotValue(rootActor.getSnapshot()) === "bootstrap") {
    rootActor.send({ type: "BOOT", rehydrated: !!eventPayload.rehydrated });
  }

  if (eventPayload.returnProfile) {
    rootActor.send({ type: "SYNC_RETURN_PROFILE", returnProfile: eventPayload.returnProfile });
  }

  if (eventPayload.attache) {
    const attacheEvent = {
      type: "SYNC_ATTACHE",
      completed: !!eventPayload.attache.completed,
      closingDelivered: !!eventPayload.attache.closingDelivered,
    };
    attacheActor.send(attacheEvent);
    if (eventPayload.attache.completed) {
      rootActor.send({ type: "ATTACHE_COMPLETE" });
    } else {
      rootActor.send({ type: "ATTACHE_TURN" });
    }
  }

  if (eventPayload.detective) {
    const value = getSnapshotValue(rootActor.getSnapshot());
    if (value === "attache_handoff") {
      rootActor.send({ type: "DETECTIVE_START" });
    }
    detectiveActor.send({
      type: "ADVANCE_DETECTIVE",
      closureTurnThreshold: eventPayload.detective.closureTurnThreshold,
      therapyPhase: eventPayload.detective.therapyPhase,
      existentialPhase: eventPayload.detective.existentialPhase,
    });
    philosopherActor.send({
      type: "SYNC_PHILOSOPHERS",
      narrativePhase: eventPayload.detective.narrativePhase,
      lumenSecrets: eventPayload.detective.lumenSecrets,
      umbraSecrets: eventPayload.detective.umbraSecrets,
    });
    rootActor.send({ type: "DETECTIVE_TURN" });
    if (eventPayload.detective.summarized) {
      rootActor.send({ type: "SUMMARIZED" });
    }
  }

  if (eventPayload.startDetectiveOnly) {
    const value = getSnapshotValue(rootActor.getSnapshot());
    if (value === "attache_handoff") {
      rootActor.send({ type: "DETECTIVE_START" });
    }
  }

  rootActor.send({
    type: "SYNC_SNAPSHOTS",
    attache: attacheActor.getPersistedSnapshot(),
    detective: detectiveActor.getPersistedSnapshot(),
    philosophers: philosopherActor.getPersistedSnapshot(),
  });

  const snapshots = {
    root: rootActor.getPersistedSnapshot(),
    attache: attacheActor.getPersistedSnapshot(),
    detective: detectiveActor.getPersistedSnapshot(),
    philosophers: philosopherActor.getPersistedSnapshot(),
  };
  const view = buildMainStateView(rootActor.getSnapshot(), snapshots);
  rootActor.stop();
  attacheActor.stop();
  detectiveActor.stop();
  philosopherActor.stop();
  return { snapshots, view };
}

module.exports = {
  MAIN_STATE_SCHEMA_VERSION,
  rootMachine,
  attacheMachine,
  detectiveMachine,
  philosopherMachine,
  isUsablePersistedSnapshot,
  transitionMainState,
  buildMainStateView,
};

