# xstate and frozen packet envelope: re-evaluation and integration plan

Status: proposal, revision 2. Supersedes the 2026-10-02 plan, which assessed `xstate` on its own and assumed `frontend/` layout work. Written 2026-10-04 against:

| Ref | Commit | Role |
| --- | --- | --- |
| `origin/main` | `ee4e004` | Production line. Four commits ahead of the shared ancestor (`AGENTS.md`, `.cursor/environment.json`). |
| `origin/xstate` | `6fd5098` | Integration branch. Ten commits ahead of `main`. Contains the xstate backend rewrite. |
| `origin/plan/frozen-packet-envelope` | `803697b` | New base. `xstate` plus three commits (restructure, "new working concept", the envelope plan). PR #4, now targeting `xstate`. |

Directives from the owner that shape this revision:

1. `plan/frozen-packet-envelope` is the base for all current and ongoing work. Its PR (#4) now targets `xstate`, not `main`.
2. Every assumption in the previous plan is re-evaluated, not carried over.
3. The hardening work in PR #3 (F-01, F-02, F-04, F-05 on the old `frontend/` layout) is scrapped for now. PR #3 is closed and its branch is kept for reference only.

Contents:

1. [Summary and recommendation](#1-summary-and-recommendation)
2. [Branch topology and PR flow](#2-branch-topology-and-pr-flow)
3. [What the new base is](#3-what-the-new-base-is)
4. [Status of the previous findings](#4-status-of-the-previous-findings)
5. [New findings on the base](#5-new-findings-on-the-base)
6. [Critical review of the envelope plan](#6-critical-review-of-the-envelope-plan)
7. [Integration plan](#7-integration-plan)
8. [Version-break checklist](#8-version-break-checklist)
9. [Decisions needed from the owner](#9-decisions-needed-from-the-owner)
10. [Appendix: evidence and how to reproduce it](#10-appendix-evidence-and-how-to-reproduce-it)

---

## 1. Summary and recommendation

The frozen-packet branch is the right base. It is not a competing design: it is `xstate` plus a restructure that already fixes several of the old blockers, plus a written plan for the prompt architecture. Combining the work is a matter of sequencing, not merging two codebases.

What the base fixes for free (verified, not assumed):

- The API deploys as a self-contained folder. `api/` was copied alone to a temp directory and `require("./index.js")` loaded (old F-01).
- One deploy workflow instead of two (old F-11). The `frontend/` tree is gone and ignored.
- The durable storage module is complete and wired into request handling (old F-03 was "truncated and dead").
- Personas for all four agents exist (old F-04, partly).

What is still wrong, and was reproduced on the base (details in sections 4 and 5):

- Spend controls do nothing. Defaults are 1,000,000. The daily counter has no writer. After 45 turns `GET /api/debug` shows `userExchangeCount 45`, `maxUserExchanges 1000000`, `dailyCount 0`.
- Durable storage breaks on real conversation sizes. The code budgets 800,000 and 900,000 characters for single table properties; Azure Table (and Azurite) reject strings over about 32,000 characters. In an end-to-end run with durable storage on, the server process died at turn 12 with `PropertyValueTooLarge`. On Azure Functions the same throw is a 500 after the LLM calls were already paid for.
- Lumen and Umbra still receive mock/placeholder text on every call (2 of the 3 to 4 LLM calls per turn).
- A client can overwrite its own stored transcript through `POST /api/chat-sync`.
- No CI. `api/package.json` lists test files by hand and omits one.
- The privacy notice promises deletion 24 months after last visit; there is no deletion code.

Recommendation:

1. Land PR #4 on `xstate` first, as a merge commit. It is a structural change plus a plan document; review it as such.
2. Run two tracks into `xstate`, all PRs targeting `xstate`:
   - Track H (hardening): CI and a shared fake-OpenAI test harness, then spend controls, then durable-storage correctness, then hygiene.
   - Track E (envelope): the five slices from the envelope plan, philosophers first, with the amendments in section 6.
3. Do Track H step 1 (CI and harness) before any Track E slice. The envelope's invariance tests need to run somewhere, and the harness lets them assert on the real HTTP payloads.
4. Release as one PR from `xstate` to `main`, after tagging `main` as `v1-legacy`.
5. XState stays. The envelope plan lists replacing it as out of scope, which closes the old "keep or replace" question.

## 2. Branch topology and PR flow

```
main:     0c23768 ---- 4 commits (AGENTS.md, .cursor/environment.json)
                \
xstate:          +-- 10 commits ---- 6fd5098
                                       \
plan/frozen-packet-envelope:            +-- efe3338 restructure
                                        +-- 5ba41f3 new working concept
                                        +-- 803697b envelope plan   (PR #4 -> xstate)
```

In words: `plan/frozen-packet-envelope` contains all of `xstate`. Its three extra commits are the restructure (`efe3338`, about 110 renames: `frontend/api/src/*` to `api/*`, `frontend/public/*` to `web/*`), "new working concept" (`5ba41f3`, concept doc and new web pieces such as the privacy notice and lab pages) and the plan (`803697b`).

PR flow:

| PR | From | To | State |
| --- | --- | --- | --- |
| #4 | `plan/frozen-packet-envelope` | `xstate` | Open. Retargeted from `main`. Diff against `xstate` is 276 files, +2795/-1276, mostly renames. |
| #3 | `cursor/xstate-deploy-and-spend-fixes-7b2f` | `xstate` | Closed. Branch kept. |
| #2 | `cursor/xstate-merge-plan-7b2f` | `main` | Open. This document. |
| future | `xstate` | `main` | The release PR. |

Merge checks:

- `plan/frozen-packet-envelope` into `xstate`: fast-forward-shaped (the branch contains `xstate`). No conflicts possible.
- `plan/frozen-packet-envelope` into `main` (trial `git merge-tree --write-tree`): one conflict, `AGENTS.md` (both branches added the file). Resolution is to keep `main`'s git rules and add the plan branch's layout section.
- PR #3 into the base: roughly 30 reported conflicts, nearly all because PR #3 edited `frontend/api/src/*` paths that the base renamed. This is why PR #3 is scrapped instead of rebased. Any idea worth keeping gets re-implemented on the new layout (see section 7).

## 3. What the new base is

Layout (from the base's `AGENTS.md`):

| Path | Role |
| --- | --- |
| `web/` | Static site (`app_location`). `js/{shared,chat,notes,philosophers,poem}`, `styles/`, `lab/`, `content/`, `data/`, `assets/`. |
| `api/` | Functions and all backend code (`api_location`). `agents/{attache,detective,philosophers,shared}`, `prompting/` (composer code), `prompts/` (model text), `dossier/`, `orchestration/`, `session/`, `storage/`, `lab/`, `contracts/`. |
| `server-dev.js` | Local Express. Serves `web/`, requires `api/`. |
| `archive/` | Legacy prompts moved out of the live tree. |

Rules the base adds: do not recreate `frontend/`; anything production requires must live inside `api/`; `api/prompts/` is model text and `api/prompting/` is code; `api/agents/shared/` is not a character.

Baseline behavior measured on the base (45 user turns against a fake OpenAI endpoint; full numbers in `plan-branch-audit.log`):

| Metric | Value |
| --- | --- |
| Upstream LLM calls for 45 turns | 153 (about 3.4 per turn) |
| Calls per detective turn | 3 structured (detective, Lumen, Umbra), plus a summarizer or dossier call about 0.6 times per turn (28 over 45 turns) |
| Attaché system prompt | Different on every one of 5 turns, 3.6 to 5.3 KB. This is the problem the envelope plan targets. |
| Detective system prompt | One distinct value over 40 turns, 7.9 KB |
| Lumen and Umbra system prompts | One distinct value each, 3.5 and 3.6 KB, both containing `[mock custom ...]` and "Placeholder ... Replace with real content" |
| History format | One flattened "Conversation history" user message, then the raw querent text (roles: system, user, user) |
| Tests | 131 pass via `npm test`; 133 pass via `node --test` (the hand-maintained list skips `dossierPresence.test.js`) |
| Browser smoke test | Landing, chat route, three exchanges, reload restores the transcript, no console errors (one expected 404 on `/api/debug` when debug is off) |

## 4. Status of the previous findings

| ID | Old finding | Status on the base | Evidence |
| --- | --- | --- | --- |
| F-01 | Contracts outside `api_location` crash the deployed API | Resolved by layout. Needs a CI guard so it cannot regress. | `api/` copied alone loads. Contracts are in `api/contracts/`. |
| F-02 | Spend limits disabled | Open. Now P-01. | See P-01. |
| F-03 | Durable state truncated and dead | Reframed. The module is complete and wired, but unsafe at real sizes. Now P-02. | See P-02. |
| F-04 | Unfinished prompts | Partly resolved. Personas exist. Mock text, placeholder files, custom prompt builders and a typo remain. Now P-03. | Lumen system prompt contains the mock block. |
| F-05 | Undecided feature changes (`philosopher-dialog`) | Mostly decided. Azure returns 410, dev server returns 404 (drift, P-06). | `curl` against both. |
| F-06 | No CI | Open. Now P-05. | `.github/workflows` has only the SWA deploy. |
| F-07 | xstate complexity | Closed as a decision: keep XState (envelope plan, "Out of scope"). Machines exist in 8 production files. | Search for `require("xstate")` under `api/`. |
| F-08 | Config and documentation drift | Open, larger. Now P-08. | See P-08. |
| F-09 | Dead and deprecated code | Partly open. Retired by envelope slices, not before. | `philosophersCustomPrompt.js`, `attacheCustomPrompt.js`, `detectiveCustomPromptDEPRECATED.js` still present. |
| F-10 | Stray files | Mostly resolved by the restructure. Two prompt files may be unreferenced (P-09). | `closing_instructions.md`, `narrative/stages.md`. |
| F-11 | Two deploy workflows | Resolved in the repo (one workflow). The second Static Web App resource may still exist in Azure. | Workflow list. |
| F-12 | Merge history not bisectable | Moot. The restructure rewrote paths; use a merge commit for PR #4 and keep history. | |
| F-13 | Dev surfaces exposed by flags | Reframed. Seed routes are not registered in Functions, but lab pages ship under `web/lab`. Now P-07. | |
| F-14 | LLM fan-out per turn | Still true and now measured (3.4 calls per turn). Now P-10. | Capture log. |

## 5. New findings on the base

Severity scale: Blocker (do not release), High (fix before release), Medium (fix before or soon after release), Low.

### P-01 (Blocker): spend and exchange caps are inert by default

Correction after building the harness (PR #5): the per-session exchange cap does work when `MAX_USER_EXCHANGES` is set. With a limit of 3, the fourth turn is still answered, then every later turn returns 204 with zero upstream calls. The daily cap is the part that is truly inert, and the defaults make both of them ineffective.

- `MAX_USER_EXCHANGES` and `MAX_DAILY_USAGE` default to 1,000,000 in `api/shared.js`. `.env.example` documents defaults of 5 and 100, which is wrong by four to five orders of magnitude.
- `incrementDailyUsage()` is defined in both stores and has no caller. `dailyCount` stayed at 0 after 45 turns.
- Counters are in-memory per process (`userExchangeCounts` is a `Map`). On Azure Functions a restart or a second instance resets them. They are not persisted by the durable checkpoint.
- Nothing bounds the number of sessions: an anonymous client can mint a new cookie per request.

Remediation (requirements; the design is to be done fresh, not ported from PR #3):

- Real defaults, enforced before any LLM call, with an HTTP 429 and `errorKind: "rate_limit"` that the UI renders.
- A daily budget that survives restarts and works across instances, or an explicit statement that the OpenAI-side hard budget is the real backstop and the in-app cap is best effort.
- A per-IP or per-cookie-minting limit, or an accepted risk written down.
- Tests that fail on the current code (cap reached means 429 and zero upstream calls).

### P-02 (Blocker): durable checkpoint exceeds Azure Table limits and failure is fatal

Reproduced on Azurite:

| Payload (characters) | Result |
| --- | --- |
| 1,000 and 20,000 | saved and hydrated |
| 40,000 and 100,000 | `400 PropertyValueTooLarge` ("32K characters or less") |
| 700,000 | `400 EntityTooLarge` |

- The code budgets `MAX_THREAD_JSON_CHARS=800000` and `ORCHESTRATION_RUNTIME_JSON_MAX_CHARS=900000` for single properties. Both are unreachable on real Azure Tables.
- End to end (durable on, checkpoint every turn, replies of about 1.5 KB): turns 1 to 11 returned 200, then the dev server process exited with an unhandled `RestError`. `saveSessionCheckpointToDurable` is awaited inside `handleChatRequest` with no try/catch, so any storage error fails the user's request after the model calls were made.
- When the orchestration blob is too large the writer stores `{truncated: true}`; the reader then silently skips restoring it, so the session resets without any signal.
- Checkpoints happen every 5 dirty turns or 5 minutes. With more than one instance, a turn handled by instance A and not yet checkpointed is invisible to instance B. `hydratedDurableSessions` means each instance hydrates a session once and never refreshes.
- Connection-string note: an `http://` Azurite string with explicit endpoints fails with "allowInsecureConnection is false". Only `UseDevelopmentStorage=true` worked.

Remediation:

- Split large values across numbered properties of at most 30,000 characters (or move bodies to Blob Storage and keep pointers in the table). Enforce a total per-entity budget below 1 MB, counting UTF-16.
- Make checkpointing non-fatal: catch, log, surface in telemetry, never fail the turn. Retry on the next turn.
- Replace the silent `truncated` path with an explicit, logged degraded mode.
- Decide the multi-instance contract: either checkpoint every turn (more writes, simpler) or accept and document the loss window.
- Persist the exchange counter alongside the session so P-01's per-session cap survives restarts.
- Run Azurite in CI and add a cold-restart test: run N turns, drop in-memory state, rehydrate, assert the next turn sees prior history.

### P-03 (High): the model still receives mock and placeholder text

- `philosophersCustomPrompt.js` emits `[mock custom lumen] voice=lumen` followed by the `*_prompts.md` file ("Placeholder for reusable prompt sections ... Replace with real content when LLM integration is enabled") on every Lumen and Umbra call.
- `attache_prompts.md` and `detective_prompts.md` are the same placeholder; they are not in the captured attaché and detective prompts, but they are still registered.
- `lumen_instructions.md` has the typo `lumnen_philosopher_notes` in the field list.

Remediation: stop sending the mock block in envelope slice 1 (philosophers) instead of leaving it for the final delete step. Add a registry test that fails on `[mock`, `Placeholder`, and stub-sized files. Fix the typo in the same slice. Delete the placeholder files when their registry fields are removed.

### P-04 (High): `POST /api/chat-sync` lets a client overwrite its transcript

With an ordinary session cookie, a request with `clientSeq: 9999` and one forged assistant message replaced the stored thread; the next `GET /api/chat-state` returned only `FORGED` with `serverSeq 9999`, and the result is checkpointed to durable storage.

The forged data feeds the restored UI and the persisted thread events, not the LLM history (that lives in `chat_history` maps), so this is an integrity problem, not a prompt-injection path. It still lets a client plant arbitrary text in "assistant" turns that the user later sees as authentic, and it defeats the session sequence number.

Remediation: either remove the endpoint (the server already retains history, `serverRetainsHistory: true`) or restrict it: cap message count and text length, only accept user-role content, never accept a sequence number more than one ahead, and never replace server-held assistant text.

### P-05 (High): no CI, and the test script drifts

- No workflow runs tests. The only workflow deploys.
- `api/package.json` lists 19 test files by hand. `dossier/dossierPresence.test.js` (2 tests) is not run by `npm test`.
- The Azurite round-trip test skips silently without env.
- Nothing asserts that `api/` is deployable on its own.

Remediation: a test workflow on pull requests to `xstate` and `main` (Node 20 and 22, `npm ci`, `node --test` with a glob, Azurite service for storage tests, an isolated-deploy check, a contract test). Keep deploy and test workflows separate.

### P-06 (Medium): dev server and Azure entry points drift

- `philosopher-dialog`: 404 on `server-dev.js`, 410 on `api/index.js`.
- `/api/debug` and the dev seed/lab endpoints exist only in `server-dev.js`; the client probes `/api/debug` and gets a 404 in production when debug is off (harmless, but noisy).
- `/api/config` is implemented twice, `createFileDailyUsageStore` and `createMemoryDailyUsageStore` behave differently (file store persists; memory store does not).

Remediation: move shared route bodies into `api/` handlers that both entry points call, and add a parity test that lists the routes of each.

### P-07 (Low): lab and notedebug pages ship to production

`web/lab/*.html` (including a 1,756-line scenario lab) are under `app_location`, so they deploy. The API routes they call are not registered in Functions, and `ALLOW_TEST_SEED` is only honored in `server-dev.js`, so the exposure is cosmetic, but it publishes internal tooling and prompt structure.

Remediation: exclude `web/lab` from the SWA artifact, or move it out of `web/`, or add an explicit decision to keep it.

### P-08 (Medium): configuration and documentation drift

- `.env.example` says `MAX_USER_EXCHANGES` defaults to 5 and `MAX_DAILY_USAGE` to 100 (code: 1,000,000), points at `api/src/logger.js` (path no longer exists), names `TIME_AWAY_MODERATE_*` while `docs/durable-user-state.md` names `TIME_AWAY_LONG_*` and `TIME_AWAY_STALE_*` with different defaults.
- `PROMPTS_DIR`, `AGENT_PROMPT_FILE` and `PHILOSOPHER_NOTES_FILE` are documented in `.env.example`; the first points at a folder layout that has changed and the others are not read.
- `docs/agent-prompt-construction.md` describes the system-string recipe that the envelope plan replaces.

Remediation: generate the variable table from `api/config.js`, and add a test that every key in `.env.example` is read somewhere in `api/` or `server-dev.js`.

### P-09 (Low): possibly unreferenced prompt files

`api/prompts/closing_instructions.md` and `api/prompts/narrative/stages.md` have no references in `api/` or `web/`. Confirm with the owner, then move to `archive/` or delete.

### P-10 (Medium): LLM fan-out per turn

153 calls for 45 turns. Lumen and Umbra are 80 of them and run on every detective turn. The envelope plan does not change the call count. If cost matters, options are: run the chorus on a subset of turns, combine Lumen and Umbra into one structured call, or use a cheaper model for them. This is a product decision (D-7) and does not block anything else.

### P-11 (High for slice 3): bank questions carry bracket tags

All 20 baseline-1 questions end with a bracket tag, for example `Do you dream about being interlinked? [interlinked]`. No code strips them. The envelope plan has the server stamp the question text verbatim into the reply, so the tag would be shown to the querent. Decide whether the tag is part of the liturgy or metadata (D-6). Baseline 1 also contains one duplicate string; the plan already says IDs must be index-stable.

### P-13 (High): a failed model call is shown to the querent as an internal diagnostic

Found while building the harness. When the provider call fails (reproduced with an HTTP 500 from the fake server), `POST /api/chat` still returns HTTP 200 and the reply text is the `[Mock LLM] attache ... Mock query (persona + instructions + turn schema + custom): attache_persona.md + attache_instructions.md ... LLM-safe state: {...}` block from `api/agents/shared/mockAgentTurn.js`. The querent sees prompt file names, state, and the user's own text echoed back, and no error is signaled (200, no `errorKind`). The same diagnostic is used when the model returns an empty `user_response`.

Remediation: on provider failure or an empty model reply, return a non-200 with `errorKind` from the contract (or an in-character retry line, per D-11), log the diagnostic server-side only, and keep the mock path behind `OFFLINE=1`. Tracked as a `todo` test in `api/test-support/knownDefects.test.js`.

### P-12 (High): the privacy notice promises deletion that does not exist

`web/content/privacy-notice.md` says conversation and session records are deleted 24 months after the last visit and logs are kept about 90 days. The durable store writes session rows (full thread events, orchestration state with chat histories) and dossiers (derived traits) and nothing ever deletes them (`rg deleteEntity` finds no match). Dossiers are keyed by user cookie for up to 400 days.

Remediation: a retention job (timer-triggered Function or table TTL strategy) matching the notice, a way to delete one user's rows by `edaUserId`, and a check that the notice and the code say the same thing. Also confirm the notice's processor list covers Azure.

## 6. Critical review of the envelope plan

The plan (`.cursor/plans/frozen_packet_envelope_16a5398b.plan.md`) is sound in direction and grounded in the code. Every existing path it names exists; the only missing paths are the new files it proposes. All six todos are `pending`, so this is a design, not an implementation.

What it gets right:

- It targets the measured problem: the attaché system prompt changes every turn; history is flattened into one user message; catalog bodies are 20 KB of JSON (attaché 10.9 KB, detective 9.5 KB) feeding turn tails.
- It keeps XState and keeps law in code (server-owned shuffle, server stamp, mercy flag), not in prompts.
- It sets the right tests (equality of composed system strings across states, not file hashes; envelope shape; "current utterance is not in history").
- It phases the delete behind retargeted lab and tests.
- Its authoring rule (every turn, room, visit, person, or code) is a usable review checklist.

Amendments recommended:

| ID | Amendment | Why |
| --- | --- | --- |
| A-1 | Define verbatim matching as a pure function with normalization (curly versus straight quotes, whitespace, bracket tags) and unit-test it with the real bank. | "user_response missing the line" is the trigger for the server stamp. A naive substring check will stamp duplicates or miss near matches. |
| A-2 | Add an opt-in eval set for `suspend_script`: scripted querent lines (distress, fatigue, done, frustration, mild reluctance, jokes) with expected true or false, run against a real model on demand, results saved. | Unit tests with fixtures prove the plumbing, not the judgment. The plan itself says the rarity lives in the instructions. |
| A-3 | Delimiter hygiene tests: querent text containing `---QUERENT---`, JSON, or instruction-like text must not change the packet. Packet fields come only from server state, never from request bodies. | The envelope puts model-facing state in the same message as raw user text. |
| A-4 | Bump the stored runtime version and drop old stored histories on deploy. | Stored `chat_history` entries from the flattened format would otherwise be replayed as native turns. `ORCHESTRATION_RUNTIME_V` exists for this. Combined with the greenfield-table note in `docs/durable-user-state.md`. |
| A-5 | Record `usage.prompt_tokens` and `prompt_tokens_details.cached_tokens` per call in the capture harness and compare before and after each slice. | The plan declares caching out of scope but relies on a stable prefix; the harness can show whether the prefix is actually reused. The baseline numbers in section 3 are the "before". |
| A-6 | Add "stop sending mock text" and "fix typo" to slice 1's acceptance criteria (P-03). | Otherwise slice 1 ships a frozen mock. |
| A-7 | Schedule the lab retarget as its own slice with its own tests, before deletion. | 18 files reference `TURN INSTRUCTIONS`, including the logger, two `*Prompts.js`, `llmPayloadPreview`, `chatScenarioPreview` and the 1,756-line `chat-scenario.html`. The plan calls it a rollout step but sizes it as one line. |
| A-8 | Keep the HTTP wire contract frozen across all slices and test it. | The plan does not touch `web/`; a contract test makes that a checked property. |
| A-9 | State the precedence between `summary` and `dossier_summary` in the packet. | Both appear in the detective and chorus packets; unclear which wins on conflict. |
| A-10 | Cap the history tail by characters as well as turns. | `HISTORY_TAIL_TURNS` is a name in the plan; it does not exist in code yet (`rg HISTORY_TAIL_TURNS` returns nothing), and a turn can be arbitrarily long. |

Risks to track:

- Large single PRs. The slices touch `promptComposer`, `buildChatCompletionMessages`, three `*Call.js` files, `chatService.js` (1,178 lines), and several tests. Keep each slice behind its own PR and keep `main`-bound behavior stable until the slice is complete.
- The attaché slice changes the structured output schema (`suspend_script`). Strict Structured Outputs need every key required; mock outputs and normalizers must change together.
- Model behavior change is the real risk of the whole plan. A frozen prompt with a pointer is a different task for the model than a rewritten prompt. Budget real-model trials per slice, not only unit tests.

## 7. Integration plan

Principles:

- All PRs target `xstate` until the release PR.
- Each PR is small enough to review alone and leaves `npm test` green.
- Harness and CI first, so every later PR is checked.
- No slice is merged without an updated baseline table (calls per turn, distinct system prompts, token counts).
- Sizes are described by what has to change, not by time.

### Phase 0: land the base

1. Review PR #4 as a structural change. Merge as a merge commit.
2. Resolve `AGENTS.md` once, in a follow-up: keep `main`'s git rules and add the base's layout section. Add the `.cursor/environment.json` and cloud setup that exist only on `main` to the release PR's checklist.
3. Record decisions D-1 and D-2 below.

Exit: `xstate` equals the base, PR #2 (this document) is in review.

### Phase 1: safety net (H1)

Status: implemented in PR #5 (`cursor/ci-test-harness-7b2f`, targeting `xstate`). CI is green on Node 20 and 22 with 167 tests, 9 of them `todo` defect markers.

Scope: `.github/workflows/test.yml`, `api/package.json` test script, a fake OpenAI test harness, an isolated-deploy check, a contract test.

- Replace the hand-maintained list with `node --test` over a glob; assert the count in CI so a file cannot disappear.
- Add the harness: a small fake OpenAI-compatible HTTP server under `api/test-support/` that generates schema-valid output from the request's `json_schema`, records every request, and lets tests set reply size. The probes used for this document are the starting point.
- Add the isolated-deploy check (copy `api/` alone, `require("./index.js")` with `OFFLINE=1`).
- Add a contract test: routes registered in `api/index.js`, response keys, 204 and 429 documented.
- Add Azurite as a service for storage tests and fail (not skip) in CI when it is unavailable.

Exit: CI green on PRs to `xstate`. The harness can print the baseline table from section 3.

### Phase 2: spend and abuse controls (H2; P-01, P-04)

- Requirements in P-01 and P-04. Decide D-3 and D-5 first.
- Tests: cap reached gives 429 with zero upstream calls; chat-sync cannot replace server-held assistant text.
- Update `.env.example` and the config docs in the same PR so the defaults can never drift again.

Exit: a 45-turn run against the harness stops at the configured cap.

### Phase 3: durable state correctness (H3; P-02, P-12 first half)

- Chunked or blob-backed values, non-fatal checkpoint, explicit degraded mode, persisted exchange counter, documented multi-instance contract, version bump (A-4).
- Cold-restart test against Azurite.
- Run the crash scenario from the audit as a regression test (long replies, checkpoint every turn).
- Retention: a deletion path and a scheduled purge matching the notice (D-4).

Exit: the end-to-end run with long replies completes 40 turns with durable storage on; restart then resume restores history.

### Phase 4: envelope slice 1, core and philosophers (E1)

Per the plan: `composeStaticSystemPrompt`, field registry (`packetRegistry.js`), `formatUserChannelMessage`, new `buildChatCompletionMessages` (system, native history, this-turn message), invariance tests. Applied to Lumen and Umbra first, with amendments A-3, A-5, A-6, A-8, A-10.

Exit: harness shows one distinct system prompt per chorus agent, no mock text, roles `system, user/assistant..., user`, wire contract unchanged, calls per turn unchanged.

### Phase 5: envelope slice 2, detective (E2)

Stage handbooks (`initial`, `middle`, `final`, return, close), packet flags, drop the live `# TURN INSTRUCTIONS` tail for the detective. Real-model trial of a full scripted session before merge.

### Phase 6: envelope slice 3, attaché (E3)

Needs D-6. Numbered bank with stable IDs, `ask_question_id`, `deliver_baseline_preamble`, `greeting_mode`, server stamp gated by `suspend_script`, schema and mock updates, amendments A-1 and A-2. This slice carries the most model-behavior risk; run the eval set before merge.

### Phase 7: envelope slice 4, helpers (E4)

Summarizer and dossier packets and prompts under `api/prompts/{summarizer,dossier}/`.

### Phase 8: lab, docs, deletion (E5)

Retarget `llmPayloadPreview`, `chatScenarioPreview`, `logger`, `chat-scenario.html` (A-7); rewrite `docs/agent-prompt-construction.md` with the ethos, nomos, mneme, kairos map; only then delete turn-tail assembly, custom prompt builders, catalogs, `SAFE_VIEW_KEYS` as a model payload. Remove the two shim files and the placeholder prompts.

### Phase 9: hygiene (H4; P-06 to P-09)

Shared route handlers and parity test; generated config table and `.env.example` test; exclude or relocate `web/lab`; resolve the two unreferenced prompt files; retire the second Static Web App resource if it still exists (D-8).

### Phase 10: pre-release verification

- Real OpenAI run, full scripted session per agent, token and cost per session compared with the baseline.
- Real Azure Tables: cold start, two instances, retention job.
- Browser check on desktop and mobile widths (the lab pages and note layout changed a lot in the base).
- Staging deployment of the SWA preview environment from the release PR.

### Phase 11: release

1. Tag current `main` as `v1-legacy`.
2. Open the `xstate` to `main` PR. The only trial-merge conflict is `AGENTS.md`, which Phase 0 already resolves on `xstate`.
3. Squash or merge commit per D-9. Tag `v2.0.0` and publish the version-break checklist.

### What can run in parallel

After Phase 1, Phases 2, 3 and 4 touch mostly different files (`shared.js` and `api/index.js`; `api/storage/*` and `chatService.js` export/restore; `api/prompting/*` and the philosopher agent files). `chatService.js` is the shared hot spot: land Phase 3's change to export/restore before Phase 4's history-format change, since A-4 depends on both.

## 8. Version-break checklist

For the `v2.0.0` notes. Items that changed from revision 1 are marked (new).

- HTTP API:
  - `POST /api/chat` returns `envelope` and `lumen*`/`umbra*` keys; the legacy `leftPhilosopher*`/`rightPhilosopher*` keys are not sent.
  - `GET /api/chat-state` is new. `POST /api/chat-sync` is new and is restricted or removed by D-5. (new)
  - `POST /api/philosopher-dialog` returns 410 on Azure (and 404 on the dev server until P-06 is fixed).
  - 204 means the session is past its final reply; 429 means a cap was hit. Both must be in the contract file.
- Layout (new): `frontend/` is gone. `web/` is the static app and `api/` is the whole backend. Any external link, script or doc pointing at `frontend/` breaks.
- Environment variables: removed `AGENT_PROMPT_FILE`, `PHILOSOPHER_NOTES_FILE`; changed meaning or default for `MAX_USER_EXCHANGES`, `MAX_DAILY_USAGE`; added `DURABLE_STORAGE_MODE`, `AZURE_STORAGE_CONNECTION_STRING`, `DOSSIER_TABLE_NAME`, the `TIME_AWAY_*` family, `ENABLE_RETURN_POLICY`, `ALLOW_TEST_SEED`, `DEBUG_STATE_LEVEL`, `DEBUG_PROMPTS_LEVEL`, `OPENAI_TIMEOUT_MS`.
- Prompts: model text lives in `api/prompts/<agent>/`; composer code in `api/prompting/`. After the envelope slices the system prompt is the same on every turn and per-turn state is a JSON packet after which the querent text follows `---QUERENT---` (new).
- Model-visible history is native `user` and `assistant` messages instead of one flattened block (new).
- Storage (new): schema is greenfield. Recreate the table; sessions and dossiers from v1 and from any pre-release build do not carry over. Retention follows the privacy notice.
- Cost: still several LLM calls per detective turn (3.4 measured) unless D-7 changes it. Caps are real after Phase 2.
- Frontend: files renamed under `web/js/<area>/`; deploy uses `app_location: web`, `api_location: api`.

## 9. Decisions needed from the owner

Already decided by the directives: the frozen-packet branch is the base (D-0); PR #4 targets `xstate`; PR #3 is closed; XState stays (the envelope plan scopes its replacement out).

| ID | Decision | Recommendation |
| --- | --- | --- |
| D-1 | Merge style for PR #4 | Merge commit, to preserve the rename history across the restructure. |
| D-2 | Keep Track H (hardening) as its own PRs before the envelope slices | Yes. CI and the harness first; the remaining hardening can overlap with slice 1. |
| D-3 | Cap values and unit | Per-session cap high enough for the baseline plus a real conversation (about 40 exchanges); daily cap counted in user turns, not LLM calls; both app settings. Re-tune after Phase 10 measurement. Decide whether the daily cap is global or per user. |
| D-4 | Durable storage shape and retention | Chunked table values for now, Blob later if rows keep growing. Retention exactly as the privacy notice says (24 months, delete-by-user path). |
| D-5 | Keep or remove `POST /api/chat-sync` | Remove it unless an offline-first client feature needs it; the server already retains history. |
| D-6 | Bracket tags on baseline-1 questions: shown to the querent or stripped | Treat as metadata and strip in the bank builder, unless they are intentional liturgy. |
| D-7 | Reduce the per-turn chorus calls | Defer. Revisit with real cost numbers from Phase 10. |
| D-8 | Which Static Web App is production, and retire the other | Confirm; delete the unused SWA resource and its token secret. |
| D-9 | Release PR style | Squash with a detailed description and changelog, since slices will have been reviewed individually. |
| D-10 | Keep lab pages in the production artifact | No. Exclude or relocate them. |
| D-11 | What the querent sees when the model call fails (P-13) | A short in-character line with an error status and `errorKind`, so the UI can offer a retry; diagnostics stay in server logs. |

## 10. Appendix: evidence and how to reproduce it

Artifacts from this revision (in `/opt/cursor/artifacts/`): `plan-branch-audit.log` (all numbers in sections 3 to 5) and `plan-branch-chat-smoke.webp` (chat UI on the base).

Commands used, from a worktree of `origin/plan/frozen-packet-envelope` (`git worktree add /tmp/pk origin/plan/frozen-packet-envelope --detach`):

- Branch relationship: `git merge-base`, `git log --oneline origin/xstate..origin/plan/frozen-packet-envelope`, `git diff --stat origin/xstate...origin/plan/frozen-packet-envelope`.
- Merge checks: `git merge-tree --write-tree --name-only` for the base into `main` (one conflict, `AGENTS.md`) and for PR #3's branch into the base (roughly 30 conflicts).
- Tests: `cd api && npm ci && npm test` (131 pass, 1 skipped), `node --test` (133 pass, 1 skipped).
- Deploy isolation: copy `api/` to a temp directory and run `node -e 'require("./index.js")'` with `OFFLINE=1`.
- Behavior and payloads: a fake OpenAI-compatible server (`OPENAI_BASE_URL=http://127.0.0.1:4999/v1`) that returns schema-valid JSON and records each request; `server-dev.js` driven with 45 `POST /api/chat` calls through a cookie jar; request bodies grouped by `response_format.json_schema.name`.
- Caps: `GET /api/debug` with `DEBUG_LOGS=1` after the run. Exchange cap with `MAX_USER_EXCHANGES=3`: turns 1 to 4 answered, turn 5 onward 204 with no upstream calls.
- chat-sync: `POST /api/chat-sync` with `{"clientSeq":9999,"messages":[{"role":"assistant","text":"FORGED"}]}`, then `GET /api/chat-state`.
- Table limits: Azurite (`npm i azurite`, `azurite-table`), `UseDevelopmentStorage=true`, `saveSessionCheckpoint` with increasing payloads.
- Crash: `DURABLE_STORAGE_MODE=azurite SESSION_CHECKPOINT_EVERY_K_TURNS=1` with 1.5 KB replies, 30 sequential chat requests.
- Question bank: parse `api/prompts/attache/attache_questions.json` (20, 27, 24 questions; one duplicate; 20 of 20 baseline-1 entries end with a bracket tag).
- Browser: Chrome against the dev server on the base: landing, chat route, three exchanges, reload restores the transcript.
- Privacy and retention: `web/content/privacy-notice.md` section 8 versus `git grep -nE "deleteEntity|purge|retention" -- api` (no match).

Limits of this evidence: all LLM behavior was observed through a fake endpoint, so nothing here measures model quality or real token cost. Azure behavior was observed on Azurite, which enforced the same property-size limits as the service documents. Multi-instance behavior was reasoned from the code, not run.
