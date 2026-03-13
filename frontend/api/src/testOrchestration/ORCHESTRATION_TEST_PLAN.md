# Orchestration Test Plan – Mapping to Architecture

This document maps each test in `orchestrator.test.js` to sections of the Orchestrator + Attaché architecture plan (`orchestrator_attaché_architecture_2e554bef.plan.md`).

## Contract tests (Attaché I/O and state shape)

| Test | Architecture ref | Assertion |
|------|------------------|-----------|
| Attaché called once per user turn | §1, §5 step 3 | For a short scripted conversation, number of attaché invocations = number of user messages. |
| Attaché input shape | §4 Input table | Each call includes: chat_history (array), question_at_hand (string or null), phase_instructions (string), is_phase_start (boolean), next_phase_instructions (string or null). |
| Attaché output shape | §4 Output table | Each response has: user_response (string), user_intends_explore (boolean), user_intends_close (boolean). |
| Session state shape | §3 | After any turn, state has: phase, question_index (when in baseline), phase_questions or per-phase lists, chat_history; optional: baseline_phase_when_exploring, phase_before_close, question_index_before_close. |
| question_at_hand semantics | §4, §11 state notes | When transitioning into a baseline phase, question_at_hand passed to attaché is the first question of that phase (question to ask), not the previous phase’s last question. |

## Phase and transition tests

| Test | Architecture ref | Assertion |
|------|------------------|-----------|
| Valid phases | §2 | phase is one of: start, explore, administerBaseline1, administerBaseline2, administerBaseline3, close. |
| start → explore | §2, §9 | User says “explore”; phase becomes explore; question_index not incremented. |
| start → administerBaseline1 | §2, §12 | User says “do baseline”; phase becomes administerBaseline1; question_index=0; question_at_hand = first of phase 1. |
| start → close | §2, §13 | User says “skip test”; phase becomes close; phase_before_close and question_index_before_close stored. |
| explore → administerBaseline1 (from start) | §9 | From explore (from start), user says “ready”; phase becomes administerBaseline1; question_at_hand = first Q of phase 1; next_phase_instructions was (administerBaseline1). |
| Same question in explore | §5, §8 | While in explore, mock returns user_intends_explore=true; next turn same phase, same question_at_hand, question_index unchanged. |
| Baseline phase advance | §2, §5 | In administerBaselineN, mock returns no explore/close; question_index increments; when index >= length(phase_questions), transition to next phase or close. |
| question_at_hand on phase transition | §11 | After last Q of phase 2, user says “move on”; phase becomes administerBaseline3; question_at_hand = first Q of phase 3. |
| administerBaseline2 → close → explore → administerBaseline2 | §10 | Close from phase 2; user “has a question”; then “continue”; phase returns to administerBaseline2 with same question_at_hand. |
| Close cancel | §2, §5 | In close, user says “no”/“go back”; phase restores to phase_before_close, question_index restored. |

## Mock-chat scenario tests (end-to-end)

| Scenario | Architecture ref | Flow |
|----------|------------------|------|
| Explore at start, then phase 1 | §9 | Hi → “learn more first” → “What is this place?” → “ready for the questions.” → phase progression and question_at_hand = first Q of phase 1. |
| Explore from close, then return to phase 2 | §10 | (in phase 2) “end baseline” → “Actually I have a question” → “What’s the point?” → “Okay, let’s continue.” → phase_before_close and same question_at_hand after continue. |
| End of phase 2, “let’s move on” | §11 | One turn from end-of-phase-2 state; phase becomes administerBaseline3; question_at_hand = first Q of phase 3. |
| Direct to baseline | §12 | “Hi” → “Let’s do the baseline.” → start → administerBaseline1 with question_at_hand and next_phase_instructions set. |
| Skip test, ask in close, confirm end | §13 | “skip test” → “What happens if I leave?” → “Okay, I’m sure. End it.” → start → close → explore from close → close/end. |
