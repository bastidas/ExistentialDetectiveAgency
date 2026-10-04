# Attaché Orchestrator – Simplified Architecture

This document outlines a radically simpler attaché orchestrator that lives entirely under `src/attache`.

## 1. High-Level Pieces

To keep the orchestrator small and testable, separate it into:

1. **State model**
   - Shape of the state object the orchestrator reads/writes.
2. **Intent normalization**
   - Map raw LLM outputs (`user_intends_explore`, `user_intends_close`) into a small intent set.
3. **Transition function**
   - Pure function `nextState = transition(state, intent)` that updates phase and indices.
4. **Prompt composer**
   - Function `getSystemPrompt(state)` that turns a state into the correct system prompt.
5. **Scenario harness**
   - Use `SCENARIOS` from `attacheScenarios.js` only as fixtures: initial states and labels for tests/docs.

## 2. State Model (What Fully Defines a State)

A minimal, self-contained state for the new orchestrator could be:

```js
{
  // Core phase
  phase: "start" | "explore" | "baseline1" | "baseline2" | "baseline3" | "close",

  // Baseline position
  baseline_number: 1 | 2 | 3 | null,        // or derive from phase
  question_index: number,                   // >= 0: current (or next) baseline question index
  n_questions_in_baseline: number,          // how many questions this baseline has

  // Forward-looking hint: where we go if user says "continue baseline"
  potential_next_phase:
    | "baseline1"
    | "baseline2"
    | "baseline3"
    | "close"
    | null,

  // Backward context for close/explore prompts (optional but useful)
  phase_before_close: "start" | "baseline1" | "baseline2" | "baseline3" | null,
  question_index_before_close: number | null,

  // Optional derived / UX fields (not required by engine but handy for prompts/docs)
  // e.g. "baseline2_from_mid_baseline2", "close_from_start", etc.
  current_phase_id: string | null,
}
```

Recommendations:

- **Derive `baseline_number` from `phase`** when possible (e.g. `phase === "baseline2" → baseline_number = 2`) instead of storing both.
- **Keep `potential_next_phase` as an engine field**, not just a documentation label. It should always reflect where a normal "baseline" continuation would send the user from the current state.
- **Use `phase_before_close` + `question_index_before_close`** only when `phase === "close"` and you actually came from a baseline or start.

## 3. Intent Normalization

Raw LLM output will likely give you two booleans per turn: `user_intends_explore`, `user_intends_close`.

Normalize this to a single intent:

```js
function normalizeIntent({ user_intends_explore, user_intends_close }) {
  if (user_intends_explore) return "explore";
  if (user_intends_close) return "close";
  return "baseline"; // default when neither flag is set
}
```

This gives you a clean `intent` value in:

```js
// intent: "explore" | "close" | "baseline"
const intent = normalizeIntent(llmOutput);
const nextState = transition(currentState, intent);
```

## 4. Transition Function (How to Define Transitions)

Define a *single pure function* that takes the current state and a normalized intent and returns a new state.

```js
function transition(state, intent) {
  const { phase, question_index, n_questions_in_baseline, potential_next_phase } = state;

  // Clone to avoid mutation
  let next = { ...state };

  if (phase === "start") {
    if (intent === "explore") {
      next.phase = "explore";
      next.potential_next_phase = "baseline1";
      next.question_index = 0;
      return next;
    }
    if (intent === "close") {
      next.phase = "close";
      next.potential_next_phase = "start";
      next.phase_before_close = "start";
      next.question_index_before_close = 0;
      return next;
    }
    // intent === "baseline" (default)
    next.phase = "baseline1";
    next.question_index = 0;
    next.potential_next_phase = "baseline2"; // or "close" if only one baseline
    return next;
  }

  if (phase.startsWith("baseline")) {
    const currentBaseline = phase; // e.g. "baseline2"

    if (intent === "explore") {
      next.phase = "explore";
      next.potential_next_phase = currentBaseline;
      return next;
    }

    if (intent === "close") {
      next.phase = "close";
      next.phase_before_close = currentBaseline;
      next.question_index_before_close = question_index;
      next.potential_next_phase = currentBaseline;
      return next;
    }

    // intent === "baseline" (continue baseline)
    const nextIndex = question_index + 1;
    if (nextIndex < n_questions_in_baseline) {
      next.phase = currentBaseline;
      next.question_index = nextIndex;
      next.potential_next_phase = currentBaseline;
      return next;
    }

    // baseline finished: move to next baseline or close
    if (currentBaseline === "baseline1") {
      next.phase = "baseline2";
      next.question_index = 0;
      next.potential_next_phase = "baseline3"; // or "close" if only 2 baselines
      return next;
    }
    if (currentBaseline === "baseline2") {
      next.phase = "baseline3";
      next.question_index = 0;
      next.potential_next_phase = "close";
      return next;
    }

    // baseline3 finished → close
    next.phase = "close";
    next.phase_before_close = "baseline3";
    next.question_index_before_close = question_index;
    next.potential_next_phase = "close";
    return next;
  }

  if (phase === "explore") {
    if (intent === "explore") {
      // Stay in explore, keep potential_next_phase as-is
      return next;
    }
    if (intent === "close") {
      next.phase = "close";
      next.phase_before_close = potential_next_phase || "start";
      next.question_index_before_close = question_index;
      return next;
    }
    // intent === "baseline": resume baseline or start first baseline
    if (potential_next_phase && potential_next_phase.startsWith("baseline")) {
      next.phase = potential_next_phase;
      // question_index is whatever we paused at
      return next;
    }
    next.phase = "baseline1";
    next.question_index = 0;
    next.potential_next_phase = "baseline2";
    return next;
  }

  if (phase === "close") {
    if (intent === "explore") {
      next.phase = "explore";
      // Explore from close: optionally allow returning to previous baseline
      return next;
    }
    if (intent === "close") {
      // Stay closed; caller can interpret this as session end
      return next;
    }
    // intent === "baseline": optionally allow returning to previous baseline
    if (next.phase_before_close && next.phase_before_close.startsWith("baseline")) {
      next.phase = next.phase_before_close;
      next.question_index = next.question_index_before_close ?? 0;
      return next;
    }
    return next;
  }

  // Fallback: unknown phase → return state unchanged
  return next;
}
```

Recommendations:

- **Keep `transition` pure**: do not read files, call LLMs, or mutate global state inside it.
- **Keep phases small and explicit**: only `start`, `explore`, `baseline1/2/3`, `close`.
- **Use `potential_next_phase` consistently** as the single hint the explorer/close logic relies on for where to go when user says "continue baseline".

## 5. Prompt Composition (getSystemPrompt)

`getSystemPrompt(state)` should:

1. Inspect `state.phase` (and optionally `current_phase_id`).
2. Pull in the appropriate instruction fragments.
3. Return a single system prompt string for this turn.

Skeleton:

```js
function getSystemPrompt(state) {
  const { phase, potential_next_phase, question_index } = state;

  if (phase === "start") {
    return "{start_instructions} {start_baseline1_instructions}";
  }

  if (phase === "explore") {
    // You can use potential_next_phase and question_index to mention where we can resume
    return "{explore_instructions} {resume_baseline_hint_if_any}";
  }

  if (phase.startsWith("baseline")) {
    // e.g. "baseline2"
    return `You are currently in ${phase}. You can continue with the baseline or close it.`;
  }

  if (phase === "close") {
    // Optionally vary text based on phase_before_close
    return "{close_instructions}";
  }

  return "{fallback_instructions}";
}
```

Recommendations:

- **Keep prompt composition separate from transitions** so you can test logic without LLM details.
- **Use `current_phase_id` (like `explore_from_mid_baseline2`)** for narrative-only aspects, but don’t let it drive core logic.

## 6. Role of SCENARIOS and the Scenario Matrix

`attacheScenarios.js` and `scenarioMatrix.js` should be treated as *dev tooling*:

- **SCENARIOS**: canonical examples of initial states for each interesting situation (`start_from_null`, `explore_from_mid_baseline2`, `close_from_baseline1`, etc.).
- **Scenario matrix markdown**: snapshot of these scenarios for human review.

Recommendations:

- Use SCENARIOS in tests:
  - For each scenario, call `initState()` → `state`.
  - Run `transition(state, intent)` and/or `getSystemPrompt(state)`.
  - Assert that the outputs match expected next phases and prompts.
- Keep SCENARIOS **aligned with the real state model** (field names and phase names) to avoid drift between docs and engine behavior.

---

**Next steps**

1. Implement the `normalizeIntent` helper.
2. Implement the `transition(state, intent)` function (in `attacheOrchestrator.js`) following the rules above.
3. Adjust `attacheScenarios.js` so its `phase` and `potential_next_phase` values use the same phase names as the new orchestrator (e.g. `baseline1`, `baseline2`, `baseline3`).
4. Wire `getSystemPrompt(state)` to real instruction fragments (start, explore, baselineN intro/mid, close).
5. Add a small test harness that:
   - Iterates over `SCENARIOS`.
   - Logs/inspects `state`, `getSystemPrompt(state)`, and `transition(state, "baseline"/"explore"/"close")`.
   - Ensures the finite state machine behaves as intended before hooking it up to the live attaché call.
