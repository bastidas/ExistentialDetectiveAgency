"use strict";

const { setup, assign, createActor } = require("xstate");
const {
  classifyFromSessionAndDossier,
} = require("../session/returnClassification");
const { buildDetectiveOrchestrationFacts } = require("./buildDetectiveOrchestrationFacts");

const DETECTIVE_ORCHESTRATION_VERSION = 1;

const detectiveOrchestrationMachine = setup({
  types: {},
  actions: {
    assignSyncMeta: assign(({ event }) => {
      const facts = event && event.facts ? event.facts : {};
      return {
        orchestrationVersion: DETECTIVE_ORCHESTRATION_VERSION,
        returnCategory: facts.returnCategory != null ? facts.returnCategory : null,
        timeAwayMs:
          typeof facts.timeAwayMs === "number" && Number.isFinite(facts.timeAwayMs)
            ? facts.timeAwayMs
            : null,
        lastSyncedAt: Date.now(),
      };
    }),
  },
  guards: {
    sessionBrief: ({ event }) => event.facts?.sessionRecency === "brief",
    sessionMid: ({ event }) => event.facts?.sessionRecency === "mid",
    sessionLong: ({ event }) => event.facts?.sessionRecency === "long",
    sessionUnknown: ({ event }) => event.facts?.sessionRecency === "unknown",

    handoffNotCompleted: ({ event }) =>
      event.facts?.baselineHandoff === "not_completed",
    handoffCompleted: ({ event }) => event.facts?.baselineHandoff === "completed",

    nameNoDossier: ({ event }) => event.facts?.knownName === "no_dossier",
    nameUnnamed: ({ event }) => event.facts?.knownName === "unnamed",
    nameNamed: ({ event }) => event.facts?.knownName === "named",

    vintageNA: ({ event }) => event.facts?.baselineVintage === "not_applicable",
    vintageFresh: ({ event }) => event.facts?.baselineVintage === "fresh",
    vintageStale: ({ event }) => event.facts?.baselineVintage === "stale",
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QTAFzAY1QSwG5gHkAnDACzlSIEMcB7AOwDpaAHManfR2OWbBgEqYw9DAE8AxAGUAmgDkAwgH0FBOQBUAogA11AbQAMAXUSgWtPnXqmQAD0QBaACwBOAKyMAzN88AmAwBsAIwA7AFhvk4ANCBiiAAcBgaMbgEuTm7xTvHuBq4AvvkxKOhYeIQk5LCUNPxMrOy1XDywfILCopKyiipqWrp6QSZIIOaWdTb2CA5BaYxBQQYu6W6RTr7pnjFxCG4uQSlOs05OnhlnBr6FxWiYnBVkFBx1zGzPzbx1Qhgi4tLyylUGh0+l8wzMFmwVkmiEWvm2iBcl0YR3CnhcAQCJwxnmuIBKd3KxEe1WeDFejXu3E+7R+nX+PSB-X0nnBo0h0JGUwckRCjBCArCBjcISCSKO0ViiFFB0xaL8BiCq3ceIJZXwxKqNSsFPeYEYACMqDwADbYehgAASVHoEFoADN7QzAX0QYY2WMoRMubDLgiEAsDHz-FkgllPAERUFcUV8bd1Q8tWT6m8mvqjabzVabXbHc7esCBkMbJ7OaApnD-UF-L5GPEfPW0v5FgFVfH7pqnrVyQ09YwANb0WgAd3ocioAFswPmmW7jCWOd7y774VKEJ4lfNIstPG5vFk26UO5Uuzre2mB0PR+OpzPXUWPYuGDCA3610dkiFXMtVorI8tD0JDUT1JbsU0pcpLxHMdJ2nboXULUFH3GZ8fVfVcdl8MUUWWFwQjw3x4jcPZ4kAhNO1As9UypDMwDNC0ADVzVQKgYDvRD3QXFDrDQys1yVAxPEYbcMSWAIzhcGMbiPIkQO1F5zxo406KzJj6BYtj4ILZlBmQr1UOXdCqxIusvxcXwAiwnI-CuWM1WPEl5J7ajINo+iwDUjS4IBbS3TBLj9J4wy+J2IInCDRhLO-EUDESNwnEKWMhxQeARns2THOTAKyzsRxxJcLwfH8YIwgif1nFrJIkiwtxq2IwjbOkoDE1PBSXPwbKl1y6Y9gOHwFRK8JLP9DJ5jlWrgkstxhVbOz2wypMwN1C8Wjaehvl+HYIW4l8HHioT+uK0IhowxBpqcLwzJCeIsj2DcgjIhzFqoiCPlaL4OnERgAFd6EHaDOoM7qnBCWsMnrCM8NSSIAn9EIzmEjYsLCsI7oSuaZOAzKlsUyDVo+ukvoNIhsDAe1AaC4HQZRTJvDSEJoacWG13iDY63iyIzhuwJ0aa8i5OTZaqXx2lNsYCdsAgCmXxBsHachhmouZnZxPiSK8lCdJI2rQjHoW1rnNe-URfWz6xEYE0GCgaW0NlmmIfpxnlcRXwPBB8yGeis43D1rHnrao3DWU9zrVtB1yZGUsuqmeKq0uZINfhsVUniBZebjTGWsogO+zcrNQ9ze1GCHVAlAwWgJxYE1bilyOn0pqZsjBgJ4iT8Sg1ceJnYDaNkl8EJYpyQT+4CQJfazpzwNz4P85zcPGHLyvq-QWvtsCmXWZRFu288DuXC7qtfFdut3CI9YbrFDFx4oyehcg-7r1gm3DNj-i-EK7xQgWVI9ixa+BZxu1fUD8YJTmLrQJQdp3rsGfsDUejA8L7HygzJISp-T7nmK3VwKDEgZH-tjF6fYQE3n1L9egsFV7sh2rbeBiDZjohQYqNwI1vB1mrN+UImQsQuHwf7Q2RCrygP1OQqclCo5A0brQ-C9CoaoOYWuSItZGY5AFGFFUGNmo30FrjLgedGLMVYmAWBMdJShQVPbdE4RwoLDOLwg2U8Lx6I8gYmA4DS5UBYFXbAGAqAGmrsYxAJw1a4TwsEPYeFhTGQsl4dhG5iIYlZundKft7F310TPfR6lDGMHtEQOApAAkICCQg3CYQlTLAHvI0KlkDiSXhgkpU1Zqx2OzvwxxGTnFZNcdUKg-i67UMMsUkJZTwmVKrKcZI28mbt3WKcB6iUgA */
  id: "detectiveOrchestration",
  initial: "operative",
  context: {
    orchestrationVersion: DETECTIVE_ORCHESTRATION_VERSION,
    returnCategory: null,
    timeAwayMs: null,
    lastSyncedAt: null,
  },
  states: {
    operative: {
      type: "parallel",
      states: {
        sessionRecency: {
          initial: "unknown",
          states: {
            unknown: {},
            brief: {},
            mid: {},
            long: {},
          },
          on: {
            SYNC_CONTEXT: [
              { guard: "sessionBrief", target: ".brief", actions: "assignSyncMeta" },
              { guard: "sessionMid", target: ".mid", actions: "assignSyncMeta" },
              { guard: "sessionLong", target: ".long", actions: "assignSyncMeta" },
              { guard: "sessionUnknown", target: ".unknown", actions: "assignSyncMeta" },
            ],
          },
        },
        baselineHandoff: {
          initial: "not_completed",
          states: {
            not_completed: {},
            completed: {},
          },
          on: {
            SYNC_CONTEXT: [
              {
                guard: "handoffNotCompleted",
                target: ".not_completed",
                actions: "assignSyncMeta",
              },
              { guard: "handoffCompleted", target: ".completed", actions: "assignSyncMeta" },
            ],
          },
        },
        knownName: {
          initial: "no_dossier",
          states: {
            no_dossier: {},
            unnamed: {},
            named: {}
          },
          on: {
            SYNC_CONTEXT: [
              {
                guard: "nameNoDossier",
                target: ".no_dossier",
                actions: "assignSyncMeta",
              },
              { guard: "nameUnnamed", target: ".unnamed", actions: "assignSyncMeta" },
              { guard: "nameNamed", target: ".named", actions: "assignSyncMeta" },
            ],
          },
        },
        baselineVintage: {
          initial: "not_applicable",
          states: {
            not_applicable: {},
            fresh: {},
            stale: {},
          },
          on: {
            SYNC_CONTEXT: [
              {
                guard: "vintageNA",
                target: ".not_applicable",
                actions: "assignSyncMeta",
              },
              { guard: "vintageFresh", target: ".fresh", actions: "assignSyncMeta" },
              { guard: "vintageStale", target: ".stale", actions: "assignSyncMeta" },
            ],
          },
        },
      },
    },
  },
});

/**
 * @param {unknown} persisted
 * @returns {boolean}
 */
function isUsablePersistedSnapshot(persisted) {
  if (!persisted || typeof persisted !== "object") return false;
  const v = persisted.context && persisted.context.orchestrationVersion;
  return v === DETECTIVE_ORCHESTRATION_VERSION;
}

/**
 * @param {{ context?: object, value?: unknown }} snapshot
 * @returns {object}
 */
function buildDetectiveOrchestrationView(snapshot) {
  const ctx = snapshot.context || {};
  const op =
    snapshot.value &&
    typeof snapshot.value === "object" &&
    snapshot.value.operative &&
    typeof snapshot.value.operative === "object"
      ? snapshot.value.operative
      : null;

  if (!op) {
    return {
      sessionRecency: "unknown",
      baselineHandoff: "not_completed",
      knownName: "no_dossier",
      baselineVintage: "not_applicable",
      returnCategory: ctx.returnCategory != null ? ctx.returnCategory : null,
      timeAwayMs:
        typeof ctx.timeAwayMs === "number" && Number.isFinite(ctx.timeAwayMs)
          ? ctx.timeAwayMs
          : null,
      machineVersion: DETECTIVE_ORCHESTRATION_VERSION,
    };
  }

  return {
    sessionRecency: op.sessionRecency,
    baselineHandoff: op.baselineHandoff,
    knownName: op.knownName,
    baselineVintage: op.baselineVintage,
    returnCategory: ctx.returnCategory != null ? ctx.returnCategory : null,
    timeAwayMs:
      typeof ctx.timeAwayMs === "number" && Number.isFinite(ctx.timeAwayMs)
        ? ctx.timeAwayMs
        : null,
    machineVersion:
      typeof ctx.orchestrationVersion === "number"
        ? ctx.orchestrationVersion
        : DETECTIVE_ORCHESTRATION_VERSION,
  };
}

/**
 * @param {object|null|undefined} persistedSnapshot
 * @param {object} facts
 */
function applyDetectiveOrchestrationSync(persistedSnapshot, facts) {
  const actor = createActor(detectiveOrchestrationMachine, {
    snapshot: isUsablePersistedSnapshot(persistedSnapshot) ? persistedSnapshot : undefined,
  });
  actor.start();
  actor.send({ type: "SYNC_CONTEXT", facts });
  const snap = actor.getSnapshot();
  return {
    persistedSnapshot: actor.getPersistedSnapshot(),
    view: buildDetectiveOrchestrationView(snap),
  };
}

/**
 * @param {object} conversationState
 * @param {object|null} session
 * @param {object|null} dossier
 * @param {Date} [now]
 */
function mergeDetectiveOrchestrationIntoConversationState(
  conversationState,
  session,
  dossier,
  now
) {
  const base =
    conversationState && typeof conversationState === "object" ? { ...conversationState } : {};
  const when = now instanceof Date ? now : new Date();
  const classification =
    session && session.lastReturnClassification != null
      ? session.lastReturnClassification
      : classifyFromSessionAndDossier(session, dossier, when);
  const facts = buildDetectiveOrchestrationFacts(session, dossier, classification, when);
  const persisted = base.detective_xstate_snapshot;
  const { persistedSnapshot, view } = applyDetectiveOrchestrationSync(persisted, facts);
  base.detective_xstate_snapshot = persistedSnapshot;
  base.detective_orchestration = view;
  return base;
}

/**
 * Build detective-only dynamic instruction text from orchestration state.
 * This keeps orchestration details internal while still shaping greeting style.
 *
 * @param {object|null|undefined} internalState
 * @returns {string}
 */
function buildDetectiveStateInstruction(internalState) {
  const recency =
    internalState &&
    internalState.detective_orchestration &&
    typeof internalState.detective_orchestration === "object"
      ? internalState.detective_orchestration.sessionRecency
      : "unknown";

  switch (recency) {
    case "brief":
      return [
        "State note: The user appears to have returned briefly.",
        "Mention apples. You must say how do you like them apples? Talk about apples.",
        "Greeting guidance: treat this as a direct continuation; keep the opening minimal and avoid reorientation.",
      ].join("\n");
    case "mid":
      return [
        "State note: The user appears to be returning after some time.",
        "tell the user about pineapples. Pineapple are important to mention!",
        "Greeting guidance: acknowledge their return in one short line, then quickly re-anchor in their current concern.",
      ].join("\n");
    case "long":
      return [
        "State note: The user appears to be returning after a long absence.",
        "tell the user about bananas. Bananas are important to mention!",
        "Greeting guidance: offer a warm re-entry greeting and briefly re-establish context before moving into inquiry.",
      ].join("\n");
    default:
      return [
        "State note: Session recency is uncertain.",
        "Greeting guidance: use a neutral, low-assumption opening and let the user define where to begin.",
      ].join("\n");
  }
}

module.exports = {
  detectiveOrchestrationMachine,
  DETECTIVE_ORCHESTRATION_VERSION,
  buildDetectiveOrchestrationView,
  applyDetectiveOrchestrationSync,
  mergeDetectiveOrchestrationIntoConversationState,
  buildDetectiveStateInstruction,
  isUsablePersistedSnapshot,
};
