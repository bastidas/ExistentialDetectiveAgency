# Orchestration Verification Tests

These tests encode the **Orchestrator + Attaché** architecture (see plan `orchestrator_attaché_architecture_2e554bef.plan.md`). When all tests in this directory pass, the architecture has been implemented successfully.

## Purpose

- **Contract tests** – Attaché I/O shape, session state shape, one attaché call per user turn, `question_at_hand` semantics.
- **Transition tests** – Phase set and transitions (start → explore/baseline/close, explore → baseline, close cancel, explore from close, etc.).
- **Scenario tests** – End-to-end flows from the architecture doc (§9–§13): explore at start then phase 1, explore from close then return to phase 2, “let’s move on” to phase 3, direct to baseline, skip test then confirm end.

Tests use a **deterministic mock attaché** (`mockAttache.js`); no LLM is required.

## How to run

From the `frontend/api` directory:

```bash
node src/testOrchestration/orchestrator.test.js
```

Or from the repo root:

```bash
node frontend/api/src/testOrchestration/orchestrator.test.js
```

The test file requires `../baselineOrchestrator` (i.e. `src/baselineOrchestrator.js`). If that module is missing, the script exits with a message and skips tests. A reference implementation is provided in `baselineOrchestrator.js` so that all tests run and pass; you can replace or refine it. When all tests pass, the orchestrator + attaché architecture has been implemented successfully.

## Standalone CLI

To drive the orchestrator interactively in the terminal (no server, no browser):

From **frontend/api**:
```bash
node src/testOrchestration/orchestratorCli.js
```

From **frontend/api/src/testOrchestration**:
```bash
node orchestratorCli.js
```

Use `RANDOM_Q_ORDER=FALSE` for deterministic question order (first N questions from each bank):
```bash
RANDOM_Q_ORDER=FALSE node src/testOrchestration/orchestratorCli.js
```

Type a message and press Enter to see the attaché reply and current state. The CLI uses a heuristic mock attaché (keyword-based intents). Try: `Hi`, `I'd like to learn more first`, `Let's do the baseline`, `I want to end the baseline`, or `exit` to quit.


Heuristic mock attaché: No script; intents are derived from the current user message:
- explore: e.g. “explore”, “learn”, “what is”, “tell me”, “more first” → user_intends_explore: true
- close: e.g. “close”, “end”, “skip”, “stop”, or “yes”/“sure” when in close → user_intends_close: true
- cancel close / explore from close: “no”, “wait”, “go back” or “actually”, “have a question” in close → appropriate intents
- ready / baseline: “ready”, “continue”, “baseline”, “let’s do”, “start” → both intents false, reply with phase + first question when available
- greeting: “hi”, “hello”, “hey” → greeting and options
- answer: If there’s a question_at_hand and no other rule matches → “Noted. Next.”