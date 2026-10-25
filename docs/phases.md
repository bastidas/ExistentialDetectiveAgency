# Phases: five separate things that are all called "phase"

The code and the plans use the word "phase" for several unrelated state values. They live in different places, are advanced by different parts of the system, and are read by different agents. Nothing converts one into another. This page maps each one so a change to one is not mistaken for a change to another.

Written from the code on the PR 13 branch. Function names are given instead of line numbers.

## At a glance

| Name used here | Values | What it is | Moved by | Stored as | Seen by the model as |
|----------------|--------|------------|----------|-----------|----------------------|
| Routing (active agent) | `attache`, `detective` (plus `baselineCompleted`) | Who answers the next message | The routing machine, on events | `chatMachineSnapshot` | `active_agent` and `agent_label` in the HTTP envelope only |
| Attaché phase | `start`, `explore`, `baseline1`, `baseline2`, `baseline3`, `close` | Where the intake interview is | The attaché's own output, through a pure transition function | `attacheSession.attacheState` | Prompt text and the baseline question for that phase |
| Therapy phase | `initial`, `middle`, `final` | Which stage of existential therapy the detective is in | The detective's suggestion, gated by server rules | `detectiveRuntime.orchestratorSnapshot` | `existential_therapy_phase` in the detective packet |
| Story phase | `Exposition`, `Rising Action`, `Climax`, `Falling Action`, `Denouement`, `Coda` | Where Lumen and Umbra are in the Agency's story | The server (`chatService`), not an agent | `currentStoryPhase` | `narrative_phase` in the Lumen and Umbra packets |
| Closure phase | `penultimate`, `ultimate`, none | Last two exchanges of the session | Derived from counters; nothing stored | Nowhere | `closure_phase` in the detective packet |

Also not phases, but easy to confuse with them: the time-away bin (`visit_bin`: brief, moderate, long, stale), the thread-event `phase` field (`baseline` or `detective`), and the `current_phase_id` catalog id.

## 1. Routing (which agent is active)

- **Purpose:** decides whether the attaché or the detective answers. Not a phase of the conversation, but the HTTP envelope and the thread log both call parts of it "baseline" and "detective".
- **Controlled by:** `chatMachine` (`api/orchestration/chatMachine.js`). It moves to the detective on `ATTACHE_HANDOFF_TO_DETECTIVE` (sent by `notifyAttachePreludeComplete` when the attaché's turn ends the prelude) or `DOSSIER_LOADED` (the user already has a dossier). A long absence sends the session back to the attaché (`clearSessionForAttacheRebaseline`, or `forceAttacheForLongAbsence` in `runChatTurn` (`chatMachine.js`)).
- **Stored:** `chatMachineSnapshot` in the checkpoint (`persistedSnapshotBySessionId` in memory); `baselineCompleted` and `detectiveIntroSent` flags on the session row.
- **Read by:** `composeChatResponse` (which branch runs); `getChatEnvelopeForSession` (the `active_agent`, `baseline_completed` and `agent_label` fields of the response); `saveSessionCheckpointToDurable` (the two flags).
- **Thread log:** each event carries `phase: "baseline"` (the attaché's reply, and the user's message in an attaché turn) or `"detective"` (the detective's, Lumen's and Umbra's replies, and the user's message in a detective turn). `rebuildPhilosopherHistory` keeps only the `detective` events. This field is a routing label, not the attaché phase.

## 2. Attaché phase

- **Purpose:** position inside the intake interview: `start`, optional `explore` detours, three baseline blocks with a question index each, then `close`. Also carries `baseline_number`, `question_index`, `n_questions_in_baseline`, `potential_next_phase`, `previous_phase`, `phase_before_close` and `question_index_before_close`.
- **Controlled by:** the attaché. Each turn its structured output (`user_intends_explore`, `user_intends_close`, `asked_baseline_question`) is reduced to an intent by `normalizeIntent`, and the pure function `transition()` in `api/agents/attache/attacheMachine.js` computes the next state inside `runAttacheTurn` (`attacheRuntime.js`). The server never moves it except in the lab. The prelude ends when the final baseline closes (`close_from_final_baseline3`), after two close intents (one when it is a re-baseline), or at `ATTACHE_MAX_TURNS` (100).
- **Stored:** `attacheSession.attacheState` is the authoritative copy (in `attacheSessionByChatSessionId`). It is mirrored in `attacheSession.attacheOrchestratorSnapshot`, which `advanceAttacheOrchestratorSnapshot` realigns to it each turn. Both are in the checkpoint.
- **Read by:** `attacheRuntime` (which question to ask, the phase prompt text), `attachePromptContext`, `attachePromptPolicy` (catalog ids), the mock fallback in `composeChatResponse`, the lab snapshot.
- **Derived:** `current_phase_id` (from `computeCurrentPhaseId`) is the prompt-catalog id for the phase, not a separate phase.
- **Reset:** a fresh `createInitialAttacheSessionState` on re-baseline.

## 3. Therapy phase (existential therapy phase)

- **Purpose:** how deeply the detective works: `initial`, `middle`, `final`. It selects the stage text (`getExistentialTherapyPhaseMarkdown`) and heading in the detective prompt. The detective's own words are the input; the stage is a stance.
- **Controlled by:** the detective proposes, the server decides. Every successful detective turn returns `suggest_existential_phase`. `applyExistentialPhaseSuggestionAfterDetectiveTurn` (`detectiveExistentialSession.js`) applies it only when the same suggestion arrives on two consecutive turns, it is one step from the current phase, `middle` has a dossier, and `final` has a dossier old enough (`isDossierCreatedAtStaleEnoughForFinal`). A suggestion equal to the current phase clears the streak.
- **Stored:** `detectiveOrchestratorSnapshotBySessionId` (context `existentialTherapyPhase`, `instructionIds`, `ready`, `lastMockReply`) and `phaseSuggestionStreakBySessionId` (`lastSuggested`, `runLength`). Both are in the checkpoint under `detectiveRuntime`.
- **Read by:** `getExistentialTherapyPhaseForSession`, called by `composeChatResponse` to build `existential_therapy_phase` in the detective session payload; then `detectivePrompts.js` (stage markdown, heading), `detectiveCall.js` (default for a missing suggestion), the lab snapshot. It is in the detective `SAFE_VIEW_KEYS`.
- **Reset:** `resetDetectiveExistentialPhaseForAttacheHandoff` clears it (back to `initial`). The code calls it from `clearSessionForAttacheRebaseline`. Its comment says it should also run when the attaché prelude completes; it does not, which is harmless only because no snapshot exists yet at the first handoff.

## 4. Story phase (narrative phase)

- **Purpose:** the arc Lumen and Umbra are telling (`Exposition` through `Coda`, repeating). It colors their replies. It has nothing to do with therapy stages.
- **Controlled by:** not by an agent. `chatService` owns it. The stored value is `narrativeTurn` in the `philosophersNarrativeMachine` context, and `narrativePhaseFromTurn` (`api/narrativePhases.js`) maps it to a label (`turn mod 6`). The chat path advances it with `advanceCurrentStoryPhase` at the end of each detective turn, unconditionally. Lumen and Umbra only read it; neither can change it. The lab can set it directly (`setCurrentStoryPhaseTurnForLabSession`) or step it (`CURRENT_STORY_PHASE_ADVANCE`).
- **Stored:** `currentStoryPhaseBySessionId` (an XState snapshot). In the checkpoint as `currentStoryPhase`. Not in the thread log.
- **Read by:** `buildPhilosopherComposeSession` (via `getStoryTurnFromCurrentStoryPhase`) to build `narrative_phase` for the Lumen and Umbra packets; `exportSessionRuntimeForDurable`; `getCurrentStoryPhaseForSession` for the lab view. The detective and attaché never read it.
- **Reset:** deleted on re-baseline (`clearSessionForAttacheRebaseline`).
- **Names to keep straight:** the stored thing is `currentStoryPhase`; the label the model sees is `narrative_phase`; the counter inside is `narrativeTurn`; the machine is `philosophersNarrativeMachine`. Older plans call all of these "narrative".

## 5. Closure phase

- **Purpose:** tells the detective that the session is about to end. `penultimate` on the exchange before the cap, `ultimate` on the last one. On `ultimate` the therapy stage text is omitted so the model signs off.
- **Controlled by:** the server's exchange counters. `detectiveClosurePhaseFromExchangeSum(sumBefore, maxEx)` compares the attaché plus detective exchange count with `MAX_USER_EXCHANGES`.
- **Stored:** nowhere; recomputed each detective turn from `attacheExchangeCount` and `detectiveTurnCount` (both checkpointed).
- **Read by:** `composeChatResponse` (sets `closure_phase` in the payload, passes it to `runDetectivePromptPolicyTurn`, and sets `closureUltimate`), `detectivePrompts.js`, the detective packet.

## How they relate

- They are independent. No phase is computed from another. The only coupling is a reset: re-baselining restarts the attaché phase, clears the therapy phase and deletes the story phase together.
- The therapy phase and the attaché phase are advanced by the agent whose name they carry (the detective suggests, the attaché's output drives a pure transition). The story phase is not advanced by Lumen, Umbra or the detective; the server does it.
- The lab seeds all three (`attachePhase`, `existentialTherapyPhase`, `narrativePhase` in a scenario preset) and has a separate step for each: `ATTACHE_ADVANCE_QUESTION_INDEX`, `DETECTIVE_PHASE_ADVANCE`, `CURRENT_STORY_PHASE_ADVANCE`.
- The bare word `phase` means the attaché phase in the attaché packet (`phase`), the routing label in thread events, and the lab's `phase` options. `existential_therapy_phase` and `narrative_phase` are always the other two.

## Checkpoint and recovery summary

| Phase | In the checkpoint | Rebuildable from the log | Lost on restart without a checkpoint |
|-------|-------------------|--------------------------|--------------------------------------|
| Routing | `chatMachineSnapshot`, `baselineCompleted`, `detectiveIntroSent` | Partly (`phase` on events shows who answered) | Routing resets to the attaché |
| Attaché phase | `attacheSession` | No | Restarts at `start` |
| Therapy phase | `detectiveRuntime` | No | Back to `initial`, streak lost |
| Story phase | `currentStoryPhase` | Could be (it counts detective turns) but is not | Back to `Exposition` |
| Closure phase | n/a (derived) | n/a | Recomputed from the restored counters |

A checkpoint can trail the log by up to `SESSION_CHECKPOINT_EVERY_K_TURNS - 1` turns, so each stored phase can be that many turns behind after a restart.

## Open questions this map raises (not decided)

- Whether the story phase should keep advancing automatically each detective turn, or only when some agent or rule decides. Today it is automatic and belongs to `chatService`. No advancement logic was changed while writing this page.
- If an agent should own it, which one: the detective (as with the therapy phase) or an orchestrator rule. The two existing patterns are "agent proposes, server gates" (therapy phase) and "agent output drives a pure transition" (attaché phase).
- Whether `currentStoryPhase` should be rebuilt from the log instead of stored.
