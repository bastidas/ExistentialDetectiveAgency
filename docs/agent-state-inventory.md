# Agent state inventory: what is checkpointed and what is only in memory

This lists every piece of state the server keeps for the four agents (detective, attaché, Lumen, Umbra) and says, for each one, whether it is in the durable checkpoint, rebuilt from the chat log, or lost on restart. It is meant for reasoning about checkpoint contents and recovery. Every field below was read from the code (file named in each section) and the sizes were measured by driving a fake-OpenAI session through `api/shared.js`, not guessed.

Read it with [`durable-user-state.md`](durable-user-state.md) (tables, retention).

## Where state lives

| Store | Key | What it holds | Written |
|-------|-----|---------------|---------|
| Session row (the checkpoint) | partition `EDA_session`, row `sessionId` | flags, counters, orchestration blob (`orchestrationRuntimeJson`) | first turn, then every `SESSION_CHECKPOINT_EVERY_K_TURNS` turns or `SESSION_CHECKPOINT_MIN_INTERVAL_MS`; a failed write is retried next turn |
| Thread rows (the chat log) | partition `EDA_thread_<encoded sessionId>`, row `seq` (8 digits) | one row per exchange: `eventsJson` = user message plus every agent reply | every turn |
| Dossier row | partition `EDA_dossier`, row `userId` | the per-user dossier (`dossierJson`) | at the dossier interval; shared by all agents, not owned by one |
| Process memory | `Map`s keyed by `sessionId` | everything else | n/a |

Chunking: a string larger than 30,000 characters is split across `name`, `name__1`, `name__2`, ... with the count in `<name>Chunks`. The orchestration blob is capped at 300,000 characters and the whole session row at 400,000 characters (Azure counts 2 bytes per character, so 1 MiB is about 524,000 characters). Over budget the blob is not persisted (`orchestration_not_persisted`); nothing inside it is trimmed. The blob no longer holds the detective history, so it is small.

## The session row (checkpoint envelope)

Source: `saveSessionCheckpoint` in `api/storage/durableTableStorage.js`, payload built in `saveSessionCheckpointToDurable` in `api/shared.js`.

| Property | Type | Size / bound | Purpose |
|----------|------|--------------|---------|
| `schemaV` | number | 1 value (`2`) | Row layout version |
| `updatedAt` | ISO string | 24 chars | When the checkpoint was written. On hydrate it, with the newest log row's `ts`, seeds `lastActivityAtBySession`, so time-away after a restart is real |
| `userId` | string | about 36 chars, `""` if unknown | Links the session to the user's dossier |
| `sessionSeq` | number | 1 to 40 typically | Number of exchanges logged; thread rows run `1..sessionSeq` |
| `baselineCompleted` | boolean | 1 | Attaché finished, routing is detective. On hydrate, when no routing snapshot could be restored from the blob, routing is rebuilt as detective |
| `detectiveIntroSent` | boolean | 1 | The detective has spoken (`detectiveTurnCount > 0`). On hydrate it floors the detective turn count at 1 so the detective does not open twice, and `/api/chat-state` reports it |
| `detectiveHistoryText` | chunked string | at most 60,000 chars | The detective transcript, one `role<TAB>JSON string` line per message. The only stored copy of the detective history (the blob no longer has one); it becomes the in-memory history on hydrate. Holds the newest `max(HISTORY_TAIL_TURNS, LAST_N_MESSAGES_FOR_DOSSIER)` = 12 messages, cut on whole lines, 60,000 chars at most |
| `conversationSummariesJson` | chunked string | `"null"` (4 chars) until a summary exists, then a record of at most about 6,200 chars | `{ v, userId, sessionId, fromSeq, throughSeq, text, createdAt }`: a summary of log exchanges `fromSeq..throughSeq`. Read on hydrate and published as `preceding_conversation_summary` (see `durable-user-state.md`) |
| `degradedReason` | string | 0 to about 100 chars | `;`-joined reasons if the write had to drop content. Read on hydrate and surfaced in durable health |
| `orchestrationRuntimeJson` | chunked string | measured below | The orchestration blob, next section |

## The orchestration blob

Source: `exportSessionRuntimeForDurable` in `api/chatService.js`, version constant `ORCHESTRATION_RUNTIME_V = 2`. A blob with another `v`, or one marked `truncated`, is ignored on restore (the session then starts clean for orchestration state, and the log still restores the chat).

| Field | Type | Bound / measured size | Owner | Purpose |
|-------|------|-----------------------|-------|---------|
| `v` | number | 1 char | all | Blob version |
| `chatMachineSnapshot` | XState persisted snapshot | about 670 chars | routing (attaché and detective) | Which agent is active, time-away bin, dossier presence, turn counter, plus the invoked child snapshot |
| `attacheSession` | object | 3.8K chars at 12 turns, grows 200 to 1,000 chars per attaché turn, **not trimmed** | attaché | Full attaché runtime state (fields below) |
| ~~`detectiveChatHistory`~~ | removed from the blob | n/a | detective | Now only in the row's `detectiveHistoryText`. An old blob that still has it is read as a fallback |
| `currentStoryPhase` | XState persisted snapshot | about 100 chars | Lumen and Umbra | Narrative turn, which sets their narrative phase |
| `detectiveTurnCount` | number | 1 to 2 chars | detective | Detective turns run (first-turn instructions, dossier interval, closure) |
| `attacheExchangeCount` | number | 1 to 2 chars | attaché | User messages handled while routed to attaché; adds to detective count for `MAX_USER_EXCHANGES` |
| `detectiveRuntime` | object | about 250 chars | detective | `{ orchestratorSnapshot, phaseSuggestionStreak }`, below |
| `historyRef` | `{sessionId, fromSeq, toSeq}` | about 75 chars | Lumen and Umbra | Points at the thread rows the philosopher histories are rebuilt from. Added at write time in `shared.js`, not by the exporter |

Not in the blob: `lumenChatHistory` and `umbraChatHistory`. They are rebuilt from the thread rows on hydrate, and a blob that still contains them is not read for them (`restoreSessionRuntimeFromDurable` ignores those keys; the test `a stored blob that still carries philosopher histories does not supply them` covers it).

## Detective agent

Sources: `api/chatService.js`, `api/agents/detective/detectiveExistentialSession.js`, `api/agents/detective/detectiveMachine.js`.

| # | Field | Type | Bound / size | Purpose | Checkpoint? |
|---|-------|------|--------------|---------|-------------|
| 1 | `detectiveChatHistoryBySessionId` | `{role, content}[]` | exported tail of 120; in memory unbounded (2 per turn, so at most `MAX_USER_EXCHANGES` x 2) | Alternating user and detective messages sent as LLM history | Yes, but in the row's `detectiveHistoryText` (newest 12 messages), not in the blob. Not rebuilt from the log: mock and fallback replies are logged but never enter this history |
| 2 | `detectiveTurnCountByChatSessionId` | number | small int | Turn count | Yes, `detectiveTurnCount` |
| 3 | `detectiveOrchestratorSnapshotBySessionId` | XState snapshot of `detectiveMachine` | about 190 chars | Holds the four context fields below | Yes, `detectiveRuntime.orchestratorSnapshot` |
| 3a | context `ready` | boolean | 1 | Machine seeded | Yes (inside 3) |
| 3b | context `lastMockReply` | string | usually `""`, mock replies only | Last offline reply | Yes (inside 3) |
| 3c | context `existentialTherapyPhase` | `initial` or `middle` or `final` | 7 to 9 chars | Therapy phase driving prompt content; moves one step at a time | Yes (inside 3) |
| 3d | context `instructionIds` | string[] | about 1 to 5 ids, 25 to 150 chars | Prompt catalog ids chosen by the last policy turn | Yes (inside 3) |
| 4 | `phaseSuggestionStreakBySessionId` | `{ lastSuggested: string or null, runLength: number }` | about 40 chars | Two matching `suggest_existential_phase` answers in a row are needed to change phase | Yes, `detectiveRuntime.phaseSuggestionStreak` (null until first suggestion) |
| 5 | dossier (`dossierBySessionId`) | object (`explicit`, `inferred`, `meta`, ...) | grows with the conversation | What the detective and the philosophers know about the user | **Not in the session row.** Stored per user in `EDA_dossier`; merged back on hydrate if newer |
| 6 | per-turn reply and `suggest_existential_phase`, `llmRefusal` | strings or objects | per request only | Reply text and the phase suggestion | No. The reply text is logged in the thread rows (`kind: detective`) |

Detective count: 5 stored fields (row 3 has 4 context fields, so 8 leaf values). Rows 1 to 4 (7 leaf values) are checkpointed, row 5 is stored per user elsewhere, and row 6 is per request only.

Recovery: after a restart the detective resumes with phase and streak from the blob, counters from the blob raised to what the log shows, and its history from the `detectiveHistoryText` column. If the checkpoint is older than the last turns, those turns are in the log but are not replayed into the history, so the detective can be a few turns behind.

## Attaché agent

Sources: `api/agents/attache/attacheRuntime.js` (`createInitialAttacheSessionState`), `attacheMachine.js`, `api/chatService.js`.

In memory it is `attacheSessionByChatSessionId` (one object per session) and `attacheExchangeCountByChatSessionId`. The whole session object is checkpointed as `attacheSession`; the 18 top-level fields below are what that object holds (measured 3.8K chars at 12 turns).

| # | Field | Type | Bound / size | Purpose |
|---|-------|------|--------------|---------|
| 1 | `attacheState` | object | about 280 chars | Authoritative phase machine state |
| 1a | `attacheState.phase` | `start` `explore` `baseline1` `baseline2` `baseline3` `close` | 5 to 9 chars | Current phase |
| 1b | `attacheState.baseline_number` | 1, 2, 3 or null | 1 | Which baseline block |
| 1c | `attacheState.question_index` | number | small int | Position inside the block |
| 1d | `attacheState.n_questions_in_baseline` | number | small int | Questions drawn for this block |
| 1e | `attacheState.potential_next_phase` | phase or null | up to 9 chars | Where to go after the block, or resume target from explore |
| 1f | `attacheState.previous_phase` | phase or null | up to 9 chars | Last phase |
| 1g | `attacheState.previous_question_index` | number or null | small | Resume point |
| 1h | `attacheState.current_phase_id` | string or null | about 28 chars | Prompt catalog id for the phase |
| 1i | `attacheState.phase_before_close` | phase or null (optional) | up to 9 chars | Where to resume if the user leaves close |
| 1j | `attacheState.question_index_before_close` | number or null (optional) | small | Resume question |
| 2 | `chat_history` | `{role, content}[]` | 2 per attaché turn, up to `ATTACHE_MAX_TURNS = 100` turns; 2.4K chars at 12 turns; **no 120 cap and not shrunk by `fitOrchestration`** | LLM context for the attaché |
| 3 | `attache_close_count` | number | small | Turns where the user wanted to close |
| 4 | `attache_turn_count` | number | up to 100 | Hard cap that forces handoff to the detective |
| 5 | `baseline_question_counts` | `{1,2,3: number}` | about 20 chars | Randomly chosen questions per block |
| 6 | `baseline_question_order` | `{1,2,3: number[]}` | about 100 to 200 chars | Question order per block; **dropped from the blob when undefined**, so a restored session may not have it |
| 7 | `baseline_answer_count` | number | small | Answers given, for dossier meta |
| 8 | `baseline_question_stats` | `{askedTotal, answeredTotal, byBaseline{1,2,3:{asked,answered}}}` | about 140 chars | Question statistics |
| 9 | `baseline_refresh_return_category` | string or null | about 20 chars | Return category when a baseline was refreshed |
| 10 | `baseline_return_greeting_pending` | boolean | 5 | Next LLM turn gets a return preamble |
| 11 | `stale_dossier_rebaseline` | boolean | 5 | Legacy flag for stale-dossier re-baselining |
| 12 | `visit_bin` | string or null | about 7 chars | Time-away bin for this request |
| 13 | `ms_since_last_visit` | number or null | up to 13 digits | Time away for this request |
| 14 | `time_away_context_line` | string or null | about 60 chars | Human line about time away for the prompt |
| 15 | `dossier_stale_by_age` | boolean | 5 | Dossier too old |
| 16 | `temporal_greeting_mode` | string | about 6 chars | How to greet |
| 17 | `lastReturnClassification` | `{ returnCategory }` | about 40 chars | Last return policy result |
| 18 | `attacheOrchestratorSnapshot` | XState snapshot | about 440 chars | Invoked attaché orchestrator, which repeats `attacheState` and holds `attachePromptInstructionIds` (catalog ids, 20 to 150 chars) |

Plus, outside the session object: `attacheExchangeCount` (number, checkpointed) and the attaché share of `chatMachineSnapshot`.

Rows 1 to 18 are the 18 top-level fields; 1a to 1j are the 10 fields of `attacheState`. `visit_bin`, `ms_since_last_visit`, `time_away_context_line`, `dossier_stale_by_age` and `temporal_greeting_mode` are stamped from the current request each turn, so a restored value is only a stale copy until the next request overwrites it. `attacheState` is stored twice (in 1 and again inside 18); on restore the machine copy is re-aligned to the runtime copy.

Recovery: everything the attaché needs is in the checkpoint. Its chat is not in the log in the shape the LLM wants, so a checkpoint older than the last turns loses those turns for the attaché's history. The log (`kind: attache`) still holds the text.

## Lumen

Sources: `api/chatService.js` (`lumenChatHistoryBySessionId`, `currentStoryPhaseBySessionId`), `api/agents/philosophers/philosophersCall.js`, `philosophersMachine.js`.

| # | Field | Type | Bound / size | Purpose | Checkpoint? |
|---|-------|------|--------------|---------|-------------|
| 1 | `lumenChatHistoryBySessionId` | `{role, content}[]` | 2 per detective turn; rebuilt list is capped at 120 entries (`DURABLE_EXPORT_HISTORY_MAX`) and is about as large as `detectiveChatHistory` (42K chars at 30 turns) | LLM context for Lumen | **No (removed from the blob).** Rebuilt on hydrate from log rows by `rebuildPhilosopherHistory` (`user` events paired with `lumen_user`, detective phase only, last 120). A stored copy in an old blob is ignored |
| 2 | `currentStoryPhaseBySessionId` | XState snapshot, context `{ narrativeTurn: number }` | about 100 chars | Narrative turn; `narrativePhaseFromTurn` turns it into the narrative phase in Lumen's packet | Yes, `currentStoryPhase`. **Shared with Umbra**; written by `chatService`, not by Lumen (see the next section) |
| 3 | `historyRef` | object | about 75 chars | Tells hydrate which log rows exist | Yes |
| 4 | per-turn output: `lumenUserResponse`, `lumenOtherResponse`, `lumenNotes`, `lumenCallouts`, `llmRefusal` | string, string, string[], array, object | per request only | The reply and side material returned to the client | No. Only `lumenUserResponse` is logged, as `kind: lumen_user`. `lumenOtherResponse`, notes and callouts are not stored anywhere |
| 5 | system prompt | static | composed each turn by `composeStaticSystemPrompt("lumen")` | Persona | Not state; rebuilt from files |
| 6 | user packet | derived | built each turn from narrative phase and `dossier_summary` | Per-turn context | Not state; derived from 2 and the dossier |

Lumen count: 2 stored fields (history, `currentStoryPhase`) plus the `historyRef` pointer; 1 is rebuilt from the log, 1 checkpointed.

## Umbra

Same shape as Lumen, from `umbraChatHistoryBySessionId` and the same `currentStoryPhase`.

| # | Field | Type | Bound / size | Purpose | Checkpoint? |
|---|-------|------|--------------|---------|-------------|
| 1 | `umbraChatHistoryBySessionId` | `{role, content}[]` | same as Lumen | LLM context for Umbra | **No (removed from the blob).** Rebuilt from log rows (`user` paired with `umbra_user`) |
| 2 | `currentStoryPhaseBySessionId` | as Lumen | about 100 chars | Narrative turn | Yes, **shared with Lumen** (one snapshot for both) |
| 3 | `historyRef` | object | about 75 chars | Log pointer | Yes (shared) |
| 4 | per-turn output: `umbraUserResponse`, `umbraOtherResponse`, `umbraNotes`, `umbraCallouts`, `llmRefusal` | as Lumen | per request only | Reply and side material | No. Only `umbraUserResponse` is logged, as `kind: umbra_user` |
| 5, 6 | system prompt, user packet | as Lumen | | | Not state |

The two philosophers share one `currentStoryPhase` and have no other stored state of their own, so the history is the only per-agent field.

## `currentStoryPhase`: writers and readers

This is the story phase, one of five separate phase concepts; see [`phases.md`](phases.md) for the others (attaché phase, therapy phase, closure phase, routing).

One XState snapshot per session (machine `philosophersNarrativeMachine` in `api/agents/philosophers/philosophersMachine.js`, context `{ narrativeTurn }`), held in `currentStoryPhaseBySessionId` in `api/chatService.js`. Neither Lumen nor Umbra writes it; `chatService` does.

Writers:
- `advanceCurrentStoryPhase(sessionId)`: restores the actor from the stored snapshot, sends `NARRATIVE_TURN` (adds 1 to `narrativeTurn`), stores the new persisted snapshot. Called once at the end of every detective turn in `composeChatResponse`, online or offline, after the three model calls. Attaché turns do not advance it. `narrativeTurn` therefore equals the number of detective turns so far. The advance is unconditional; no agent decides it (see `phases.md`). It is also called by the dev lab step `CURRENT_STORY_PHASE_ADVANCE` in `runOrchestrationLabStep` (`api/orchestration/orchestrationLabSnapshot.js`, route `POST /api/dev/orchestration-step` in `server-dev.js`).
- `setCurrentStoryPhaseTurnForLabSession(sessionId, targetTurn)`: dev only; deletes the snapshot and replays `NARRATIVE_TURN` up to the target. Called by `syncLabDetectiveOrchestrationFromPreset`, which `seedSessionScenario` (`api/lab/chatTestSeed.js`, route `POST /api/dev/chat-scenario`) calls when the preset puts the session in the detective.
- `restoreSessionRuntimeFromDurable`: sets it from the blob field `currentStoryPhase` on hydrate.
- `clearSessionForAttacheRebaseline`: deletes it when a returning visitor is sent back to the attaché.

Readers:
- `buildPhilosopherComposeSession` (via `getStoryTurnFromCurrentStoryPhase`): turns `narrativeTurn` into `narrative_phase` with `narrativePhaseFromTurn` (`api/narrativePhases.js`: Exposition, Rising Action, Climax, Falling Action, Denouement, Coda, repeating) and, with the dossier summary, builds the packet for Lumen and Umbra each detective turn. The first detective turn sees `Exposition`. The detective and attaché do not read it.
- `exportSessionRuntimeForDurable`: copies it into the checkpoint blob, called from `saveSessionCheckpointToDurable` in `api/shared.js`.
- `getCurrentStoryPhaseForSession`: used by `buildOrchestrationLabSnapshot` for the dev lab view (`narrativeTurn`, `narrative_phase`).

Consequence for recovery: the story turn is written to the checkpoint only, not the log. If the checkpoint lags the log by n turns, the restored `narrativeTurn` is n turns behind, so Lumen and Umbra can be in an earlier story phase than before the restart. Since it counts detective turns, it equals the number of detective-phase `user` events in the log and could be rebuilt from there; that is not done today.

Names kept on purpose: the machine `philosophersNarrativeMachine`, its context field `narrativeTurn`, and the prompt packet field `narrative_phase` (with `api/narrativePhases.js`). They are part of the persisted snapshot shape and the Lumen and Umbra prompt contract, and only the stored snapshot itself is called `currentStoryPhase`.

## Process-memory state that is not an agent field

Source: `api/shared.js`. None of this is checkpointed and all of it is lost on restart.

| Field | Purpose | After restart |
|-------|---------|---------------|
| `userExchangeCounts` (sessionId to number) | Counts exchanges against `MAX_USER_EXCHANGES` | Resets to 0. The checkpointed `detectiveTurnCount` plus `attacheExchangeCount` are the durable equivalent |
| `lastActivityAtBySession` | Time-away classification | Seeded on hydrate from the row's `updatedAt` and the newest thread row's `ts` |
| `threadEventsBySession` | The last up to 400 log events for the client | Reloaded from thread rows on hydrate |
| `threadSeqBySession` | Next log sequence number | Reloaded as the larger of `sessionSeq` and the last thread row |
| `logTurnsBySession` | The last 200 exchanges (`{ seq, events }`) the summarizer may still need | Reloaded from thread rows on hydrate |
| `summaryStateBySession` | `{ own, inherited }` summary records: this session's, and the user's from an earlier session | Reloaded from the row's `conversationSummariesJson` and the `EDA_userSummary` row |
| `hydratedDurableSessions` | Which sessions have been read | Empty; each session is hydrated on its first request |
| `pendingThreadTurnsBySession` | Exchanges not yet written to the log (at most 200) | Lost; this is the only window where a crash drops an exchange |
| `dirtyTurnsSinceCheckpoint`, `lastCheckpointMsBySession` | Checkpoint scheduling | Reset; the first turn after a restart checkpoints |
| `durableHealth` | Degraded flag shown on `/api/config` | Resets |

## Size summary

Measured through `api/shared.js` with a fake model.

| Scenario | Blob, today (no philosopher histories) | Blob if Lumen and Umbra were kept | Largest log row | Whole log |
|----------|----------------------------------------|-----------------------------------|-----------------|-----------|
| 30 turns, 200-char messages, 1,500-char replies | 55.7K chars | 140.5K chars | 5.0K chars | 132K chars |
| 40 turns, 9,990-char messages, 4,000-char replies (worst case allowed by the 10,000-character cap) | 565K chars (over the 300K blob cap, so history is halved) | 1.49M chars | 22.3K chars | 836K chars |

Typical sessions fit comfortably. These blob sizes were measured before the detective history left the blob; the worst case was dominated by it (464K chars), and is now only the unbounded attaché `chat_history` (about 100K chars).

## What this means for recovery

- Rebuilt from the log on hydrate: Lumen history, Umbra history (not stored in the checkpoint at all);
- Also derivable from the log: the client transcript, and the sequence number.
- Rebuilt from the log when the blob is missing: detective turn count, attaché exchange count and the story turn (`restoreCountersFromLog`).
- Only in the checkpoint: routing snapshot (partly rebuilt from `baselineCompleted`), attaché session, detective phase and streak. The detective history is in the `detectiveHistoryText` column. A checkpoint can lag the log by up to `SESSION_CHECKPOINT_EVERY_K_TURNS - 1` turns, and `historyRef.toSeq` against `sessionSeq` shows how many.
- Only in the dossier row: the user's dossier.
- Not stored at all: `lumenOtherResponse`, Lumen and Umbra notes and callouts, `lastMockReply` outside the snapshot, and the process-memory table above.
- Open items for a later change: the attaché `chat_history` could also be rebuilt from the log (the log already has every `attache` and `detective` event), which would shrink the blob to a few thousand characters regardless of session length.
