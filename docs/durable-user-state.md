# Durable user state (Azure Table Storage)

Greenfield schema: **drop or recreate** the table when deploying a breaking change (`DOSSIER_TABLE_NAME`). No legacy partition keys or property names are supported.

Per-agent field inventory (what is checkpointed, rebuilt from the log, or memory-only): [`agent-state-inventory.md`](agent-state-inventory.md). Intent, size and the bound that stops each persisted item from growing: [What persistence keeps track of](#what-persistence-keeps-track-of) on this page.

## Environment

| Variable | Purpose |
|----------|---------|
| `AZURE_STORAGE_CONNECTION_STRING` | Table Storage connection |
| `DOSSIER_TABLE_NAME` | Single table for all durable rows |
| `DURABLE_STORAGE_MODE` | `off` \| `azurite` \| `azure-cloud` |
| `ENABLE_DURABLE_STORAGE` | Legacy toggle (fallback only when `DURABLE_STORAGE_MODE` is unset) |
| `MAX_THREAD_EVENTS` | Max thread events kept (default `400`) |
| `MAX_THREAD_JSON_CHARS` | Max serialized size of the in-memory thread (default `800000`). What is persisted is bounded separately by the per-entity budget (see Chunked values) |
| `CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY` | Length of not-yet-summarized log text (default `6000`) that triggers one summarizer model call |
| `ENABLE_CONVERSATION_SUMMARY` | `0` / `false` stops that extra model call (default on; never runs OFFLINE) |
| `LAST_N_MESSAGES_FOR_DOSSIER` | Number of recent messages passed to dossier analyzer (default `12`) |
| `HISTORY_TAIL_TURNS` | Native chat-history tail sent to the model (default `8`, about 4 exchanges) |
| `HISTORY_TURN_MAX_CHARS` | Max characters kept per history message sent to the model (default `4000`) |
| `MAX_USER_EXCHANGES` | User turns per session before the closure sequence and HTTP 204 (default `40`). This is the session-lifetime cap that stops the log from growing without bound |
| `LAST_N_CLIENT_TRANSCRIPT_TURNS` | Client localStorage transcript tail (also exposed on `GET /api/config`; default `100`). Not a server persist bound |
| `SESSION_CHECKPOINT_EVERY_K_TURNS` | Upsert the session row after this many dirty user turns (default `5`; the first turn is always written). The chat log is written every turn regardless |
| `SESSION_CHECKPOINT_MIN_INTERVAL_MS` | Also checkpoint when the last write is older than this (default `300000`) |
| `DOSSIER_REFRESH_EVERY_N_DETECTIVE_TURNS` | Refresh the dossier from the detective conversation every N detective turns (default `3`) |

### Local Azurite

1. Run [Azurite](https://github.com/Azure/Azurite) with Table API enabled and set `AZURE_STORAGE_CONNECTION_STRING` to the emulator default (see Azurite docs).
2. Set `DOSSIER_TABLE_NAME` (e.g. `edadev`) and `DURABLE_STORAGE_MODE=azurite`.
3. Optional: run `npm test` in `api/` — `storage/durableTableStorage.azurite.test.js` performs a round-trip when those env vars are set (otherwise skipped).
| `TIME_AWAY_BRIEF_HOURS` | “Just stepped away” / same visit (default `0.25` h ≈ 15 min; optional 60 s floor unless guards disabled) |
| `TIME_AWAY_LONG_HOURS` | Long absence — ~a day or few (default `42` h) |
| `TIME_AWAY_STALE_HOURS` | How old last baseline may be before “stale” in middle bucket; multi-day / raise toward ~168 for week-scale (default `32` h; optional 1 h floor unless guards disabled) |
| `TIME_AWAY_DISABLE_MIN_GUARDS` | `1` / `true` — removes brief/stale floors for local testing (not for production) |
| `TIME_AWAY_BRIEF_MS` / `TIME_AWAY_LONG_MS` / `TIME_AWAY_STALE_MS` | Optional millisecond overrides (take precedence over `*_HOURS`) |
| `ENABLE_RETURN_POLICY` | `0` / `false` to disable return classification + routing |
| `RETURN_POLICY_LOG_ONLY` | `1` / `true` to log classification without enforcing baseline refresh |

## Partition keys (`partitionKey`)

| Value | Purpose |
|-------|---------|
| `EDA_session` | Session checkpoint row per `sessionId` |
| `EDA_thread_<encodeURIComponent(sessionId)>` | The session's chat log: one row per exchange, row key = sequence padded to 8 digits |
| `EDA_dossier` | Dossier row per `userId` |
| `EDA_userSummary` | Latest conversation summary per `userId`, so it outlives the 7-day session id |
| `EDA_usageDaily` | Global daily counter (row key = UTC date `YYYY-MM-DD`) |

## What persistence keeps track of

The persistence layer is five kinds of row in one Azure Table, plus a handful of process maps that are seeded from those rows. Each item below exists for a reason. Each has a bound so it cannot grow without limit. Nothing is trimmed because it "feels large": the bound is either the last thing a reader of that item actually uses, or an Azure Table hard limit.

**Convention, so a new persisted item has an obvious home:**

| Kind of fact | Home | How to add another |
|--------------|------|--------------------|
| Transcript (what was said) | The log. Rebuilt on hydrate. Exception: the detective transcript, which the log cannot rebuild faithfully, lives only in `detectiveHistoryText` | Add `rebuildXHistory(events)` and call it from `restoreSessionMemoryFromRows`. If the log is unfaithful, add a session-row text column like `detectiveHistoryText` |
| Agent machine state (phase, streak, question order) | `stateJson` on the log row (`exportTurnState` / `restoreTurnState`) | Add a key next to `attache` and `therapy` |
| Routing snapshot and turn counters | The checkpoint blob, with column and log fallbacks | Keep the blob small; do not put a transcript in it |

Written from the code on the PR 13 branch. Function names are given instead of line numbers. The tables later on this page are the original field notes; this section is the inventory of intent, size and the bound that stops growth. For phases see [`phases.md`](phases.md). For the write-versus-read audit see [`storage-field-audit.md`](storage-field-audit.md).

### How the pieces sit together

A session is a short, bounded conversation. The log is the source of truth for what was said. Everything else is either a flag, a derived summary, or a snapshot of machine state that the log cannot reconstruct.

| Role | What it is | Why it is not the others |
|------|------------|--------------------------|
| Log (thread rows) | One row per user turn: the events of that turn, plus the agent state as of its end | Append-only. Never overwritten. The checkpoint can lag it; the summary is derived from it |
| Checkpoint (session row + blob) | A point-in-time snapshot of routing, the story phase and the two turn counters | Written every few turns so a restart does not replay the log into XState. Droppable when over budget. Holds no transcript |
| Detective transcript column | The newest messages the detective model and the dossier analyzer will actually read | Not the log. The log also records mock and fallback replies that never enter this history |
| Summaries | One condensed string covering a marked range of the log | Disposable. Rebuilt when the uncovered tail is long enough. The log stays |
| Flags (`baselineCompleted`, `detectiveIntroSent`, `degradedReason`) | Booleans and a diagnostic list | Survive a missing blob. They do not grow |
| Dossier | Per-user facts, not conversation | Keyed by the 400-day user cookie, not the 7-day session id |
| Daily usage | One integer per UTC day | A budget kill switch, not session state |

The session-lifetime cap (`MAX_USER_EXCHANGES`, default 40) is the bound that stops almost everything else. A session that cannot take a 41st turn cannot grow a 41st log row, a 41st checkpoint, or a 41st summary extension. The attaché prelude has its own cap (`ATTACHE_MAX_TURNS`, 100), which is larger than the session cap and so is not the one that bites first.

### The bounds that stop growth

| Bound | Default | What it caps | What happens at the bound |
|-------|---------|--------------|---------------------------|
| `MAX_USER_EXCHANGES` | 40 user turns | The whole session: log rows, checkpoint cadence, counters | Closure sequence, then HTTP 204 |
| `MAX_MESSAGE_CHARS` | 10,000 | One user message | Rejected before it is logged |
| `MAX_DAILY_USAGE` | 300 LLM-backed turns / UTC day | Cross-session spend | HTTP 429, no model call |
| `HISTORY_TAIL_TURNS` | 8 messages | What the detective / Lumen / Umbra models are sent as native history | Older messages are not sent |
| `HISTORY_TURN_MAX_CHARS` | 4,000 | One history message sent to the model | Truncated per message |
| `LAST_N_MESSAGES_FOR_DOSSIER` | 12 | What the dossier analyzer is sent | Older messages are not sent |
| Stored detective history | `max(HISTORY_TAIL_TURNS, LAST_N_MESSAGES_FOR_DOSSIER)` = 12 messages, and 60,000 characters cut on whole lines | The `detectiveHistoryText` column | Newest whole lines kept; `detective_text_truncated` |
| Philosopher history on hydrate | 120 messages (`DURABLE_EXPORT_HISTORY_MAX`) | Rebuilt Lumen and Umbra lists | Oldest dropped; they are not stored |
| `CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY` | 6,000 characters of uncovered log text | When a summary is made | One model call; the summary text itself is capped at 6,000 characters (`MAX_SUMMARY_TEXT_CHARS`) |
| In-memory thread | 400 events (`MAX_THREAD_EVENTS`) and 800,000 serialized characters (`MAX_THREAD_JSON_CHARS`) | Process copy of the log | Oldest events dropped in memory. Azure still has the rows |
| In-memory summarizer log | 200 turns (`MAX_LOG_TURNS_KEPT`) | What `extendSummary` sees | Oldest turns dropped in memory |
| Pending thread writes | 200 (`MAX_PENDING_THREAD_TURNS`) | Unflushed log rows in the process | Oldest queued writes dropped |
| Per-property chunk | 30,000 characters (`MAX_PROPERTY_CHARS`) | Any string Azure Table stores | Split across `name`, `name__1`, … |
| Per-entity budget | 400,000 characters (`MAX_ENTITY_CHARS`); Azure hard limit is 1 MiB (about 524,000 characters at 2 bytes each) | One session row or one thread row | Session: the blob is left off. Thread: oldest events of that turn are dropped |
| Orchestration blob | 300,000 characters (`MAX_ORCHESTRATION_CHARS`), and not more than the leftover entity budget | The checkpoint blob | Not persisted (`orchestration_not_persisted`). Nothing inside it is halved |
| Log-row agent state | 40,000 characters (`MAX_TURN_STATE_CHARS`) | `stateJson` on a thread row | Left off (`turn_state_not_persisted`); the events of the turn are still written |
| Partition key | 900 characters in code (Azure allows 1,024) | `EDA_thread_<encoded sessionId>` | The thread write is skipped |
| Client transcript tail | 100 turns (`LAST_N_CLIENT_TRANSCRIPT_TURNS`) | Browser localStorage only | Not a server bound |

### 1. Session log rows (`EDA_thread_<sessionId>` / `seq`)

- **Intention:** the append-only record of what was said. One row per user turn, written every turn by `saveThreadTurn`. Hydrate, the summarizer, philosopher-history rebuild, attaché `chat_history` rebuild and the counter restore all read it. The checkpoint is allowed to lag it; the log is not allowed to lag the conversation.
- **What it holds:** `schemaV`, `userId`, `ts`, `eventsJson` (the user message plus every agent reply for that turn), and `stateJson` when the turn carried agent state. Each event is `{ ts, phase, kind, text, agent }`.
- **Size and bound:** at most `MAX_USER_EXCHANGES` rows per session (default 40). One user message is at most 10,000 characters; a detective-phase turn also carries Lumen and Umbra replies. A single row must fit the 400,000-character entity budget; `fitThreadEvents` drops the oldest events of *that turn* if they do not (`turn_oldest_N_events_not_persisted`). The in-memory copy is further trimmed to 400 events / 800,000 characters; Azure keeps the rows the process dropped.
- **Relation:** this is the source the other items are derived from or checked against. `sessionSeq` on the checkpoint is "how far the log has got". `historyRef` on the blob is "which log rows the checkpoint claims to cover". A summary's `fromSeq`/`throughSeq` is "which log rows this text condenses".

### 2. Agent state on the log (`stateJson`: therapy and attaché)

These are the new columns on the thread row, not on the session row. They exist because the blob is written every few turns and is dropped when over budget, and the three values they hold cannot be rebuilt from reply text alone.

- **Therapy (`stateJson.therapy`).** The detective runtime: `orchestratorSnapshot` (the therapy phase `initial` / `middle` / `final` lives in its context) and `phaseSuggestionStreak` (`{ lastSuggested, runLength }`). About 260 characters. Written on every row so a detective turn after the attaché prelude still has a home for it.
- **Attaché (`stateJson.attache`).** The attaché session without `chat_history`: phase, question index, shuffled question order, close and turn counters, stats, orchestrator snapshot. About 1,500 characters. Written whenever an attaché session exists. `chat_history` is the user message and reply of each turn of the latest attaché run, rebuilt from the log by `rebuildAttacheChatHistory`.
- **Intention:** hydrate can restore the attaché session, the therapy phase and the streak exactly as of the last logged turn, with or without the blob. `restoreTurnState` applies the newest row that has each part, then the blob is used only for a part no row has (rows written before `stateJson` existed).
- **Bound:** 40,000 characters for the whole `stateJson`. Over that it is left off and reported as `turn_state_not_persisted`. The events of the turn are still written. Because the attaché `chat_history` is not stored here, the column does not grow with reply length.

### 3. Checkpoint blob (`orchestrationRuntimeJson`)

- **Intention:** a restartable snapshot of routing (`chatMachineSnapshot`), `currentStoryPhase`, the two turn counters, and `historyRef`. Written by `saveSessionCheckpoint` on the first turn, then every `SESSION_CHECKPOINT_EVERY_K_TURNS` (default 5) dirty turns or every `SESSION_CHECKPOINT_MIN_INTERVAL_MS` (default 5 minutes). It holds no transcript.
- **Size and bound:** at most 300,000 characters, and not more than the leftover of the 400,000-character session-row budget after the summary and detective transcript are reserved. Over budget the blob is not persisted (`orchestration_not_persisted`). A blob whose `v` is not `ORCHESTRATION_RUNTIME_V` (2) is ignored on restore. New writes omit `attacheSession`, `detectiveRuntime` and every `*ChatHistory`. A legacy blob that still has them is read as a fallback only: `chat_history` is stripped and rebuilt from the log; `detectiveChatHistory` is used only when `detectiveHistoryText` is empty.
- **Relation:** the blob can trail the log by up to K−1 turns. Hydrate prefers `stateJson` for the attaché session, therapy phase and streak, and prefers the log for counters and all rebuildable histories. The remaining reason the blob exists is the routing snapshot (partly rebuilt from `baselineCompleted`) and `orchestrationUserTurnCount`.

### 4. Detective transcript (`detectiveHistoryText`)

- **Intention:** the only stored copy of the detective's LLM history. The model is sent the last 8 messages (`HISTORY_TAIL_TURNS`); the dossier analyzer is sent the last 12 (`LAST_N_MESSAGES_FOR_DOSSIER`). The column therefore keeps the newest 12 (`DETECTIVE_HISTORY_KEEP_MESSAGES`). It is not rebuilt from the log, because the log also records mock and fallback replies that never enter this history.
- **Size and bound:** 12 messages, and never more than 60,000 characters (`MAX_DETECTIVE_TEXT_CHARS`), cut on a whole line so a message is never split. A cut is reported as `detective_text_truncated`. Written with the checkpoint, so it can trail the log by up to K−1 turns.
- **Relation:** this is what `restoreSessionFromRowColumns` puts into memory. The 8-message tail sent to the model is a further slice of this, each message truncated to 4,000 characters (`HISTORY_TURN_MAX_CHARS`) by `sliceNativeHistory`. It shares the session-row entity budget with the blob and the summary; keeping it to 12 messages is what lets the blob stay small.

### 5. Conversation summaries (`conversationSummariesJson` and `EDA_userSummary`)

One schema, two homes. The record is `{ v, userId, sessionId, fromSeq, throughSeq, text, createdAt }` (`SUMMARY_SCHEMA_V` = 1).

- **Intention:** conversational continuity for Lumen and Umbra (`preceding_conversation_summary`), without sending them the whole log. The coverage marker (`fromSeq`/`throughSeq`) makes the record disposable: it can be checked, extended, or dropped and rebuilt from the log. The per-user row exists because the session cookie lasts 7 days and the user cookie (`edaUserId`) lasts 400 days; a returning visitor after a week gets a new session id and would otherwise lose the summary.
- **When it grows, and when it stops:** `maybeExtendConversationSummary` runs after each exchange. `extendSummary` fires only when the uncovered log text (turns after `throughSeq`) is at least `CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY` (default 6,000 characters). One model call condenses the earlier text plus those turns. The resulting `text` is sliced to `MAX_SUMMARY_TEXT_CHARS` (6,000). A failed call keeps the old record and never stores raw transcript. `ENABLE_CONVERSATION_SUMMARY=0` or `OFFLINE` skips the call. In memory the summarizer only sees the last 200 turns (`MAX_LOG_TURNS_KEPT`).
- **Two writes:** the session column `conversationSummariesJson` is written with the next checkpoint (so it can lag by up to K−1 turns). The per-user row `EDA_userSummary` / `userId` / `summaryJson` is written at once. Hydrate compares them; for the same session the one covering more of the log wins. A user row from an earlier session is carried over (`priorText`) until this session has its own. There is one user row, overwritten, so the per-user store does not accumulate sessions.
- **Relation:** the summary is derived from the log and must never replace it. Lumen and Umbra send it to the model; the detective and attaché prompts do not include `llmSafeState` today, so for them it is only in the diagnostic view. It is a different thing from `dossier_summary`.

### 6. `baselineCompleted`

- **Intention:** a one-bit record that the attaché prelude is done and the detective has the floor. Used when the routing snapshot is missing (`seedPersistedChatMachineFromFlags` sends `ATTACHE_HANDOFF_TO_DETECTIVE`).
- **Size and bound:** a boolean. It does not grow. It is a copy of `envelope.baseline_completed`, which is also inside `chatMachineSnapshot`.
- **Relation:** routing itself lives in the blob. This flag is the blob-independent fallback. It is not the attaché phase, the therapy phase, or the story phase.

### 7. `detectiveIntroSent`

- **Intention:** the detective has spoken at least once, so it must not open a second time after a restart, and `/api/chat-state` can report the real value. Written as `detectiveTurnCount > 0`.
- **Size and bound:** a boolean. It does not grow. The name is leftover: it is not an "intro was sent" flag in the attaché sense, it is "the detective turn count is at least one".
- **Relation:** `restoreSessionFromRowColumns` floors the detective turn count at 1 when this is true. `restoreCountersFromLog` may then raise it further from the log.

### 8. `degradedReason`

- **Intention:** a diagnostic of a lossy checkpoint write, so hydrate and `/api/config` can say the stored snapshot is incomplete. Values today: `orchestration_not_persisted`, `detective_text_truncated` (session row); thread-row losses (`turn_state_not_persisted`, `turn_oldest_N_events_not_persisted`) are returned on that write and recorded in durable health, not in this column.
- **Size and bound:** a short `;`-joined string, a few reasons at most. It does not grow with the conversation.
- **Relation:** hydrate surfaces each reason as `stored_checkpoint_<reason>` in durable health. It no longer decides whether the detective transcript overrides the blob: there is only one stored copy.

### 9. `lastActivityAtBySession`

- **Intention:** the clock for time-away after a restart. Without it, `msSinceLastVisit` is 0 and a returning visitor is classified as "just now" whatever the real gap was.
- **Where it lives:** a process map, not a column of its own. Hydrate seeds it from the later of the session row's `updatedAt` and the newest thread row's `ts` (`hydrateSession` returns that as `lastActivityAt`). Live turns update the map in the request path.
- **Size and bound:** one timestamp per live session in the process. It does not grow with the conversation.

### 10. Chat-history retention (the last twelve messages)

Three different tails, one reason: the models and the dossier analyzer do not read further back, so storage does not keep further back.

| Tail | Length | Reader | Where it is applied |
|------|--------|--------|---------------------|
| Stored detective history | 12 messages (`max(8, 12)`), 60,000 characters | Hydrate, then the two readers below | `exportDetectiveHistoryText` / `detectiveHistoryText` |
| Sent to the model | 8 messages, 4,000 characters each | Detective, Lumen, Umbra (`sliceNativeHistory`) | Request time, not storage |
| Sent to the dossier analyzer | 12 messages | Dossier update | Request time, not storage |
| Rebuilt Lumen / Umbra history | 120 messages | Those agents after hydrate | `rebuildPhilosopherHistory`; not stored |
| Attaché `chat_history` | The latest attaché run, from the log | The attaché after hydrate | Rebuilt by `rebuildAttacheChatHistory`. Not stored |

Lumen and Umbra histories are not in the checkpoint. They are rebuilt from detective-phase `user` + `lumen_user` / `umbra_user` events and then sliced to 120. In a 40-turn session that cap is not reached (two messages per detective turn).

### 11. Chunking thresholds

Azure Table rejects a string property over 32,768 UTF-16 characters and an entity over 1 MiB. The code stays under both:

- A value over 30,000 characters is split as `name`, `name__1`, `name__2`, … with the count in `<name>Chunks`. A surrogate pair is never split. Readers still accept a pre-chunking row that holds the value in a single property. A missing piece is reported as corrupt, not returned as a partial string.
- The session row budgets 400,000 characters across the three chunked fields (summary, detective text, blob). The blob may use 300,000 of what is left after the other two. A thread row budgets 400,000 for `eventsJson` plus `stateJson`.
- The dossier row is chunked the same way but has no total entity budget of its own (an open item). `maxEntriesPerTrait` (default 5, 1 for some traits) is the only in-object trim.

A lossy write is logged, returned as `degraded`, and (for the session row) stored in `degradedReason`.

### 12. Other persisted fields the storage layer writes

| Item | Intention | Bound |
|------|-----------|-------|
| `schemaV` | Row layout version (`SESSION_SCHEMA_V` = 2) so a reader can tell an old shape | One number |
| `updatedAt` | When the session or dossier or user-summary or usage row was written | One ISO string |
| `userId` | Links the session to the dossier and the user summary | The cookie value, also on every thread row |
| `sessionSeq` | Highest exchange number the checkpoint knows about | An integer ≤ `MAX_USER_EXCHANGES`; hydrate takes `max(sessionSeq, last thread row)` |
| `historyRef` | `{ sessionId, fromSeq, toSeq }` inside the blob: which log rows this checkpoint claims | Three small fields; compared on hydrate to log a warning if `toSeq` is past the log |
| `currentStoryPhase` | Lumen and Umbra narrative turn, inside the blob | A small XState snapshot (~100 characters). Follows the detective turn count; rebuilt from that count when the blob is missing |
| `threadEventsJson` | Legacy: the whole log inside the session row, from before thread rows existed | Read only when the session has no thread rows; no longer written |
| `EDA_dossier` / `dossierJson` | Per-user facts every agent reads (`dossier_summary`) | Written only when an analysis run completes (attaché handoff, or every `DOSSIER_REFRESH_EVERY_N_DETECTIVE_TURNS` detective turns, default 3). Chunked; no entity budget. Trait lists trimmed to 5 entries (1 for some) |
| `EDA_usageDaily` / `count` | LLM-backed turns today, so `MAX_DAILY_USAGE` is shared across instances | One integer per UTC date. Stops at 300 by refusing the next turn |
| Session cookie `sessionId` | Identifies the session row and the thread partition | 7 days. After that a new session id is issued; the user summary and the dossier still attach via `edaUserId` |
| User cookie `edaUserId` | Identifies the dossier and the user summary | 400 days |

Not persisted, and not reconstructed: Lumen and Umbra `otherResponse`, notes and callouts; `lastMockReply` outside the detective snapshot; `orchestrationUserTurnCount` when the blob is missing.

### What is still allowed to be large, and why that is acceptable

The log is one row per turn of a 40-turn session, each row one user message (≤ 10,000 characters) plus the replies of that turn. That is the largest store, and it is the one that is supposed to be complete. The in-memory copy of it is the thing that is trimmed (400 events / 800,000 characters / 200 summarizer turns), so a long-lived process does not hold every session's full log.

The next-largest thing was the histories inside the blob. Those copies are gone. The blob is routing, the story-phase snapshot and two counters. The summary is a 6,000-character overwrite. The flags do not grow. The user-summary row is one record per user, overwritten.

## Session row (`partitionKey=EDA_session`, `rowKey=sessionId`)

Written by `saveSessionCheckpoint`, read by `hydrateSession`. Every column below is read back and used; see [`storage-field-audit.md`](storage-field-audit.md) for the history of how each came to be.

| Property | Description | Used on hydrate for |
|----------|-------------|---------------------|
| `schemaV` | Row layout version (`SESSION_SCHEMA_V`, currently `2`) | Returned with the row |
| `updatedAt` | ISO time of this write | Seeds the session's last-activity time (with the newest log row's `ts`), so time-away after a restart is real |
| `userId` | The `edaUserId` cookie value | Loads the dossier and the user's summary |
| `sessionSeq` | Highest exchange number checkpointed | The log position (the larger of this and the last log row) |
| `orchestrationRuntimeJson` (+ chunks) | Versioned blob: chat machine snapshot, `currentStoryPhase`, counters, `historyRef`. No transcript | Primary restore of routing. Attaché state, therapy, histories and counters come from the log and the other columns (see Recovery without the blob) |
| `baselineCompleted` | The attaché baseline is done and the detective has the floor | When no routing snapshot could be restored, routing is rebuilt as detective (`seedPersistedChatMachineFromFlags`) |
| `detectiveIntroSent` | The detective has spoken at least once (`detectiveTurnCount > 0`) | Floors the detective turn count at 1 so it does not open twice; `GET /api/chat-state` reports it |
| `detectiveHistoryText` (+ chunks) | The detective transcript, one `role<TAB>JSON string` line per message, the newest `max(HISTORY_TAIL_TURNS, LAST_N_MESSAGES_FOR_DOSSIER)` messages (12 by default, which is all either model reads), never more than 60,000 characters, cut on whole lines | The only stored copy of the detective history; it becomes the in-memory history. A legacy blob that still has `detectiveChatHistory` is used only when this column is empty |
| `degradedReason` | `;`-joined reasons the write dropped content (`orchestration_not_persisted`, `detective_text_truncated`) | Surfaced in `GET /api/config` health as `stored_checkpoint_<reason>` |
| `conversationSummariesJson` (+ chunks) | This session's summary record, or the text `null` | Published to the models as `preceding_conversation_summary` |

The chat history is **not** in this row. It is written every exchange to the session's thread rows (below). Rows from before thread rows kept it in `threadEventsJson` inside the session row; that is still read when a session has no thread rows.

### Conversation summary record

A summary is derived from the append-only log and says which part of it it covers, so it can be checked, extended, or dropped and rebuilt:

```json
{ "v": 1, "userId": "...", "sessionId": "...", "fromSeq": 1, "throughSeq": 18, "text": "...", "createdAt": "ISO" }
```

- **Writer:** `maybeExtendConversationSummary` in `api/shared.js`, after each exchange. When the log text after `throughSeq` reaches `CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY`, one model call condenses the earlier summary plus those exchanges (`extendSummary` in `api/dossier/conversationSummary.js`). A failed call keeps the old summary.
- **Stored in:** the session row column above (written with the next checkpoint) and the `EDA_userSummary` row (written at once).
- **Read:** on hydrate, the session column and the user row are compared; for the same session the one covering more of the log wins. A user row from an earlier session is carried over until this session has its own.
- **Reaches the models:** Lumen and Umbra receive it in their user packet (`summary`). The detective and attaché prompts do not include `llmSafeState` today, so for them it is only in the diagnostic view.

### Thread rows (`partitionKey=EDA_thread_<sessionId>`, `rowKey=seq`)

`schemaV`, `userId`, `ts`, `eventsJson` (+ chunks), and `stateJson` (+ chunks) when the turn carried agent state. `ts` of the newest row is the last-activity time used after a restart.

`stateJson` is `{ attache?, therapy? }` as of the end of that turn, written in the same upsert as the events, so it is never older than the log:

- `therapy`: the detective runtime (`orchestratorSnapshot`, which holds the therapy phase, and `phaseSuggestionStreak`). About 260 characters, on every row.
- `attache`: the attaché session without its `chat_history` (phase, question progress, question order, counters, stats, orchestrator snapshot). About 1,500 characters, whenever an attaché session exists. The `chat_history` is rebuilt from the log (`rebuildAttacheChatHistory`).

State over 40,000 characters is left off and reported as `turn_state_not_persisted`. Hydrate takes the newest row that has each part and applies it over the blob's copy.

### Thread event `kind` values

- `user` — user message  
- `attache` — baseline assistant  
- `detective` — detective user-facing reply  
- `lumen_user`, `lumen_aside`, `umbra_user`, `umbra_aside` — philosopher channels  

`phase`: `baseline` | `detective`.

## Dossier row (`partitionKey=EDA_dossier`, `rowKey=userId`)

| Property | Description |
|----------|-------------|
| `dossierJson` | Normalized dossier object |
| `updatedAt` | ISO timestamp |

**Write rule:** dossier row is upserted **only** when a dossier analysis run completes.

### When dossier analysis runs

1. **Baseline handoff** — when attaché session ends: full baseline `chat_history` passed to analyzer.  
2. **Periodic detective** — when the detective turn count is a multiple of `DOSSIER_REFRESH_EVERY_N_DETECTIVE_TURNS` (and not OFFLINE / has client).

## GET `/api/chat-state` response (high level)

| Field | Description |
|-------|-------------|
| `messages` | UI-shaped array derived from `threadEvents` (`role`, `text`, `agent`, optional `kind`) |
| `serverSeq` | Monotonic transcript sequence for client merge/recovery |
| `envelope` | Routing envelope for active agent / baseline flags |
| `userProgress` | `baselineCompleted`, `pendingBaselineRefresh`, `returningPersisted` |
| `detectiveIntroSent` | `true` once the detective has spoken in this session (restored from the row's `detectiveIntroSent`) |
| `orchestration` | `orchestration_user_turn_count`, `detective_turn_count`, `attache_exchange_count` |
| `resumeUi` | `transcriptMode`, `skipEmptyChatBootstrap`, `serverRetainsHistory` |

### Dossier `meta` (return policy)

| Field | Description |
|-------|-------------|
| `lastBaselineCompletedAt` | Unix ms when attaché baseline last completed (handoff); used with time-away to decide stale baseline. |

### GET `/api/chat-state` extras

| Field | Description |
|-------|-------------|
| `sideTranscripts.philosophers` | Lumen/Umbra thread lines for a future folder UI (not main chat). |
| `returnClassification` | `{ returnCategory, timeAwayMs, needsBaselineRefresh, baselineReason, lastActivityAtIso }` when `ENABLE_RETURN_POLICY` is on. |

## Recovery without the blob

The blob is written at checkpoints and is not persisted when it is over budget, so hydrate does not depend on it. What each piece is rebuilt from when it is missing:

| State | Source | Exact? |
|-------|--------|--------|
| Routing (detective has the floor) | `baselineCompleted` column | Yes |
| Detective history | `detectiveHistoryText` column | Up to the checkpoint; can trail the log by up to `SESSION_CHECKPOINT_EVERY_K_TURNS - 1` turns |
| Attaché session (phase, question progress, question order, counters, stats) | `stateJson` on the newest attaché log row; `chat_history` rebuilt from the log | Yes, as of the last attaché turn |
| Therapy phase, phase-suggestion streak | `stateJson` on the newest log row | Yes, as of the last turn |
| Detective turn count, attaché exchange count | The log: `attache` and `detective` reply events after the last attaché run began (`deriveCountsFromLog`), raised never lowered | Yes while the log keeps those events |
| Story turn (`currentStoryPhase`) | Follows the detective turn count, as live | Yes |
| Lumen and Umbra history | The log | Yes (unchanged) |
| Summary | `conversationSummariesJson`, then the user's `EDA_userSummary` row | Yes |
| Last activity | `updatedAt` and the newest log row | Yes |

The attaché session, the therapy phase and the phase-suggestion streak are restored from the newest log rows' `stateJson` (see Thread rows), not from the blob, so they are exact as of the last logged turn and survive a missing, dropped or stale blob. Rows written before `stateJson` existed have none; for those the blob's copy is used if there is one.

Not recoverable without the blob: `orchestrationUserTurnCount` and the routing snapshot's own counters (routing itself is rebuilt from `baselineCompleted`).

## Chunked values and degraded mode

Azure Table rejects string properties over 32,768 UTF-16 characters and entities over 1 MiB. Session and dossier JSON is therefore written as chunked properties: `name`, `name__1`, `name__2`, ... with the piece count in `<name>Chunks` (each piece at most 30,000 characters, never splitting a surrogate pair). Readers still accept older rows that hold the value in a single property.

- Per-entity budget: about 400,000 characters across the chunked session fields (summary, detective text, orchestration blob). The orchestration blob may use up to 300,000 of them, less what the other two take; over that the blob is not persisted (`orchestration_not_persisted`) and the session is rebuilt from the row columns and the log. The blob no longer holds the detective history, so it stays small and nothing is halved. A thread row keeps the newest events that fit. Each lossy write is logged and recorded in the row's `degradedReason`, which hydrate reads back.
- Row version: every session row carries `schemaV` (currently `2`). The orchestration blob carries `v` (`ORCHESTRATION_RUNTIME_V`, currently `2`). A blob with another `v` is ignored on restore (logged); the thread rows are still read, and the row columns above fill in routing, the detective history and the summary.
- Failures are non-fatal. A failed checkpoint is logged and retried on the next turn; a failed read leaves the session unhydrated and holds back checkpoints until a read succeeds, so an empty in-memory session never overwrites the stored one. `GET /api/config` reports `durableStorageDegraded` while writes or reads are failing.

## Maintenance

- Prefer editing **`api/storage/threadEvents.js`** for caps and API message mapping.  
- Bump `v` inside JSON blobs when making incompatible in-blob schema changes.
- Client recovery path can sync recovered local tails via `POST /api/chat-sync`.
