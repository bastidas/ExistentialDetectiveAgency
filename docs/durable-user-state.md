# Durable user state (Azure Table Storage)

Greenfield schema: **drop or recreate** the table when deploying a breaking change (`DOSSIER_TABLE_NAME`). No legacy partition keys or property names are supported.

Per-agent field inventory (what is checkpointed, rebuilt from the log, or memory-only): [`agent-state-inventory.md`](agent-state-inventory.md).

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
| `DETECTIVE_HISTORY_STORAGE_CHAR_LIMIT` | Cap on the stored `detectiveHistoryText` (also never more than 60,000 characters) |
| `LAST_N_MESSAGES_FOR_DOSSIER` | Number of recent messages passed to dossier analyzer |
| `LAST_N_CLIENT_TRANSCRIPT_TURNS` | Client localStorage transcript tail (also exposed on `GET /api/config`) |
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

## Session row (`partitionKey=EDA_session`, `rowKey=sessionId`)

Written by `saveSessionCheckpoint`, read by `hydrateSession`. Every column below is read back and used; see [`storage-field-audit.md`](storage-field-audit.md) for the history of how each came to be.

| Property | Description | Used on hydrate for |
|----------|-------------|---------------------|
| `schemaV` | Row layout version (`SESSION_SCHEMA_V`, currently `2`) | Returned with the row |
| `updatedAt` | ISO time of this write | Seeds the session's last-activity time (with the newest log row's `ts`), so time-away after a restart is real |
| `userId` | The `edaUserId` cookie value | Loads the dossier and the user's summary |
| `sessionSeq` | Highest exchange number checkpointed | The log position (the larger of this and the last log row) |
| `orchestrationRuntimeJson` (+ chunks) | Versioned blob: chat machine snapshot, attaché session, `detectiveChatHistory`, `currentStoryPhase`, counters, detective runtime, `historyRef` | Primary restore of routing, attaché state, counters and phases |
| `baselineCompleted` | The attaché baseline is done and the detective has the floor | When no routing snapshot could be restored, routing is rebuilt as detective (`seedPersistedChatMachineFromFlags`) |
| `detectiveIntroSent` | The detective has spoken at least once (`detectiveTurnCount > 0`) | Floors the detective turn count at 1 so it does not open twice; `GET /api/chat-state` reports it |
| `detectiveHistoryText` (+ chunks) | The detective transcript, one `role<TAB>JSON string` line per message, newest 60,000 characters at most | Becomes the detective history when the blob has none, or when `degradedReason` says the blob's copy was trimmed and this one is longer |
| `degradedReason` | `;`-joined reasons the write dropped content (`orchestration_history_trimmed`, `orchestration_not_persisted`) | Surfaced in `GET /api/config` health as `stored_checkpoint_<reason>`, and decides whether `detectiveHistoryText` overrides the blob |
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

`schemaV`, `userId`, `ts`, `eventsJson` (+ chunks). `ts` of the newest row is the last-activity time used after a restart.

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

## Chunked values and degraded mode

Azure Table rejects string properties over 32,768 UTF-16 characters and entities over 1 MiB. Session and dossier JSON is therefore written as chunked properties: `name`, `name__1`, `name__2`, ... with the piece count in `<name>Chunks` (each piece at most 30,000 characters, never splitting a surrogate pair). Readers still accept older rows that hold the value in a single property.

- Per-entity budget: about 400,000 characters across the chunked session fields (summary, detective text, orchestration blob). The orchestration blob may use up to 300,000 of them, less what the other two take; over that, `detectiveChatHistory` is halved (newest kept), and if it still does not fit it is not persisted. A thread row keeps the newest events that fit. Each lossy write is logged and recorded in the row's `degradedReason`, which hydrate reads back.
- Row version: every session row carries `schemaV` (currently `2`). The orchestration blob carries `v` (`ORCHESTRATION_RUNTIME_V`, currently `2`). A blob with another `v` is ignored on restore (logged); the thread rows are still read, and the row columns above fill in routing, the detective history and the summary.
- Failures are non-fatal. A failed checkpoint is logged and retried on the next turn; a failed read leaves the session unhydrated and holds back checkpoints until a read succeeds, so an empty in-memory session never overwrites the stored one. `GET /api/config` reports `durableStorageDegraded` while writes or reads are failing.

## Maintenance

- Prefer editing **`api/storage/threadEvents.js`** for caps and API message mapping.  
- Bump `v` inside JSON blobs when making incompatible in-blob schema changes.
- Client recovery path can sync recovered local tails via `POST /api/chat-sync`.
