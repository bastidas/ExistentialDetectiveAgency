"use strict";

const { setup, createMachine } = require("xstate");

/**
 * Placeholder for shared Umbra + Lumen orchestration.
 *
 * Both philosophers will eventually read and write the same XState context here
 * (e.g. debate phase, shared motifs) while keeping separate persona prompts.
 * Wire this into chatService when those flows are ready.
 */

const philosophersOrchestrationMachine = setup({
  types: {},
}).createMachine({
  id: "philosophersOrchestration",
  initial: "idle",
  context: {},
  states: {
    idle: {},
  },
});

/**
 * @param {unknown} _snapshot
 * @returns {Record<string, never>}
 */
function buildPhilosophersOrchestrationView(_snapshot) {
  return {};
}

module.exports = {
  philosophersOrchestrationMachine,
  buildPhilosophersOrchestrationView,
};
