"use strict";

const { setup, assign } = require("xstate");
const { composeAgentPrompt } = require("../prompts/promptComposer");
const { getPromptRegistryEntry } = require("../prompts/promptRegistry");
const { buildMockAgentReply } = require("../agents/mockAgentTurn");
const {
  computeDetectiveCatalogInstructionIds,
  DETECTIVE_CATALOG_ID_BY_VISIT_BIN,
} = require("./detectivePromptPolicy");

/**
 * Legal single-step transitions only: initial↔middle, middle↔final (no initial↔final).
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function isLegalNeighborPhaseTransition(from, to) {
  const edges = {
    initial: ["middle"],
    middle: ["initial", "final"],
    final: ["middle"],
  };
  return edges[from]?.includes(to) === true;
}

/**
 * Detective orchestrator for chatMachine `invoke()` and persisted HTTP-session policy.
 *
 * - `existentialTherapyPhase` (initial | middle | final): updated via `SET_EXISTENTIAL_PHASE` with
 *   `payload.targetPhase` (validated in machine guards).
 * - `instructionIds`: return-state catalog ids from `POLICY_TURN` (same payload as
 *   [`computeDetectiveCatalogInstructionIds`](./detectivePromptPolicy.js)); persisted per session in
 *   [`runDetectivePromptPolicyTurn`](./detectiveExistentialSession.js).
 *
 * `MOCK_TURN` builds a diagnostic string via composeAgentPrompt + buildMockAgentReply (no HTTP).
 *
 * **Visualizers (Stately Studio, VS Code XState, @statelyai/inspect):** `description` and `meta` on
 * `active` document how `visit_bin` and closure map to `prompt_catalog.json` ids. Inspect `state.meta`
 * on the active node, or use Studio’s state panel. Runtime ids live in `context.instructionIds` after
 * `POLICY_TURN`.
 */
const detectiveMachine = setup({
  guards: {
    validSetExistentialPhase: ({ context, event }) => {
      const target = event && event.payload && event.payload.targetPhase;
      const from =
        context && context.existentialTherapyPhase === "middle"
          ? "middle"
          : context && context.existentialTherapyPhase === "final"
            ? "final"
            : "initial";
      if (target !== "initial" && target !== "middle" && target !== "final") return false;
      return isLegalNeighborPhaseTransition(from, target);
    },
  },
  actions: {
    seed: assign({ ready: true }),
    applySetExistentialPhase: assign(({ event }) => {
      const target = event && event.payload && event.payload.targetPhase;
      const t =
        target === "initial" || target === "middle" || target === "final" ? target : "initial";
      return { existentialTherapyPhase: t };
    }),
    resetPhaseToInitial: assign({ existentialTherapyPhase: "initial" }),
    applyPolicyTurn: assign(({ event }) => {
      const payload =
        event && event.type === "POLICY_TURN" && event.payload && typeof event.payload === "object"
          ? event.payload
          : {};
      return {
        instructionIds: computeDetectiveCatalogInstructionIds(payload),
      };
    }),
    runMockTurn: assign(({ event, context }) => {
      const userMessage = event && event.userMessage != null ? String(event.userMessage) : "";
      const raw = event && event.session && typeof event.session === "object" ? event.session : {};
      const machineCtx = context && typeof context === "object" ? context : {};
      const phase =
        machineCtx.existentialTherapyPhase === "middle" || machineCtx.existentialTherapyPhase === "final"
          ? machineCtx.existentialTherapyPhase
          : "initial";
      const fromMachineIds = Array.isArray(machineCtx.instructionIds) ? machineCtx.instructionIds : [];
      const session = {
        ...raw,
        existential_therapy_phase: phase,
        detective_turn_count: 0,
        detective_prompt_instruction_ids: Array.isArray(raw.detective_prompt_instruction_ids)
          ? raw.detective_prompt_instruction_ids
          : fromMachineIds.length > 0
            ? fromMachineIds
            : computeDetectiveCatalogInstructionIds({
                visit_bin: raw.visit_bin != null ? String(raw.visit_bin) : "brief",
                temporal_greeting_mode:
                  raw.temporal_greeting_mode != null ? String(raw.temporal_greeting_mode) : "none",
                dossier_stale_by_age: raw.dossier_stale_by_age === true,
                returnCategory: raw.returnCategory != null ? String(raw.returnCategory) : "",
              }),
      };
      const composed = composeAgentPrompt({
        agentKey: "detective",
        session,
        internalState: event && event.internalState ? event.internalState : {},
      });
      const reg = getPromptRegistryEntry("detective");
      const lastMockReply = buildMockAgentReply({
        agentKey: "detective",
        userMessage,
        machineStateSummary: { value: "active" },
        promptPaths: reg
          ? {
              persona: reg.personaPath,
              instructions: reg.instructionsPath,
              outputSchema: reg.outputSchemaPath,
              prompts: reg.promptsPath,
            }
          : {},
        llmSafeState: composed.llmSafeState,
        custom: "",
      });
      return { lastMockReply, ready: true };
    }),
  },
}).createMachine({
  id: "detectiveOrchestrator",
  initial: "active",
  context: {
    ready: false,
    lastMockReply: "",
    /** @type {"initial"|"middle"|"final"} */
    existentialTherapyPhase: "initial",
    /** @type {string[]} — detective `prompt_catalog.json` ids from last `POLICY_TURN` */
    instructionIds: [],
  },
  states: {
    active: {
      description:
        "POLICY_TURN → context.instructionIds. visit_bin → DETECTIVE_RETURN_*; closure_phase → DETECTIVE_CLOSURE_* (see meta.promptCatalog).",
      meta: {
        promptCatalog: {
          visitBinToId: { ...DETECTIVE_CATALOG_ID_BY_VISIT_BIN },
          closurePhaseToId: {
            penultimate: "DETECTIVE_CLOSURE_PENULTIMATE",
            ultimate: "DETECTIVE_CLOSURE_ULTIMATE",
          },
          legacyReturnCategory:
            "When visit_bin missing: returnCategory maps to DETECTIVE_RETURN_BRIEF | DAY_OR_SO | LONG_GONE | UNKNOWN (see detectivePromptPolicy).",
        },
      },
      entry: [{ type: "seed" }],
      on: {
        MOCK_TURN: { actions: ["runMockTurn"] },
        POLICY_TURN: { actions: ["applyPolicyTurn"] },
        SET_EXISTENTIAL_PHASE: {
          guard: "validSetExistentialPhase",
          actions: ["applySetExistentialPhase"],
        },
        RESET_EXISTENTIAL_PHASE: { actions: ["resetPhaseToInitial"] },
      },
    },
  },
});

module.exports = {
  detectiveMachine,
  isLegalNeighborPhaseTransition,
};
