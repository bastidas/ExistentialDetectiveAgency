# Storage field audit: what is written, what is read, and where names disagree

Audit of the durable rows on the PR 13 branch. Names are the exact strings in code. "Read" means a code path uses the value after loading it, not merely that the loader returns it. For per-agent detail see [`agent-state-inventory.md`](agent-state-inventory.md); for phases see [`phases.md`](phases.md).

Sources: `api/storage/durableTableStorage.js` (row shapes), `api/shared.js` (what is handed to it and what is done with the result), `api/chatService.js` (the blob), `api/dossier/summarization.js` (the summarizer).

## 1. Row inventory

### Session row: partition `EDA_session`, row key `sessionId`

Written by `saveSessionCheckpoint`; the only reader is `hydrateSession`.

| Stored name | Written from | Read back? | Notes |
|-------------|--------------|------------|-------|
| `schemaV` | `SESSION_SCHEMA_V` (2) | Returned, only compared by tests | Row layout version |
| `updatedAt` | `new Date().toISOString()` | Returned, **unused** | `lastActivityAtBySession` is never seeded from it |
| `userId` | `payload.userId` or `""` | Yes (`hydrated.userId` loads the dossier) | Also on every thread row |
| `sessionSeq` | `threadSeqBySession` | Yes (`max(sessionSeq, last thread row)`) | Third copy of the exchange count, see section 3 |
| `baselineCompleted` | `envelope.baseline_completed` | **No** | Duplicate of the routing state |
| `detectiveIntroSent` | `envelope.active_agent === "detective"` | **No** | Misnamed: it records routing, not an intro. `/api/chat-state` always sends `detectiveIntroSent: false` |
| `detectiveHistoryText` | `payload.detectiveHistoryText`, always `""` | **No** | Always empty |
| `degradedReason` | `plan.degraded.join(";")` | **No** | Diagnostic only; never surfaced |
| `conversationSummariesJson` (+ `conversationSummariesJsonChunks`, `__N`) | `JSON.stringify(payload.conversationSummaries \|\| null)`; the payload value is always `null`, so the stored text is `null` | **No** | Always `"null"` |
| `orchestrationRuntimeJson` (+ `orchestrationRuntimeJsonChunks`, `__N`) | `exportSessionRuntimeForDurable` plus `historyRef` | Yes, parsed to `orchestrationRuntime` | The blob, below |
| `threadEventsJson` (+ chunks) | Not written any more | Yes, legacy fallback only when no thread rows exist | Pre-log layout |

### Blob inside `orchestrationRuntimeJson`

| Stored name | Origin | Read by `restoreSessionRuntimeFromDurable`? |
|-------------|--------|---------------------------------------------|
| `v` | `ORCHESTRATION_RUNTIME_V` (2) | Yes, a mismatch discards the whole blob |
| `chatMachineSnapshot` | routing machine persisted snapshot | Yes |
| `attacheSession` | attaché session object (18 fields, see the inventory doc) | Yes |
| `detectiveChatHistory` | last 120 detective-phase messages | Yes |
| `currentStoryPhase` | story phase machine snapshot (`context.narrativeTurn`) | Yes |
| `detectiveTurnCount` | detective turns | Yes |
| `attacheExchangeCount` | attaché exchanges | Yes |
| `detectiveRuntime` | `{ orchestratorSnapshot, phaseSuggestionStreak }`; therapy phase is `orchestratorSnapshot.context.existentialTherapyPhase` | Yes |
| `historyRef` | `{ sessionId, fromSeq, toSeq }` | Only compared with `sessionSeq` to log a warning |

Attaché state lives in `attacheSession.attacheState` (phase, `baseline_number`, `question_index`, `n_questions_in_baseline`, `potential_next_phase`, `previous_phase`, `previous_question_index`, `current_phase_id`, `phase_before_close`, `question_index_before_close`) and again in `attacheSession.attacheOrchestratorSnapshot.context.attacheState`.

### Thread rows: partition `EDA_thread_<encodeURIComponent(sessionId)>`, row key `seq` padded to 8 digits

Stored names: `schemaV`, `userId`, `ts`, `eventsJson` (+ `eventsJsonChunks`, `__N`). All read by `loadThread`. Each event is `{ ts, phase, kind, text, agent }`.

### Dossier row: partition `EDA_dossier`, row key `userId`

Stored names: `updatedAt`, `dossierJson` (+ chunks). Read by `getDossierByUserId` and merged by `mergeDossierFromTableIfNewer`. In memory the same data is `dossierBySessionId`, keyed by session id, not user id.

### Other

`EDA_usageDaily` (row key UTC date, property `count`) is the daily spend counter. It is not session state.

## 2. Fields written but never read, or always empty

| Field | Problem |
|-------|---------|
| `conversationSummariesJson` | The caller passes `conversationSummaries: null`. Stored text is `null`. No code reads the column. The summarizer that would feed it is not called by chat |
| `detectiveHistoryText` | The caller passes `""`. Nothing reads it. `DETECTIVE_HISTORY_STORAGE_CHAR_LIMIT` only truncates this empty string |
| `baselineCompleted` (row) | Written from the envelope; the real value is in `chatMachineSnapshot.context.baselineCompleted` and is what restore uses |
| `detectiveIntroSent` (row) | Written, never read; named for something it does not record |
| `degradedReason` | Written, never read or surfaced |
| `updatedAt` (row) | Read by `hydrateSession`, ignored by `hydrateSessionFromDurable`. Effect: after a restart `lastActivityAtBySession` is empty, so `msSinceLastVisit` is 0 and the returning visitor is classified as just-now whatever the real gap was |

## 3. Same fact stored in several places under different names

| Fact | Where it appears |
|------|------------------|
| Routing / baseline done | row `baselineCompleted`; `chatMachineSnapshot.context.baselineCompleted`; envelope `baseline_completed`; `userProgress.baselineCompleted` in `/api/chat-state`; lab preset `baselineCompleted` |
| Detective has spoken | row `detectiveIntroSent`; `/api/chat-state` `detectiveIntroSent` (hard-coded false); `chatMachineSnapshot.context.activeAgent` |
| Turn counts | `sessionSeq` (row); `historyRef.toSeq`; `detectiveTurnCount`; `attacheExchangeCount`; `attacheSession.attache_turn_count`; `chatMachineSnapshot.context.orchestrationUserTurnCount`; `userExchangeCounts` (memory only) |
| Attaché state | `attacheSession.attacheState` and `attacheSession.attacheOrchestratorSnapshot.context.attacheState` (realigned every turn) |
| Time away | `chatMachineSnapshot.context.timeAwayBin` / `msSinceLastVisit`; `attacheSession.visit_bin` / `ms_since_last_visit` / `time_away_context_line` |
| Detective transcript | blob `detectiveChatHistory`; row `detectiveHistoryText` (empty); the log events |
| Summary | row `conversationSummariesJson`; packet field `summary`; session-state keys `preceding_conversation_summary`, `precedingConversationSummary`, `conversation_summary` (three spellings read by `buildLlmConversationState`); `dossier_summary` (a different, derived thing) |
| User id | row `userId` and `userId` on each thread row; cookie `edaUserId` |
| Schema version | `SESSION_SCHEMA_V` (row, thread rows) and `ORCHESTRATION_RUNTIME_V` (blob `v`): two constants that happen to both be 2 |

Write-path versus read-path name differences: payload `conversationSummaries` becomes column `conversationSummariesJson`; payload `orchestrationRuntime` becomes `orchestrationRuntimeJson`; payload `detectiveHistoryText` keeps its name. No read path looks for a name the write path does not use, apart from the legacy `threadEventsJson`.

## 4. Configuration that does nothing, and documentation that is wrong

| Item | Finding |
|------|---------|
| `N_DOSSIER_UPDATE_TURNS` (default 12, `shouldRunDossierUpdate`) | Dead. The live trigger is `DOSSIER_REFRESH_EVERY_N_DETECTIVE_TURNS` (default 3) in `chatService.js`. `durable-user-state.md` documents the dead one |
| `CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY` | Used only by the uncalled summarizer |
| `DETECTIVE_HISTORY_STORAGE_CHAR_LIMIT` | Only truncates the always-empty `detectiveHistoryText` |
| `durable-user-state.md` session-row table | Lists `detectiveStateJson`, `baselineRuntimeJson`, `baselineIntroSent`, `threadEventsJson` on the session row, a `{ v, updatedAt, baselineAttache, userDetective, philosophersInternal }` summary schema, and the partition `EDA_usageSession`. None exists in code. It omits `EDA_thread_<sessionId>`, `sessionSeq`, `degradedReason` and the chunk properties |
| `durable-user-state.md` `/api/chat-state` table | Lists `summaries`, `baselineIntroSent`, `lastActivityAt`; the response has none of them |
| `docs/DEPLOY-AZURE-SWA.md` | Still describes the old session contents |

## 5. Assessment of the summary design (`conversationSummariesJson`)

**What exists.** The only documented schema is `{ v, updatedAt, baselineAttache, userDetective, philosophersInternal }` in `durable-user-state.md`. The code has no schema: the writer passes `null`. The summarizer (`api/dossier/summarization.js`) returns a plain string (`summarizeHistory`), or `# MEMORY SUMMARY ... # RECENT HISTORY ...` (`maybeSummarize`). Nothing calls either from chat (removed in commit `309c352`). The model packet field `summary` is filled from `preceding_conversation_summary`, which nothing sets, so models never receive a summary today. Writer: none. Reader: none.

**Does it fit the goals?** Not as designed.

- **Per user, tied to the cookie.** It is keyed by session, in `EDA_session`. The session cookie lasts 7 days and the user cookie (`edaUserId`) 400 days. A returning visitor after a week gets a new session id, and the old summary is unreachable. The log has the same property: thread rows are keyed by session, and no row maps a user to their sessions. Per-user continuity today exists only in the dossier row, which is keyed by user id.
- **Append-only log plus derived state.** The log side is sound: one immutable row per exchange. A summary is derived state, and it should be disposable and recomputable from the log. This column is not: it is one overwritten JSON value with no record of what it covers (no `fromSeq` or `throughSeq`), so it cannot be checked, extended incrementally, or rebuilt idempotently.
- **Coupled to the checkpoint.** It shares the session row's entity budget (`MAX_ENTITY_CHARS - summariesJson.length - ...`) and is replaced only when a checkpoint runs, every few turns, so its freshness depends on checkpoint cadence rather than on when a summary is actually needed.
- **`philosophersInternal` cannot be derived.** Lumen's and Umbra's `otherResponse`, notes and callouts are never logged, so a summary of their internal side could not be rebuilt from the log.
- **Overlap with the dossier.** The dossier already carries durable per-user facts and feeds every agent through `dossier_summary`. What is missing is conversational continuity (what was discussed last time), not user facts.

**Recommendation: reconsider; do not wire the column up as it is.**
1. Treat a summary as a derived artifact, stored apart from the checkpoint, with a coverage marker: for example `{ v, userId, sessionId, fromSeq, throughSeq, text, createdAt }`. It is then recomputable from the log and safe to regenerate or drop.
2. Make continuity per user: add a user-to-sessions pointer (or a per-user rolling summary row beside `EDA_dossier`), because the session id changes after 7 days.
3. Drive it from the log, not the checkpoint: summarize when the uncovered tail grows past a threshold, and let the hydrate path read the latest summary plus the tail.
4. Delete `conversationSummariesJson`, `detectiveHistoryText`, `degradedReason` (or make it surface) and the row-level `baselineCompleted` and `detectiveIntroSent` from the checkpoint row, since nothing reads them and the first two are always empty. Fix `lastActivityAtBySession` to be seeded from `updatedAt` on hydrate.
5. Fix `durable-user-state.md` and delete the dead `N_DOSSIER_UPDATE_TURNS` and its summarizer helper, or revive them deliberately.

No code was changed for this audit.
