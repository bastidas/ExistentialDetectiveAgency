"use strict";

const { setup, assign, createMachine } = require("xstate");

// Default ranges for how many questions each baseline phase can have.
const MIN_BASELINE1_QUESTIONS = 1;
const MAX_BASELINE1_QUESTIONS = 2;
const MIN_BASELINE2_QUESTIONS = 1;
const MAX_BASELINE2_QUESTIONS = 2;
const MIN_BASELINE3_QUESTIONS = 1;
const MAX_BASELINE3_QUESTIONS = 2;

// Safety cap enforced in attacheRuntime.
const ATTACHE_MAX_TURNS = 100;
const RANDOM_Q_ORDER = true;

/**
 * **XState visualizers (Stately Studio, VS Code XState, @statelyai/inspect):**
 * - Each state’s `description` names typical `prompt_catalog.json` entry ids for that domain phase.
 * - `meta` holds structured catalog hints; in Stately Studio select a state to see it in the side panel.
 *   With `@statelyai/inspect`, the inspected snapshot exposes merged meta for the current state.
 * - [Tags](https://stately.ai/docs/tags) on each state (`phase:start`, `phase:explore`, `phase:baseline`, …) for
 *   `snapshot.hasTag(...)` and Stately Studio grouping.
 * - `@xstate-layout` on the machine controls graph layout in Stately Studio only.
 * - Runtime ids for the outgoing LLM call: `context.attachePromptInstructionIds` after `ATTACHE_BEGIN_TURN`
 *   (return tier may prepend `ATTACHE_RETURN_*`; see `attachePromptPolicy`).
 */

/**
 * @typedef {Object} AttacheState
 * @property {"start"|"explore"|"baseline1"|"baseline2"|"baseline3"|"close"} phase
 * @property {1|2|3|null} baseline_number
 * @property {number} question_index
 * @property {number} n_questions_in_baseline
 * @property {"baseline1"|"baseline2"|"baseline3"|"close"|null} potential_next_phase
 * @property {"start"|"explore"|"baseline1"|"baseline2"|"baseline3"|"close"|null} previous_phase
 * @property {number|null} previous_question_index
 * @property {string|null} current_phase_id
 * @property {"start"|"baseline1"|"baseline2"|"baseline3"|null} [phase_before_close]
 * @property {number|null} [question_index_before_close]
 */

function getRandomBaselineQuestionCount(baselineNumber) {
  let min = MIN_BASELINE1_QUESTIONS;
  let max = MAX_BASELINE1_QUESTIONS;
  if (baselineNumber === 2) {
    min = MIN_BASELINE2_QUESTIONS;
    max = MAX_BASELINE2_QUESTIONS;
  } else if (baselineNumber === 3) {
    min = MIN_BASELINE3_QUESTIONS;
    max = MAX_BASELINE3_QUESTIONS;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

function getBaselineNumberFromPhase(phase) {
  if (phase === "baseline1") return 1;
  if (phase === "baseline2") return 2;
  if (phase === "baseline3") return 3;
  return null;
}

/**
 * @param {Partial<AttacheState>} partial
 * @returns {AttacheState}
 */
function createAttacheState(partial = {}) {
  const phase = partial.phase != null ? partial.phase : "start";
  const bn = getBaselineNumberFromPhase(phase);
  const nDefault = bn != null ? getRandomBaselineQuestionCount(bn) : getRandomBaselineQuestionCount(1);
  const base = {
    phase,
    baseline_number:
      partial.baseline_number != null ? partial.baseline_number : bn,
    question_index:
      typeof partial.question_index === "number" ? partial.question_index : 0,
    n_questions_in_baseline:
      typeof partial.n_questions_in_baseline === "number" && partial.n_questions_in_baseline > 0
        ? partial.n_questions_in_baseline
        : nDefault,
    potential_next_phase:
      partial.potential_next_phase !== undefined ? partial.potential_next_phase : "baseline1",
    previous_phase: partial.previous_phase !== undefined ? partial.previous_phase : null,
    previous_question_index:
      partial.previous_question_index !== undefined ? partial.previous_question_index : null,
    current_phase_id: partial.current_phase_id !== undefined ? partial.current_phase_id : null,
    phase_before_close: partial.phase_before_close !== undefined ? partial.phase_before_close : null,
    question_index_before_close:
      partial.question_index_before_close !== undefined ? partial.question_index_before_close : null,
  };
  base.current_phase_id = base.current_phase_id || computeCurrentPhaseId(base);
  return /** @type {AttacheState} */ (base);
}

/**
 * @param {{ user_intends_explore?: boolean, user_intends_close?: boolean }} output
 * @returns {"explore"|"close"|"baseline"}
 */
function normalizeIntent(output) {
  if (!output || typeof output !== "object") return "baseline";
  if (output.user_intends_explore) return "explore";
  if (output.user_intends_close) return "close";
  return "baseline";
}

/**
 * @param {AttacheState} state
 * @returns {string}
 */
function computeCurrentPhaseId(state) {
  if (!state || typeof state !== "object") return "unknown";
  const { phase, question_index, phase_before_close, potential_next_phase } = state;
  if (phase === "start") return "start";
  if (phase === "explore") {
    const hint = potential_next_phase && String(potential_next_phase).startsWith("baseline")
      ? potential_next_phase
      : "start";
    return `explore_from_${hint}`;
  }
  if (phase && phase.startsWith("baseline")) {
    const q = typeof question_index === "number" ? question_index : 0;
    return `${phase}_q${q}`;
  }
  if (phase === "close") {
    if (phase_before_close === "baseline3") return "close_from_final_baseline3";
    if (phase_before_close) return `close_from_${phase_before_close}`;
    return "close";
  }
  return "unknown";
}

/**
 * Pure transition (see attacheOrchestrator-plan.md).
 * Third arg: `asked_baseline_question` from the attaché LLM JSON this turn.
 * When true, baseline `question_index` advances (or moves to the next baseline phase
 * after the last question in the current one). When false, baseline state is unchanged.
 *
 * @param {AttacheState} state
 * @param {"explore"|"close"|"baseline"} intent
 * @param {boolean} [askedBaselineQuestion]
 * @returns {AttacheState}
 */
function transition(state, intent, askedBaselineQuestion = true) {
  const s = createAttacheState(state);
  const { phase, question_index, n_questions_in_baseline, potential_next_phase } = s;
  /** @type {AttacheState} */
  let next = createAttacheState(s);

  if (phase === "start") {
    if (intent === "explore") {
      next.phase = "explore";
      next.potential_next_phase = "baseline1";
      next.question_index = 0;
      next.baseline_number = null;
    } else if (intent === "close") {
      next.phase = "close";
      next.potential_next_phase = "start";
      next.phase_before_close = "start";
      next.question_index_before_close = 0;
      next.baseline_number = null;
    } else {
      next.phase = "baseline1";
      next.question_index = 0;
      next.baseline_number = 1;
      next.n_questions_in_baseline = getRandomBaselineQuestionCount(1);
      next.potential_next_phase = "baseline2";
    }
    next.current_phase_id = computeCurrentPhaseId(next);
    return next;
  }

  if (phase.startsWith("baseline")) {
    const currentBaseline = phase;
    if (intent === "explore") {
      next.phase = "explore";
      next.potential_next_phase = currentBaseline;
      next.previous_phase = currentBaseline;
      next.previous_question_index = question_index;
      next.baseline_number = getBaselineNumberFromPhase(currentBaseline);
    } else if (intent === "close") {
      next.phase = "close";
      next.phase_before_close = currentBaseline;
      next.question_index_before_close = question_index;
      next.potential_next_phase = currentBaseline;
      next.baseline_number = getBaselineNumberFromPhase(currentBaseline);
    } else {
      const nextIndex = question_index + 1;
      if (nextIndex < n_questions_in_baseline) {
        if (!askedBaselineQuestion) {
          return createAttacheState(s);
        }
        next.phase = currentBaseline;
        next.question_index = nextIndex;
        next.potential_next_phase = currentBaseline;
        next.baseline_number = getBaselineNumberFromPhase(currentBaseline);
      } else if (currentBaseline === "baseline1") {
        if (!askedBaselineQuestion) {
          return createAttacheState(s);
        }
        next.phase = "baseline2";
        next.question_index = 0;
        next.n_questions_in_baseline = getRandomBaselineQuestionCount(2);
        next.potential_next_phase = "baseline3";
        next.baseline_number = 2;
      } else if (currentBaseline === "baseline2") {
        if (!askedBaselineQuestion) {
          return createAttacheState(s);
        }
        next.phase = "baseline3";
        next.question_index = 0;
        next.n_questions_in_baseline = getRandomBaselineQuestionCount(3);
        next.potential_next_phase = "close";
        next.baseline_number = 3;
      } else {
        if (!askedBaselineQuestion) {
          return createAttacheState(s);
        }
        next.phase = "close";
        next.phase_before_close = "baseline3";
        next.question_index_before_close = question_index;
        next.potential_next_phase = "close";
        next.baseline_number = 3;
      }
    }
    next.current_phase_id = computeCurrentPhaseId(next);
    return next;
  }

  if (phase === "explore") {
    if (intent === "explore") {
      next.current_phase_id = computeCurrentPhaseId(next);
      return next;
    }
    if (intent === "close") {
      next.phase = "close";
      next.phase_before_close = potential_next_phase || "start";
      next.question_index_before_close = question_index;
    } else if (intent === "baseline") {
      if (potential_next_phase && potential_next_phase.startsWith("baseline")) {
        next.phase = potential_next_phase;
        next.baseline_number = getBaselineNumberFromPhase(potential_next_phase);
        next.n_questions_in_baseline = getRandomBaselineQuestionCount(
          /** @type {1|2|3} */ (next.baseline_number || 1)
        );
      } else {
        next.phase = "baseline1";
        next.question_index = 0;
        next.n_questions_in_baseline = getRandomBaselineQuestionCount(1);
        next.potential_next_phase = "baseline2";
        next.baseline_number = 1;
      }
    }
    next.current_phase_id = computeCurrentPhaseId(next);
    return next;
  }

  if (phase === "close") {
    if (intent === "explore") {
      next.phase = "explore";
    } else if (intent === "close") {
      return next;
    } else if (
      potential_next_phase &&
      String(potential_next_phase).startsWith("baseline") &&
      next.phase_before_close &&
      String(next.phase_before_close).startsWith("baseline")
    ) {
      // Resume interrupted baseline only when we *exited* with a baseline still in play
      // (`potential_next_phase` still points at baseline1/2/3). Nominal completion of
      // baseline3 sets `potential_next_phase` to `"close"`; generic LLM intent "baseline"
      // (neither explore nor close) must *not* snap back to baseline during the handoff turn.
      next.phase = next.phase_before_close;
      next.question_index = next.question_index_before_close ?? 0;
    }
    next.current_phase_id = computeCurrentPhaseId(next);
    return next;
  }

  next.current_phase_id = computeCurrentPhaseId(next);
  return next;
}

/**
 * One-step domain phase adjacency for `transition()` (used for docs + optional dev asserts).
 * Orchestrator nodes map 1:1: start→intro, explore→exploring, baseline*→baseline*, close→closing.
 * Resume-from-close picks the baseline in `phase_before_close` / `potential_next_phase`; explore
 * returns via `potential_next_phase` to the interrupted baseline.
 *
 * @type {Record<string, ReadonlySet<string>>}
 */
const ATTACHE_DOMAIN_ONE_STEP_PHASES = {
  start: new Set(["explore", "baseline1", "close"]),
  explore: new Set(["explore", "baseline1", "baseline2", "baseline3", "close"]),
  baseline1: new Set(["explore", "close", "baseline1", "baseline2"]),
  baseline2: new Set(["explore", "close", "baseline2", "baseline3"]),
  baseline3: new Set(["explore", "close", "baseline3"]),
  close: new Set(["explore", "close", "baseline1", "baseline2", "baseline3"]),
};

/**
 * @param {string|undefined} prevPhase
 * @param {string|undefined} nextPhase
 * @returns {boolean}
 */
function isValidAttacheOneStepPhasePair(prevPhase, nextPhase) {
  if (prevPhase === nextPhase) return true;
  const allowed = ATTACHE_DOMAIN_ONE_STEP_PHASES[prevPhase];
  return Boolean(allowed && nextPhase && allowed.has(nextPhase));
}

/**
 * Return-tier bucket for `ATTACHE_BEGIN_TURN` routing (lazy-requires `attachePromptPolicy` on first use).
 *
 * @param {Record<string, unknown>} raw — event.payload
 * @returns {"none"|"dayOrSo"|"longGone"|"staleVisit"}
 */
function classifyFirstTurnReturnFromBeginPayload(raw) {
  const { classifyAttacheFirstTurnReturnPrimary } = require("./attachePromptPolicy");
  const facts = {
    visit_bin: raw.visit_bin != null ? String(raw.visit_bin) : "",
    baseline_return_greeting_pending: raw.baseline_return_greeting_pending === true,
    stale_dossier_rebaseline: raw.stale_dossier_rebaseline === true,
    returnCategory: raw.returnCategory != null ? String(raw.returnCategory) : "",
    has_dossier: raw.has_dossier === true,
    dossier_stale_by_age: raw.dossier_stale_by_age === true,
  };
  return classifyAttacheFirstTurnReturnPrimary(facts);
}

/**
 * @param {unknown} event
 * @returns {Record<string, unknown>|null}
 */
function attacheBeginTurnPayload(event) {
  return event && /** @type {{ type?: string }} */ (event).type === "ATTACHE_BEGIN_TURN" && event.payload != null && typeof event.payload === "object"
    ? /** @type {Record<string, unknown>} */ (event.payload)
    : null;
}

/**
 * XState chart for attaché phases (invoked from `chatMachine`). Uses [compound parent states](https://stately.ai/docs/parent-states):
 * - **start.*** ↔ `AttacheState.phase === "start"` — children encode first-turn **return tier** (recency bin / pending /
 *   `stale_dossier_rebaseline`) vs **subsequent** turns on start; ids still from `computeAttacheCatalogInstructionIds`.
 * - **explore.exploring** ↔ `"explore"`
 * - **baseline.baseline1|2|3** ↔ baseline phases
 * - **close.closing** ↔ `"close"`
 *
 * `context.attacheState` is the source of truth for prompts/runtime; each `ATTACHE_TURN`
 * applies the pure `transition()`, then `always` routes to the matching state node.
 *
 * Logical domain edges (see `ATTACHE_DOMAIN_ONE_STEP_PHASES`):
 * - **start** → explore | baseline1 | close
 * - **explore** → same | any baseline | close (resume target lives in `potential_next_phase`)
 * - **baseline1** → explore | close | baseline2 | same (mid-question)
 * - **baseline2** → explore | close | baseline3 | same
 * - **baseline3** → explore | close | same (then close when block completes)
 * - **close** → explore | same | resume baseline only if `potential_next_phase` still names a baseline
 *   (early exit). After nominal baseline3 completion, `potential_next_phase` is `"close"`—generic
 *   `baseline` intent then stays in close for the handoff turn.
 *
 * Prompt catalog ids (`attachePromptInstructionIds` on context) are assigned on `ATTACHE_BEGIN_TURN`
 * via `computeAttacheCatalogInstructionIds` in `attachePromptPolicy` (lazy-required to avoid circular
 * import with that module). `ATTACHE_TURN` only advances `attacheState`; it does not recompute ids.
 */
const attacheOrchestratorMachine = setup({
  actions: {
    applyAttacheBeginTurn: assign(({ context, event }) => {
      const { computeAttacheCatalogInstructionIds } = require("./attachePromptPolicy");
      const e = event && event.type === "ATTACHE_BEGIN_TURN" ? event : null;
      const raw = e && e.payload != null && typeof e.payload === "object" ? e.payload : {};
      const attacheState =
        raw.attacheState && typeof raw.attacheState === "object"
          ? raw.attacheState
          : context.attacheState != null
            ? context.attacheState
            : createAttacheState({});
      const ids = computeAttacheCatalogInstructionIds({
        attacheState,
        attache_turn_count: raw.attache_turn_count,
        attache_close_count: raw.attache_close_count,
        visit_bin: raw.visit_bin,
        baseline_return_greeting_pending: raw.baseline_return_greeting_pending,
        stale_dossier_rebaseline: raw.stale_dossier_rebaseline,
        returnCategory: raw.returnCategory,
        has_dossier: raw.has_dossier,
        dossier_stale_by_age: raw.dossier_stale_by_age,
      });
      return {
        attacheState,
        attachePromptInstructionIds: ids,
      };
    }),
    applyAttacheTransition: assign(({ context, event }) => {
      const e = event && event.type === "ATTACHE_TURN" ? event : null;
      let intent = "baseline";
      let asked = true;
      if (e && e.llmOutput && typeof e.llmOutput === "object") {
        intent = normalizeIntent(e.llmOutput);
        asked = !!e.llmOutput.asked_baseline_question;
      } else if (
        e &&
        (e.intent === "explore" || e.intent === "close" || e.intent === "baseline")
      ) {
        intent = e.intent;
        asked = typeof e.askedBaselineQuestion === "boolean" ? e.askedBaselineQuestion : true;
      }
      const prev = context.attacheState != null ? context.attacheState : createAttacheState({});
      const next = transition(prev, intent, asked);
      if (
        process.env.ATTACHE_ASSERT_DOMAIN_TRANSITIONS === "1" &&
        !isValidAttacheOneStepPhasePair(prev.phase, next.phase)
      ) {
        throw new Error(
          `Invalid attache domain transition ${String(prev.phase)} -> ${String(next.phase)} (intent=${intent})`
        );
      }
      return {
        attacheState: next,
      };
    }),
  },
  guards: {
    phaseIsExplore: ({ context }) => context.attacheState?.phase === "explore",
    phaseIsBaseline1: ({ context }) => context.attacheState?.phase === "baseline1",
    phaseIsBaseline2: ({ context }) => context.attacheState?.phase === "baseline2",
    phaseIsBaseline3: ({ context }) => context.attacheState?.phase === "baseline3",
    phaseIsClose: ({ context }) => context.attacheState?.phase === "close",
    /** `ATTACHE_BEGIN_TURN` routes explicit `start.*` reentry states; guards read `event.payload` (turn count + visit facts). */
    beginTurnRoutesStartSubsequent: ({ event }) => {
      const p = attacheBeginTurnPayload(event);
      if (!p || p.attacheState?.phase !== "start") return false;
      const tc = p.attache_turn_count;
      const n = typeof tc === "number" && Number.isFinite(tc) ? Math.max(0, Math.trunc(tc)) : 0;
      return n > 0;
    },
    beginTurnRoutesStartFirstStaleVisit: ({ event }) => {
      const p = attacheBeginTurnPayload(event);
      if (!p || p.attacheState?.phase !== "start") return false;
      const tc = p.attache_turn_count;
      const n = typeof tc === "number" && Number.isFinite(tc) ? Math.max(0, Math.trunc(tc)) : 0;
      if (n !== 0) return false;
      return classifyFirstTurnReturnFromBeginPayload(p) === "staleVisit";
    },
    beginTurnRoutesStartFirstLongGone: ({ event }) => {
      const p = attacheBeginTurnPayload(event);
      if (!p || p.attacheState?.phase !== "start") return false;
      const tc = p.attache_turn_count;
      const n = typeof tc === "number" && Number.isFinite(tc) ? Math.max(0, Math.trunc(tc)) : 0;
      if (n !== 0) return false;
      return classifyFirstTurnReturnFromBeginPayload(p) === "longGone";
    },
    beginTurnRoutesStartFirstDayOrSo: ({ event }) => {
      const p = attacheBeginTurnPayload(event);
      if (!p || p.attacheState?.phase !== "start") return false;
      const tc = p.attache_turn_count;
      const n = typeof tc === "number" && Number.isFinite(tc) ? Math.max(0, Math.trunc(tc)) : 0;
      if (n !== 0) return false;
      return classifyFirstTurnReturnFromBeginPayload(p) === "dayOrSo";
    },
    beginTurnRoutesStartFirstNoReturn: ({ event }) => {
      const p = attacheBeginTurnPayload(event);
      if (!p || p.attacheState?.phase !== "start") return false;
      const tc = p.attache_turn_count;
      const n = typeof tc === "number" && Number.isFinite(tc) ? Math.max(0, Math.trunc(tc)) : 0;
      if (n !== 0) return false;
      return classifyFirstTurnReturnFromBeginPayload(p) === "none";
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QEMAurkGMAWYDyATjnKgWgPYEDEAggCp00DCAEgKID6AQmwOICSAOQ50AqgCVBAbQAMAXUSgADuVgBLVGvIA7RSAAeiAIwBOAGwA6MwBYA7EYBMZgBxHr15w4A0IAJ6IAWiNHAGYLI1s7CJsI2xCAX3ifNAxiQmJYUgpqekZWTh4BYTFJKSMFJBAVdU0dPUMEIOsjCwcQ6xC451d3Z3Mff0aHawcLTttbMwBWGSMpueczW0Tk9CxcdNxMslRKWgZmdm4+IREJaQcK5VUNLV1KhocnC08psyNnW3M+6yWBwM61isbimoJkw2C0xWIBS63wRC2WV2OQO+WORTOpRCVyqN1q91ADVMJlaU2sJgcUwcMneIUp-0aUxCLRkXXsS1mb2hsLSCJIOz2uUOBROxXOUmsOOqtzqD2MtimFhk4LMIVcHziZlVDICtgcznClNsnxMU26Sym3LWvIySMFqKOhVOJWkUyleLu9WMZhkLwc9j6RhCISmppkzh1i19ZlNT3aarcJhMVtSGz522y+zyRxdsndNU9csZDhanRkofa+uCJlsOuCcxexvmznaNdMZhTcM2-Mzeb00vxXqGZosEzi4PGIxsOqepKp4f1nX9lI7SRh1rTtoF1DK+ZlBIMiDMow8SY8Jess2Vtb8iA8QOcM2Cw0fdKpnZtiO3VCkl37HtlQkjxPPoTHPNwr1ZBlJhaIxlSMH1JjJJNLTXHlNy-XtsX-AtAMPBBjwsU8wM8CC4Kg28EG6MIfVmX4ZBMEITFmVdVlTeEt17SUcP3IdCOI8DL3Im9BnIyxyKDNw4xkTpEjXbRyAgOA9HQjjMORHjByLXUGPCawzTaf1wymBU6xLMJnA6AzKXDRxljQjc1J7ZELEyZACFQTTCyAhAviBMC2kskNnGVEwI0ooJHEseMyVcWxlRbD8MOcyhXIwDyLDUbRSHIcQwDAbKCF8ABlABXAAjWAwAAR1KgrPMqAdvPwyzRgCtUrJChjwsGAJGIfKyQnBOYlneJKnIzFy3IyrKcoAMTUAhMkEXKwFQUqCAPJq8IaVqLHaoKzVCnrAk1MYrKpDwVUShz2O7SbUum1BMsK8gFqW1AABFkF8QhivILydsQPaDs646dSZWwXisyJIg8H0Elurt0ztAg0vc57ZoIN7FsyAAZHQoF4HQwEBg9dpGfaRg64LwYi5kSSC2jH1mY1rHG+7UfRmbXvezJiowAAbMAADU1BqMmhxB6nDq6sKzNLDpj2ZNwJhpDmUe3CwwH0JRBcoUnGoA8m730pVFmmdplUpJiGQQtqLbVEwPkWJkNc4lydb1g3td1-WCCyqBJaLckwnDLUmUvcEmRMBkHDA-aLZMyIg1DGx3fU1LyuQKrBayw3rlwk2ECYyxyTPGx5mYkYGVBA06QpNoIgWEMM5StHs9z-OLE7sA8+0MAjGDnz3CBcuwMr0wZBryiY19BuITPVkJjbh6O5zvvu97-uwAcYf8NHoikwn-Sp5nwZXFGTxG7iJ47DC1eue3reN53kJ94aQ-x9+U-q+8SjGKKgXlFGY3Q5iPy1pgfWVUP6BC1LBfSng6TxUfKZSilkDRfBpKNCkHxgwQOyBYKBqgwBEOgYHWBjRaR6QMsg4yaDBhhV9Fglw0w3BLAVHJeIQA */
  id: "attacheOrchestrator",
  initial: "start",
  context: {
    /** @type {AttacheState|null} */
    attacheState: createAttacheState({ phase: "start" }),
    /** @type {string[]} Resolved catalog ids for the outgoing prompt this turn (set by `ATTACHE_BEGIN_TURN`). */
    attachePromptInstructionIds: [],
  },
  states: {
    start: {
      description:
        "AttacheState.phase === \"start\". Children mirror first-turn return tier (visit bin / pending / stale dossier flag) vs later turns — `classifyAttacheFirstTurnReturnPrimary` + guarded `ATTACHE_BEGIN_TURN`.",
      tags: ["domain:start", "phase:start"],
      initial: "introFirstNoReturn",
      states: {
        introReentrySubsequent: {
          tags: ["intro:active", "startReentry:subsequent"],
          description:
            "Still on start, attache_turn_count ≥ 1: no ATTACHE_RETURN_* block; phase tier only (orientation + baseline delivery when applicable).",
          meta: {
            domainPhase: "start",
            domainNextPhases: ["explore", "baseline1", "close"],
            promptCatalog: {
              phaseTierTypical: ["ATTACHE_START_ORIENTATION", "ATTACHE_BASELINE_DELIVERY_START"],
            },
          },
        },
        introFirstNoReturn: {
          tags: ["intro:active", "startReentry:first", "returnPrimary:none"],
          description:
            "First attaché turn, no primary return row (e.g. brief bin). Phase tier only; append ids only when return tier non-empty.",
          meta: {
            domainPhase: "start",
            domainNextPhases: ["explore", "baseline1", "close"],
            promptCatalog: {
              phaseTierTypical: ["ATTACHE_START_ORIENTATION"],
              returnTierPrimary: [],
            },
          },
        },
        introFirstDayOrSo: {
          tags: ["intro:active", "startReentry:first", "returnPrimary:dayOrSo"],
          description:
            "First turn + ATTACHE_RETURN_DAY_OR_SO (+ one ATTACHE_RETURN_APPEND_*). Typical: visit_bin moderate or returnCategory.",
          meta: {
            domainPhase: "start",
            promptCatalog: {
              returnTierPrimary: ["ATTACHE_RETURN_DAY_OR_SO"],
              phaseTierTypical: ["ATTACHE_START_ORIENTATION"],
            },
          },
        },
        introFirstLongGone: {
          tags: ["intro:active", "startReentry:first", "returnPrimary:longGone"],
          description:
            "First turn + ATTACHE_RETURN_LONG_GONE (pending + long bin, or returnCategory).",
          meta: {
            domainPhase: "start",
            promptCatalog: {
              returnTierPrimary: ["ATTACHE_RETURN_LONG_GONE"],
              phaseTierTypical: ["ATTACHE_START_ORIENTATION"],
            },
          },
        },
        introFirstStaleVisit: {
          tags: ["intro:active", "startReentry:first", "returnPrimary:staleVisit"],
          description:
            "First turn + ATTACHE_RETURN_STALE_VISIT (pending + stale bin, or stale_dossier_rebaseline).",
          meta: {
            domainPhase: "start",
            promptCatalog: {
              returnTierPrimary: ["ATTACHE_RETURN_STALE_VISIT"],
              phaseTierTypical: ["ATTACHE_START_ORIENTATION"],
            },
          },
        },
      },
    },

    explore: {
      description: "Parent: AttacheState.phase === \"explore\".",
      tags: ["domain:explore"],
      initial: "exploring",
      states: {
        exploring: {
          tags: ["phase:explore"],
          description:
            "explore → ATTACHE_EXPLORE_GENERAL or ATTACHE_EXPLORE_RESUME_BASELINE + ATTACHE_BASELINE_DELIVERY_START",
          meta: {
            domainPhase: "explore",
            domainNextPhases: ["explore", "baseline1", "baseline2", "baseline3", "close"],
            promptCatalog: {
              whenResumingBaseline: ["ATTACHE_EXPLORE_RESUME_BASELINE", "ATTACHE_BASELINE_DELIVERY_START"],
              whenExploringFromStart: ["ATTACHE_EXPLORE_GENERAL", "ATTACHE_BASELINE_DELIVERY_START"],
            },
            note: "Resume target is potential_next_phase (interrupted baseline).",
          },
        },
      },
    },

    baseline: {
      description: "Parent: baseline block (phases 1–3).",
      tags: ["domain:baseline", "phase:baseline"],
      initial: "baseline1",
      states: {
        baseline1: {
          tags: ["baseline:1"],
          description:
            "baseline1 → ATTACHE_BASELINE_DELIVERY_START (question_index 0) or ATTACHE_BASELINE_MID_QUESTION (mid)",
          meta: {
            domainPhase: "baseline1",
            domainNextPhases: ["baseline1", "baseline2", "explore", "close"],
            promptCatalog: {
              firstQuestionInBlock: ["ATTACHE_BASELINE_DELIVERY_START"],
              midBlock: ["ATTACHE_BASELINE_MID_QUESTION"],
            },
          },
        },

        baseline2: {
          tags: ["baseline:2"],
          description:
            "baseline2 → ATTACHE_BASELINE_DELIVERY_START (question_index 0) or ATTACHE_BASELINE_MID_QUESTION (mid)",
          meta: {
            domainPhase: "baseline2",
            domainNextPhases: ["baseline2", "baseline3", "explore", "close"],
            promptCatalog: {
              firstQuestionInBlock: ["ATTACHE_BASELINE_DELIVERY_START"],
              midBlock: ["ATTACHE_BASELINE_MID_QUESTION"],
            },
          },
        },

        baseline3: {
          tags: ["baseline:3"],
          description:
            "baseline3 → ATTACHE_BASELINE_DELIVERY_START (question_index 0) or ATTACHE_BASELINE_MID_QUESTION (mid)",
          meta: {
            domainPhase: "baseline3",
            domainNextPhases: ["baseline3", "explore", "close"],
            promptCatalog: {
              firstQuestionInBlock: ["ATTACHE_BASELINE_DELIVERY_START"],
              midBlock: ["ATTACHE_BASELINE_MID_QUESTION"],
            },
          },
        },
      },
    },

    close: {
      description: "Parent: handoff / close toward detective.",
      tags: ["domain:close"],
      initial: "closing",
      states: {
        closing: {
          tags: ["phase:close"],
          description:
            "close → ATTACHE_CLOSE_EARLY_EXIT_CONFIRM | ATTACHE_CLOSE_FINAL | ATTACHE_CLOSE_DEFAULT (see phase_before_close, close_count, current_phase_id)",
          meta: {
            domainPhase: "close",
            domainNextPhases: ["close", "explore", "baseline1", "baseline2", "baseline3"],
            promptCatalog: {
              earlyExitFromBaselineNotFinal: ["ATTACHE_CLOSE_EARLY_EXIT_CONFIRM"],
              finalAfterBaseline3: ["ATTACHE_CLOSE_FINAL"],
              defaultClose: ["ATTACHE_CLOSE_DEFAULT"],
            },
            note: "Resume baseline uses phase_before_close + question_index_before_close when applicable.",
          },
        },
      },
    },
  },
  on: {
    ATTACHE_BEGIN_TURN: [
      {
        guard: "beginTurnRoutesStartSubsequent",
        target: ".start.introReentrySubsequent",
        actions: ["applyAttacheBeginTurn"],
      },
      {
        guard: "beginTurnRoutesStartFirstStaleVisit",
        target: ".start.introFirstStaleVisit",
        actions: ["applyAttacheBeginTurn"],
      },
      {
        guard: "beginTurnRoutesStartFirstLongGone",
        target: ".start.introFirstLongGone",
        actions: ["applyAttacheBeginTurn"],
      },
      {
        guard: "beginTurnRoutesStartFirstDayOrSo",
        target: ".start.introFirstDayOrSo",
        actions: ["applyAttacheBeginTurn"],
      },
      {
        guard: "beginTurnRoutesStartFirstNoReturn",
        target: ".start.introFirstNoReturn",
        actions: ["applyAttacheBeginTurn"],
      },
      { actions: ["applyAttacheBeginTurn"] },
    ],
    ATTACHE_TURN: {
      actions: ["applyAttacheTransition"],
    },
  },
  /**
   * Sync orchestrator to `context.attacheState.phase` after `ATTACHE_TURN`.
   * Do **not** auto-target `start.*` here — `ATTACHE_BEGIN_TURN` guards own return-tier substates.
   */
  always: [
    { guard: "phaseIsExplore", target: ".explore.exploring" },
    { guard: "phaseIsBaseline1", target: ".baseline.baseline1" },
    { guard: "phaseIsBaseline2", target: ".baseline.baseline2" },
    { guard: "phaseIsBaseline3", target: ".baseline.baseline3" },
    { guard: "phaseIsClose", target: ".close.closing" },
  ],
});

/** Pre–compound-state snapshots used a string `value` (e.g. `"intro"`). Maps to nested XState v5 value. */
const ATTACHE_ORCH_FLAT_VALUE_TO_COMPOUND = {
  intro: { start: "introFirstNoReturn" },
  exploring: { explore: "exploring" },
  baseline1: { baseline: "baseline1" },
  baseline2: { baseline: "baseline2" },
  baseline3: { baseline: "baseline3" },
  closing: { close: "closing" },
};

/**
 * Rewrite legacy `snapshot.value` so `createActor(attacheOrchestratorMachine, { snapshot })` accepts old persistence.
 *
 * @param {unknown} snapshot
 * @returns {unknown}
 */
function migrateAttacheOrchestratorMachineSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const rec = /** @type {Record<string, unknown>} */ (snapshot);
  const v = rec.value;
  if (typeof v === "string") {
    const compound = ATTACHE_ORCH_FLAT_VALUE_TO_COMPOUND[v];
    if (!compound) return snapshot;
    return { ...rec, value: compound };
  }
  if (v && typeof v === "object" && !Array.isArray(v) && /** @type {{ start?: string }} */ (v).start === "intro") {
    return { ...rec, value: { .../** @type {Record<string, unknown>} */ (v), start: "introFirstNoReturn" } };
  }
  return snapshot;
}

/**
 * Fix nested invoked child snapshot on a persisted `chatMachine` root (in-memory / disk).
 *
 * @param {unknown} persistedRoot
 * @returns {unknown}
 */
function migratePersistedChatSnapshotAttacheOrchestrator(persistedRoot) {
  if (!persistedRoot || typeof persistedRoot !== "object") return persistedRoot;
  const root = /** @type {Record<string, unknown>} */ (persistedRoot);
  const children = root.children;
  if (!children || typeof children !== "object") return persistedRoot;
  const ch = /** @type {Record<string, unknown>} */ (children);
  const orch = ch.attacheOrchestrator;
  if (!orch || typeof orch !== "object") return persistedRoot;
  const o = /** @type {Record<string, unknown>} */ (orch);
  const snap = o.snapshot;
  const migrated = migrateAttacheOrchestratorMachineSnapshot(snap);
  if (migrated === snap) return persistedRoot;
  return {
    ...root,
    children: {
      ...ch,
      attacheOrchestrator: { ...o, snapshot: migrated },
    },
  };
}

/**
 * @param {unknown} snapshot — persisted `attacheOrchestratorMachine` snapshot
 * @returns {string[]}
 */
function getAttachePromptInstructionIdsFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const ctx = /** @type {{ context?: { attachePromptInstructionIds?: unknown } }} */ (snapshot).context;
  if (!ctx || typeof ctx !== "object") return [];
  const ids = ctx.attachePromptInstructionIds;
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}

module.exports = {
  migrateAttacheOrchestratorMachineSnapshot,
  migratePersistedChatSnapshotAttacheOrchestrator,
  getAttachePromptInstructionIdsFromSnapshot,
  ATTACHE_MAX_TURNS,
  RANDOM_Q_ORDER,
  MIN_BASELINE1_QUESTIONS,
  MAX_BASELINE1_QUESTIONS,
  MIN_BASELINE2_QUESTIONS,
  MAX_BASELINE2_QUESTIONS,
  MIN_BASELINE3_QUESTIONS,
  MAX_BASELINE3_QUESTIONS,
  ATTACHE_DOMAIN_ONE_STEP_PHASES,
  isValidAttacheOneStepPhasePair,
  getRandomBaselineQuestionCount,
  getBaselineNumberFromPhase,
  createAttacheState,
  normalizeIntent,
  transition,
  computeCurrentPhaseId,
  attacheOrchestratorMachine,
};
