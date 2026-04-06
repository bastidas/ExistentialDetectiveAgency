"use strict";

const { setup, assign } = require("xstate");

/**
 * Narrative-only state for Lumen/Umbra (parallel with detective).
 * Not used as HTTP routing; `chatService` persists per-session snapshot and sends `NARRATIVE_TURN` after each detective turn.
 */
const philosophersNarrativeMachine = setup({
  actions: {
    incTurn: assign({
      narrativeTurn: ({ context }) =>
        (typeof context.narrativeTurn === "number" ? context.narrativeTurn : 0) + 1,
    }),
  },
}).createMachine({
  id: "philosophersNarrative",
  initial: "active",
  context: {
    narrativeTurn: 0,
  },
  states: {
    active: {
      on: {
        NARRATIVE_TURN: { actions: ["incTurn"] },
      },
    },
  },
});

/** @deprecated Use `philosophersNarrativeMachine`; kept for require() compatibility. */
const philosophersMachine = philosophersNarrativeMachine;

module.exports = {
  philosophersNarrativeMachine,
  philosophersMachine,
};
