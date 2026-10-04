# Durable user state (Azure Table Storage)

Greenfield schema: **drop or recreate** the table when deploying a breaking change (`DOSSIER_TABLE_NAME`). No legacy partition keys or property names are supported.

## Environment

| Variable | Purpose |
|----------|---------|
| `AZURE_STORAGE_CONNECTION_STRING` | Table Storage connection |
| `DOSSIER_TABLE_NAME` | Single table for all durable rows |
| `DURABLE_STORAGE_MODE` | `off` \| `azurite` \| `azure-cloud` |
| `ENABLE_DURABLE_STORAGE` | Legacy toggle (fallback only when `DURABLE_STORAGE_MODE` is unset) |
| `MAX_THREAD_EVENTS` | Max thread events kept (default `400`) |
| `MAX_THREAD_JSON_CHARS` | Max serialized size of `threadEventsJson` (default `800000`, under 1 MB entity limit) |
| `CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY` | Char threshold before summarization |
| `DETECTIVE_HISTORY_STORAGE_CHAR_LIMIT` | Max persisted detective transcript chars |
| `LAST_N_MESSAGES_FOR_DOSSIER` | Number of recent messages passed to dossier analyzer |
| `LAST_N_CLIENT_TRANSCRIPT_TURNS` | Client localStorage transcript tail (also exposed on `GET /api/config`) |
| `SESSION_CHECKPOINT_EVERY_K_TURNS` | Upsert session row after this many dirty user turns (default `5`) |
| `SESSION_CHECKPOINT_MIN_INTERVAL_MS` | Minimum ms between checkpoints when dirty (default `300000`, ~5 min) |

### Local Azurite

1. Run [Azurite](https://github.com/Azure/Azurite) with Table API enabled and set `AZURE_STORAGE_CONNECTION_STRING` to the emulator default (see Azurite docs).
2. Set `DOSSIER_TABLE_NAME` (e.g. `edadev`) and `DURABLE_STORAGE_MODE=azurite`.
3. Optional: run `npm test` in `api/` — `storage/durableTableStorage.azurite.test.js` performs a round-trip when those env vars are set (otherwise skipped).
| `N_DOSSIER_UPDATE_TURNS` | Run dossier analyzer every N detective turns (default `12`) |
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
| `EDA_session` | Session runtime row per `sessionId` |
| `EDA_dossier` | Dossier row per user/session |
| `EDA_usageSession` | Per-session exchange counter |
| `EDA_usageDaily` | Global daily counter (row key = UTC date `YYYY-MM-DD`) |

## Session row (`partitionKey=EDA_session`, `rowKey=sessionId`)

| Property | Description |
|----------|-------------|
| `detectiveStateJson` | Detective control state: `turn_count`, `mode`, `should_begin_closure`, optional `baseline_summary`, etc. |
| `baselineRuntimeJson` | Attaché/baseline orchestrator state. After `baselineCompleted`, `chat_history` is **omitted** on persist to save space (thread events are canonical). |
| `threadEventsJson` | JSON array of `{ ts, phase, kind, text }` (see below). |
| `orchestrationRuntimeJson` | Versioned allowlist blob (`v`, chat machine snapshot, attaché session, histories, philosopher snapshot, detective runtime). |
| `conversationSummariesJson` | `{ v, updatedAt, baselineAttache, userDetective, philosophersInternal }` — updated when a summarizer runs. |
| `detectiveHistoryText` | Merged detective-phase transcript string for LLM / `maybeSummarize`. |
| `baselineCompleted` | Baseline handoff done |
| `baselineIntroSent` | First baseline line was sent |
| `detectiveIntroSent` | Detective auto-opener sent |
| `updatedAt` | ISO timestamp (last session row write) |

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

**Write rule:** dossier row is upserted **only** when a dossier analysis run completes (`persistProfile: true` in code).

### When dossier analysis runs

1. **Baseline handoff** — when attaché session ends: full baseline `chat_history` passed to analyzer.  
2. **Periodic detective** — when `turn_count` is a multiple of `N_DOSSIER_UPDATE_TURNS` (and not OFFLINE / has client).

## GET `/api/chat-state` response (high level)

| Field | Description |
|-------|-------------|
| `messages` | UI-shaped array derived from `threadEvents` (`role`, `text`, `agent`, optional `kind`) |
| `serverSeq` | Monotonic transcript sequence for client merge/recovery |
| `envelope` | Routing envelope for active agent / baseline flags |
| `userProgress` | `baselineCompleted`, `baselineDossierRecorded`, `returningPersisted`, etc. |
| `summaries` | Parsed `conversationSummaries` (may be `null`) |
| `lastActivityAt` | From session row `updatedAt` |
| `baselineIntroSent` | Boolean |

### Dossier `meta` (return policy)

| Field | Description |
|-------|-------------|
| `lastBaselineCompletedAt` | Unix ms when attaché baseline last completed (handoff); used with time-away to decide stale baseline. |

### GET `/api/chat-state` extras

| Field | Description |
|-------|-------------|
| `sideTranscripts.philosophers` | Lumen/Umbra thread lines for a future folder UI (not main chat). |
| `returnClassification` | `{ returnCategory, timeAwayMs, needsBaselineRefresh, baselineReason, lastActivityAtIso }` when `ENABLE_RETURN_POLICY` is on. |
| `detectiveIntroSent` | Boolean |

## Maintenance

- Prefer editing **`api/storage/threadEvents.js`** for caps and API message mapping.  
- Bump `v` inside JSON blobs when making incompatible in-blob schema changes.
- Client recovery path can sync recovered local tails via `POST /api/chat-sync`.
