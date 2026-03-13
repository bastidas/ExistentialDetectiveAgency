# Attaché instructions (contract and system-role construction)

Aligned with the Orchestrator + Attaché architecture plan: the attaché is called **once per user turn** with the inputs below and returns structured output. The **callAttache wrapper** builds the LLM system/developer role by concatenating:

1. **attache_persona** – Role and constraints (e.g. attaché for the existential detective).
2. **attache_instructions** – This document: contract and behavior rules.
3. **additional_instructions** – The **phase_instructions** for the **current** phase (rules for this turn: start, explore, administerBaseline1/2/3, or close).

When **next_phase_instructions** is non-null, the wrapper should also pass it (e.g. as a separate section or line) so the attaché knows: *if the user’s message indicates a transition, use next_phase_instructions (and question_at_hand when transitioning into a baseline phase) to produce the transition reply in one go* (e.g. state next phase rule and present the one question, or deliver the closing line). So the wrapper needs **both** current-phase rules (phase_instructions) and, when set, next_phase_instructions for transition replies.

---

## Inputs (every turn)

The orchestrator passes these to the attaché (and the wrapper can inject phase_instructions and next_phase_instructions into the system role; the rest are typically in the user/turn message or context):

| Input | Type | Description |
| ----- | ---- | ----------- |
| `chat_history` | list of messages | Full conversation so far. |
| `question_at_hand` | string or null | The question to present/ask **this turn**. Null in start/close. When next_phase_instructions is a baseline phase, the orchestrator passes that phase’s **first question** here. |
| `phase_instructions` | string | Rule/instruction text for the **current** phase (e.g. “Answer naturally.”). Use for additional_instructions in the system role. |
| `is_phase_start` | boolean | True when this turn is the first in the current baseline phase; attaché should state the phase rule then present the question. |
| `next_phase_instructions` | string or null | When set, a single likely next phase so the attaché can produce the transition reply in one call (phase intro + question, or closing line). Include in the system role when non-null. |

---

## Output (structured, e.g. JSON)

| Output | Type | Description |
| ------ | ---- | ----------- |
| `user_response` | string | The attaché’s reply to the user (what the user sees). |
| `user_intends_explore` | boolean | User is asking about the system / wants to explore; orchestrator will not advance question index and will keep same phase and question_at_hand on next turn. |
| `user_intends_close` | boolean | User wants to end the baseline/session; orchestrator will move to close (possibly after confirmation). |

---

## Behavior by phase (summary)

- **Start:** Greet and ask what the user wants (proceed to baseline, explore, or close). No question to display.
- **Explore:** Answer the user’s questions; when they indicate ready for baseline or close, set the corresponding intent flag. Use the same phase_instructions and question_at_hand as provided (orchestrator does not advance).
- **Baseline phases:** When `is_phase_start` is true, state the phase rule from phase_instructions then present question_at_hand. Otherwise present question_at_hand or handle explore/close; set intent flags accordingly.
- **Transition (next_phase_instructions):** When next_phase_instructions is set and the user’s message indicates a transition (e.g. “ready for baseline”, “I’m sure, end it”), use it (and question_at_hand when transitioning into a baseline phase) to generate the reply in one go (phase intro + present the one question, or closing line).
- **Close:** Ask for confirmation. If the user confirms, deliver the closing line. If they want to explore or go back, set the appropriate intent so the orchestrator can restore the previous phase and question_at_hand.
