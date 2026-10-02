# xstate branch: assessment and merge plan

Status: proposal. Written 2026-10-02 against `origin/xstate` @ `6fd5098` and `origin/main` @ `ee4e004`.

This document records what the `xstate` branch does, every problem found while reviewing it, the recommended remediation for each, and a detailed implementation plan for landing it on `main` as a major version (`v2.0.0`).

Contents:

1. [Summary and recommendation](#1-summary-and-recommendation)
2. [What the branch is](#2-what-the-branch-is)
3. [Merge vs cherry-pick](#3-merge-vs-cherry-pick)
4. [Findings and remediation](#4-findings-and-remediation)
5. [Implementation plan](#5-implementation-plan)
6. [Version-break checklist](#6-version-break-checklist)
7. [Decisions needed from the owner](#7-decisions-needed-from-the-owner)
8. [Appendix: how the evidence was gathered](#8-appendix-how-the-evidence-was-gathered)

---

## 1. Summary and recommendation

`xstate` is a ground-up rewrite of the chat backend (plus a frontend reorganization) that is 10 commits and 209 files ahead of `main`. `main` has not diverged in any way that matters (four commits, only `AGENTS.md` and `.cursor/environment.json`), so a merge is conflict-free.

It is not safe to merge as-is. Review found 6 blockers or high-severity problems, the most serious being that the API would crash on startup when deployed through the current Azure Static Web Apps (SWA) workflow, and that all spend limits are effectively disabled.

Recommendation:

- Do not cherry-pick commit by commit. The commits are not independently applicable (see section 3).
- Harden the branch in small PRs targeting `xstate`, then land it on `main` in one step and tag `v2.0.0`. Tag the current `main` as `v1-legacy` first, as the rollback point.
- Keep the xstate-versus-pure-functions question out of the merge. Decide it afterwards (Phase 9), once durable persistence exists and there is evidence either way.

Note on the "undo plan": there is no committed plan to remove xstate or the custom prompt builders. The closest artifact is `frontend/api/src/attache/attacheOrchestrator-plan.md`, added in the same commit as xstate (`779df05`). It describes a pure `transition(state, intent)` function, which `attacheMachine.js` now wraps in an xstate machine. The custom prompt builders are already being retired in the branch itself (see F-09). If a separate undo plan exists, it is not in the repository.

## 2. What the branch is

### 2.1 Commit history (since the branch point `0c23768`)

| Commit | Date | Subject | Notes |
| --- | --- | --- | --- |
| `e923e38` | 03-07 | improved note styling | frontend only |
| `3d5c7a8` | 03-10 | feat: llm api refactor | prompts moved/split, 3 `api/src` files |
| `c69e5d2` | 03-10 | new config notes | docs only |
| `e08b35c` | 03-11 | fixes note horiz placement issues, adds baseline | frontend + prompts + server |
| `63b3a2f` | 03-12 | new orchestrator | 17 new `api/src` files, adds xstate dependency |
| `5454199` | 03-13 | new attache | prompts, assets |
| `779df05` | 03-31 | xstate refactor | 114 files: frontend renames and backend rewrite together |
| `309c352` | 04-05 | feat: new xstate approach thru | 112 files, rewrites most of the prior commit's prompt files |
| `54c0922` | 04-07 | feat: adds chat scenario lab | dev lab, contract JSON |
| `6fd5098` | 04-07 | feat more stateful attache | attache machine |

Other branches: `new-attache` is fully contained in `xstate`. `mid-media` has one commit (`d9c802e`, "mess of a orchestrator") that is not in `xstate` and appears abandoned.

### 2.2 Architecture

`main` today: one 954-line `frontend/api/shared/index.js`, a single system prompt (`prompts/prompt.md`), one LLM call per turn, an optional philosopher "self-dialog" side channel, closers after a fixed number of exchanges, and no tests.

`xstate`:

- Backend is modular under `frontend/api/src/`: `agents/`, `attache/`, `detective/`, `philosophers/`, `orchestration/`, `prompts/`, `dossier_and_summarize/`, `session/`, `storage/`, plus `chatService.js`, `config.js`, `logger.js`.
- Agents: Attaché (scripted baseline questions), Detective (the main therapist voice), Lumen and Umbra (margin philosophers).
- Prompts are composed per turn by `prompts/promptComposer.js` from persona + instructions + JSON catalogs (`prompt_catalog.json` per agent) + a per-turn tail, with structured-output schemas per agent.
- Orchestration:
  - `orchestration/chatMachine.js` is a parallel xstate machine with regions `dossier`, `visit` (time-away tiers) and `agent` (attaché vs detective, each an invoked child machine).
  - `attache/attacheMachine.js` wraps a pure `transition()` function.
  - `detective/detectiveMachine.js` handles the detective policy.
- Additional features: dossier and summarization of the user, time-away classification (brief, moderate, long, stale) that can force a re-baseline, a closure sequence (penultimate and ultimate replies), a shared HTTP contract (`frontend/contracts/`), and a dev scenario lab (`/dev/chat-scenario.html`, gated by `ALLOW_TEST_SEED`).
- Frontend: all `public/js` files renamed to a `area.name.js` convention, new `chat.send.js` and `chat.route.js`, new response shape (`envelope`, `lumen*` / `umbra*` keys, `GET /api/chat-state`).
- Tests: 131 passing under `node --test` (`cd frontend/api && npm test`). `main` has none.

### 2.3 What works

- 131 of 131 tests pass.
- A local run with `OFFLINE=1` walks correctly through attaché phases (`start`, `baseline1_q0`, `baseline1_q1`, `baseline2_q0`) and `/api/chat-state` reports consistent counters.
- The branch adds only about 4 MB of new git blobs (359 blobs); the asset renames are 100% similarity, so there is no repository bloat.

## 3. Merge vs cherry-pick

### 3.1 Options considered

| | Merge as-is | Cherry-pick commits | Harden then merge (recommended) |
| --- | --- | --- | --- |
| Conflicts | none | frequent (same files rewritten across commits) | none |
| Result is coherent | yes | no: intermediate states do not run | yes |
| Ships the blockers in section 4 | yes | depends | no |
| Keeps tests and history | yes | partially | yes |
| Review burden | one 23k-line PR | many partial PRs | many small PRs into `xstate`, then one merge |

### 3.2 Why not cherry-pick

- `779df05` (114 files) mixes the frontend renames with the backend rewrite. `309c352` (112 files, 6,291 deletions) then rewrites most of the prompt files that `779df05` added. Neither can be applied alone.
- `main`'s backend is a single file that is entirely replaced. "What we need" from `api/src` is nearly all of it, so cherry-picking is really "take everything, then delete".
- Frontend and backend are coupled in both directions:
  - New frontend needs `envelope`, `lumen*` / `umbra*` keys and `GET /api/chat-state`.
  - Old frontend expects `leftPhilosopher*` keys and calls `/api/philosopher-dialog`, which now returns 410.
- The only cleanly separable slice is the early visual commits (`e923e38`, `e08b35c`). They are small, and landing them separately has little value because they ship in the same release anyway.

### 3.3 Why not merge as-is

Findings F-01 to F-06 below. In short: deploy crash, no spend limits, non-durable state, unfinished prompts.

## 4. Findings and remediation

Severity: **Blocker** (must fix before merge), **High** (fix before merge unless explicitly waived), **Medium** (fix before release or schedule right after), **Low** (cleanup).

### F-01 (Blocker): API crashes on startup when deployed through SWA

Evidence:

- Both workflows (`.github/workflows/azure-static-web-apps.yml` and `...-green-desert-063e5891e.yml`) deploy with `api_location: "frontend/api"`, so only that folder reaches the Functions host.
- `frontend/api/src/chatService.js:9` and `frontend/api/src/shared.js:15` require `../../contracts/chatApiContract`, which resolves to `frontend/contracts/`, outside the deployed folder.
- Reproduced: copying only `frontend/api` to a temp directory and running `require("./src/index.js")` fails with `Cannot find module '../../contracts/chatApiContract'`.

Remediation:

- Move `frontend/contracts/` to `frontend/api/contracts/` and update the two requires, the `contracts` path in `frontend/server.js` (route `/contracts/chat-http.contract.json`), and the comment references in `chatMachine.js`, `chat.route.js` and the contract file itself.
- Add an isolation check (`npm run test:isolated`) that copies `frontend/api` alone to a temp directory, runs `npm ci --omit=dev`, and requires `src/index.js` with `OFFLINE=1`. Run it in CI so this class of bug cannot return.

### F-02 (Blocker): spend limits are effectively disabled

Evidence:

- `frontend/api/src/shared.js:28-29`: `MAX_USER_EXCHANGES` and `MAX_DAILY_USAGE` default to `1_000_000` (on `main` they are 5 and 100). `docs/DEPLOY-AZURE-SWA.md` and `frontend/.env.example` still document 5 and 100, so docs and code disagree.
- `dailyUsageStore.incrementDailyUsage()` is never called, and `dailyUsage` is never compared against `maxDailyUsage` anywhere in the chat path. It is only echoed in the debug body. The daily cap does nothing.
- Cost per turn is higher than on `main`. Each detective turn fires 3 parallel LLM calls (detective, Lumen, Umbra), plus a dossier refresh every `DOSSIER_REFRESH_EVERY_N_DETECTIVE_TURNS` (default 3) turns, plus summarization. `main` makes 1 call per turn.

Remediation:

- Choose real defaults (see decision D-1) and apply them in `shared.js`, `.env.example` and the docs.
- Enforce the daily cap in `shared.handleChatRequest` before any LLM work: if `dailyUsage >= MAX_DAILY_USAGE`, return HTTP 429 with the existing "Daily system limit reached" message. Increment the counter once per turn that reaches the LLM. Make the unit explicit (per turn or per LLM call; recommended per turn, with the per-turn LLM fan-out documented).
- In Azure the in-memory store is per instance, so a real daily cap needs the shared store from F-03. Until then, document it as best-effort.
- Add tests: cap reached returns 429 without calling the LLM client; counter increments exactly once per turn; exchange cap triggers the penultimate and ultimate closure replies and then 204.
- Optional cost reduction, tracked separately (F-14).

### F-03 (Blocker): session state is in-memory only, and the durable path is broken

Evidence:

- All session state is module-level `Map`s: `persistedSnapshotBySessionId` in `chatMachine.js`, eight maps in `chatService.js` (attaché session, dossier, detective/Lumen/Umbra histories, narrative snapshots, turn counts), two in `shared.js`, and two in `detectiveExistentialSession.js`. On Azure Functions (serverless, scale to zero, multiple instances) this state is lost on cold start or when requests hit another instance. Users would be re-baselined mid-conversation.
- `frontend/api/src/storage/durableTableStorage.js` is truncated: it ends mid-function after `await ensureTable(client);` and fails with `SyntaxError: Unexpected end of input`. It is not required by anything, and it references an undefined `isUsableMainStateSnapshot` and a nonexistent `require("../dossier")`.
- `frontend/server.js:104` calls `shared.reloadSessionFromDurable`, which does not exist. `ENABLE_DURABLE_STORAGE` and `AZURE_STORAGE_CONNECTION_STRING` are documented but do nothing.

Remediation (recommended: implement it, rather than documenting the limitation):

- Introduce a `SessionStore` interface (`load(sessionId)`, `save(sessionId, state)`, `reset(sessionId)`) with two implementations: in-memory (default, used by tests and local dev) and Azure Table Storage.
- Gather the per-session state behind one serializable `SessionState` object. The xstate snapshots are already JSON-serializable through `getPersistedSnapshot()`.
- In `chatService.composeChatResponse`, load at the start of the turn and save at the end. Replace the module-level Maps by reads and writes on that object.
- Table Storage limits: 64 KiB per string property and about 1 MB per entity. Store large fields (histories, dossier) chunked across properties or move them to Blob Storage. The existing truncation constants (`MAX_DETECTIVE_HISTORY_CHARS`, `MAX_THREAD_JSON_CHARS`) in config and `.env.example` give a starting point.
- Move the daily usage counter to the same store (see F-02).
- Delete the broken `durableTableStorage.js` and write the new module with tests against a fake table client. Optionally run an Azurite integration test in CI.
- Gate with `ENABLE_DURABLE_STORAGE`. Fix the `server.js` hook so local dev and Azure use the same code path.
- If this is waived for the first release, then at minimum: document the limitation prominently in `DEPLOY-AZURE-SWA.md`, remove the dead flag and code, and keep a tracked follow-up. This is not recommended for a public site.

### F-04 (High): prompts are unfinished

Evidence:

- The live detective persona, `prompts/detective/detective_persona.md`, is a 2-sentence stub (275 bytes). The full persona is in `prompts/detective/detective_persona copy.md` (4.4 KB) and the root-level `prompts/detective_persona.md`. `config.js` loads only the stub.
- `prompts/lumen/lumen_prompts.md` and `umbra/umbra_prompts.md` (and the attaché and detective equivalents) are placeholders ("Replace with real content when LLM integration is enabled").
- `philosophers/philosophersCustomPrompt.js` prepends a literal `[mock custom lumen] voice=lumen` plus the placeholder file to the `custom` segment of the real system prompt. In `chatService.js` the result goes into `composeAgentPrompt`, so the mock text reaches the model.

Remediation:

- Restore the intended detective persona into `detective/detective_persona.md` (compare against `main`'s `prompt.md` and the `copy` files to pick the final text), and make the registry the only source.
- Decide whether `promptsPath` files are part of the design. If yes, write real content. If no, remove `promptsPath` from the registry and `buildPhilosophersCustomPrompt`, and pass no `custom` for Lumen and Umbra until the philosophers machine produces a real tail (the code comment already states this as the target).
- Add a registry validation test (extend `validatePromptRegistry`, strict under `NODE_ENV=test`): fail if any persona is under a minimum length, or if any loaded prompt text contains "Placeholder" or "[mock".

### F-05 (High): default behaviors and features changed without a decision

Evidence:

- `POST /api/philosopher-dialog` returns 410 and the frontend no longer calls it, but the README still lists it ("side-channel lore").
- `easter_egg_prompt.md` was deleted. A comment in `chatService.js` says the post-ultimate easter egg line is "not implemented yet".
- Closers (`closers.md`, fixed number of exchanges) were replaced by the closure phase mechanism.
- `main` capped sessions at 5 exchanges before closers. With the attaché baseline in front, the right number needs a new choice (decision D-1).

Remediation: record an explicit keep, drop or reimplement decision for each (decision D-2), then update the README, API docs and contract accordingly. Remove dead code paths for anything dropped (route, contract fields, frontend remnants).

### F-06 (High): no CI runs the tests

Evidence: the only workflows are the two SWA deploy workflows. Tests exist only on `xstate` and are never run automatically. The `test` script in `frontend/api/package.json` lists test files by name, so new tests are silently skipped.

Remediation:

- Add `.github/workflows/test.yml`: on pull requests and pushes, run `npm ci` and `npm test` in `frontend/api`, plus the isolation check from F-01.
- Change the test script to a glob (`node --test "src/**/*.test.js"`) so new tests are always picked up.
- Make the check required before merge to `main`.

### F-07 (Medium): in-memory orchestration plus xstate adds complexity without durability benefit

Evidence:

- xstate is imported in 9 files, about 2k lines (`chatMachine`, `attacheMachine`, `detectiveMachine`, `philosophersMachine`, `attacheOrchestratorAdvance`, `detectiveExistentialSession`, `orchestrationLabSnapshot`, `detectivePromptPolicyMachine`, `chatService`).
- The real logic is already pure: `transition()` in `attacheMachine.js`, plus the policy functions in `attachePromptPolicy.js` and `detectivePromptPolicy.js`. Persistence is a `Map`, so xstate's persisted-snapshot benefit is unused until F-03 lands.
- There is migration code for old snapshots (`migrateAttacheOrchestratorMachineSnapshot`, `migratePersistedChatSnapshotAttacheOrchestrator`) and large `@xstate-layout` blobs in the machine files. Both are maintenance cost with no users yet, since nothing is persisted across deploys.
- Benefits that are real: the Stately visualizer and tags and meta, parallel regions that model dossier x visit x agent routing, and 131 tests, including `chatMachine.persist-invoke.test.js`.

Remediation: do not change this as part of the merge. Evaluate in Phase 9 (keep versus replace with pure functions, as `attacheOrchestrator-plan.md` proposes). Drop the snapshot migration shims before release if no persisted snapshots from older builds can exist (they cannot today).

### F-08 (Medium): configuration and documentation drift

Evidence:

- `frontend/.env.example`, `docs/CONFIGURATION.md`, `docs/AZURE-SWA-STRUCTURE.md` and `frontend/DEPLOY-AZURE-SWA.md` still reference `prompt.md`, `closers.md`, `easter_egg_prompt.md`, `AGENT_PROMPT_FILE` and `PHILOSOPHER_NOTES_FILE`, none of which the new code reads.
- `frontend/package.json` `dev` script watches `api/prompts/prompt.md` and `closers.md`, which no longer exist, so prompt edits do not trigger reloads.
- Defaults documented as 5 and 100 are 1,000,000 in code (F-02).
- `.gitignore` gained `.env*`, which also matches `.env.example` (already tracked, but any new example env file would be silently ignored). It also lists a stray `frontend/api/src/.env_the_wrongone`.
- `frontend/api/.gitignore` was deleted.
- README describes `main`'s architecture and API surface.

Remediation: rewrite these to match the code (see Phase 6). Use `.env*` plus an explicit `!.env.example`. Update the `dev` script to watch `api/prompts` and `api/src`.

### F-09 (Medium): deprecated and dead code

Evidence:

- `attache/attacheCustomPrompt.js` ("Legacy helper") and `detective/detectiveCustomPromptDEPRECATED.js` are thin wrappers over `turnBuilderRegistry.buildAgentTurn` and are not used by the main flow (`detective` one has no callers).
- `philosophers/philosophersMachine.js` exports a `@deprecated` alias `philosophersMachine`.
- `philosophers/philosophersCustomPrompt.js` is a mock (F-04).
- `index.js` keeps a 410 route for a removed endpoint (F-05).

Remediation: delete the dead shims and aliases after confirming no callers (`rg` plus tests), and fold the live pieces into `prompts/turnBuilderRegistry.js` (extend `TURN_BUILDERS` with `lumen` and `umbra`).

### F-10 (Low): stray files

Evidence: `prompts/detective_persona copy.md`, `prompts/detective/detective_persona copy.md`, `prompts/detective/detective_instructions copy.md`, `public/data/object-config copy.json`, duplicate root-level `prompts/detective_persona.md` and `prompts/lumen_persona.md`, and `attache/attache_instructions_alt.md` (6 KB, unreferenced; verify).

Remediation: after F-04 settles the canonical text, delete the copies and duplicates. Keep anything still referenced by the registry or lab.

### F-11 (Medium): two deploy workflows target two Static Web Apps

Evidence: both workflows run on push and pull request to `main` with different deploy tokens (`AZURE_STATIC_WEB_APPS_API_TOKEN` and `AZURE_STATIC_WEB_APPS_API_TOKEN_GREEN_DESERT_063E5891E`). One uses `skip_app_build: true` and the other `output_location: "."`.

Remediation: confirm which Static Web App is the live site and whether the second is a leftover. Keep one workflow. This matters because the merge triggers a production deploy on every configured target, and because pull requests create preview environments that Phase 7 uses.

### F-12 (Medium): the merge history is not bisectable

Evidence: the two mega-commits (`779df05`, `309c352`) mix unrelated work, and the second rewrites the first.

Remediation: land with a squash merge (or a merge commit), and write a thorough PR description plus a `CHANGELOG`/release note, since the history will not explain the change.

### F-13 (Low): dev surfaces exposed by flags

Evidence: `/api/dev/*` routes in `server.js` are gated by `ALLOW_TEST_SEED`, and `DEBUG_LOGS` echoes debug info and full prompts into logs and responses. Both are off by default.

Remediation: keep them off by default. Add a startup guard that refuses to start with `ALLOW_TEST_SEED=1` when `NODE_ENV=production`, and document that Azure app settings must not set it.

### F-14 (Optional): LLM fan-out per turn

Evidence: 3 parallel calls per detective turn (F-02).

Remediation options, to be decided after cost measurement in Phase 7:

- Merge Lumen and Umbra into one structured call with two output sections.
- Call the philosophers only on a fraction of turns (a server-side rate, like the client-side interaction rates on `main`).
- Use a smaller model for the philosophers via a per-agent model setting.

## 5. Implementation plan

Working rules:

- All work happens on branches named `cursor/<descriptive-name>`. Hardening PRs target `xstate`, not `main`. Only the final PR targets `main`.
- One commit per logical change, one PR per phase (or finer where noted).
- Each phase has an exit check. Do not start dependent phases before the exit check passes.
- Nothing is pushed, merged, tagged or deployed without the owner's go-ahead (see `AGENTS.md`).

Dependency order: Phase 0, then 1 and 2 (in parallel with 6), then 3, then 4 and 5, then 7, then 8. Phase 9 comes after the release.

### Phase 0: safeguards and decisions

1. Resolve the decisions in section 7 that gate later phases (D-1, D-2, D-3 minimum).
2. Tag current `main` (`ee4e004` or later) as `v1-legacy`. This is the rollback point; record the Azure app settings currently in production.
3. Confirm which Static Web App is live (F-11) and what its app settings are. Note any that the new code ignores or needs.
4. Create the integration branch policy: branch protection on `xstate` is optional, but all hardening PRs target it.

Exit check: tag exists, decisions recorded in this document (update section 7), live SWA identified.

### Phase 1: make the API deployable (F-01, F-06)

1. Move `frontend/contracts/` to `frontend/api/contracts/` (use `git mv`).
2. Update requires in `chatService.js` and `shared.js`; update `server.js` `/contracts/...` route; update comments and docs that mention the old path.
3. Add `frontend/api/scripts/check-isolated.js` and `npm run test:isolated`: copy `frontend/api` (excluding `node_modules`) to a temp directory, install production dependencies, set `OFFLINE=1`, require `src/index.js`, and exit non-zero on any error.
4. Switch the `test` script to `node --test "src/**/*.test.js"` and confirm the count is at least 131.
5. Add `.github/workflows/test.yml` (Node 20 or 22): `npm ci`, `npm test`, `npm run test:isolated`, triggered on `pull_request` and `push`.
6. Update the contract test, if one exists, or add one that loads the JSON from its new location.

Exit check: CI is green, and the isolation check fails if the contract is moved back out (verify by temporarily reverting).

### Phase 2: spend controls (F-02, F-13)

1. Apply decision D-1 (defaults for `MAX_USER_EXCHANGES`, `MAX_DAILY_USAGE`) in `shared.js`; make the parsing consistent (`parseInt` with a fallback, not `Number(x || 1_000_000)`).
2. In `shared.handleChatRequest`: read the daily count; if at or above the cap, return 429 before calling `composeChatResponse`; after a turn that used the LLM, increment the daily count. Remove the dead `readDailyUsage`-only plumbing or make it real.
3. Return the 429 body in the shape the contract (`ChatPostErrorBody`) defines and make the frontend show it (check `chat.send.js` handling of non-200 responses).
4. Verify the exchange cap path end to end: penultimate reply, ultimate reply (`closureUltimate: true`), then 204.
5. Add the production guard for `ALLOW_TEST_SEED` and a one-line startup log of the effective caps and model.
6. Tests: cap reached returns 429 with no LLM call (stub client asserts zero calls); counter increments once per turn; closure sequence; guard throws under `NODE_ENV=production`.
7. Correct `.env.example` and `docs/DEPLOY-AZURE-SWA.md` defaults.

Exit check: new tests pass; with a stub LLM client, a scripted session of N+3 messages produces the expected statuses and exactly the expected number of LLM calls.

### Phase 3: durable session state (F-03)

This is the largest phase. Split it into reviewable PRs.

3a. Inventory and interface

1. List every per-session Map and the functions that read and write it (start with the `new Map()` hits in `chatMachine.js`, `chatService.js`, `shared.js`, `detectiveExistentialSession.js`).
2. Define `SessionState` (plain JSON) and a `SessionStore` interface. Provide `createMemorySessionStore()`.
3. Refactor the code to read and write one `SessionState` per turn (load at start, save at end, with the machine snapshots stored inside it). Behavior must not change: the 131 existing tests must still pass without edits other than setup helpers.

3b. Table Storage implementation

4. Delete `storage/durableTableStorage.js`. Write `storage/tableSessionStore.js` on `@azure/data-tables` (already a dependency).
5. Entity design: `PartitionKey = "EDA_session"`, `RowKey = sessionId`; scalar fields as properties; large fields (`histories`, `dossier`, snapshots) chunked into numbered string properties under the 64 KiB limit, or moved to Blob if the 1 MB entity limit is a risk. Add optimistic concurrency with ETags to avoid lost updates from concurrent requests on one session.
6. Daily usage counter: `PartitionKey = "EDA_usageDaily"`, `RowKey = YYYY-MM-DD`, updated with ETag retry.
7. Wire `ENABLE_DURABLE_STORAGE` plus `AZURE_STORAGE_CONNECTION_STRING` and `DOSSIER_TABLE_NAME` to select the store. Fix `server.js` to use the same factory (remove the `reloadSessionFromDurable` reference).
8. Failure handling: if the store is unavailable, fail the turn with a clear 503 rather than silently falling back to memory (silent fallback causes the re-baseline bug).
9. Add session expiry or cleanup (TTL by last activity, or a documented manual purge).

3c. Tests

10. Unit tests with a fake table client: round trip, chunking, ETag conflict retry, oversize handling.
11. Contract test: the same suite of turn-level tests runs against the memory store and the fake table store.
12. Optional CI job with Azurite for an integration run.

Exit check: a two-process test (or a test that clears all in-memory module state between turns) continues a session correctly across turns; the isolation check and all tests pass.

### Phase 4: prompts and agents (F-04, F-09, F-10)

1. Choose canonical persona text for the detective (and confirm the attaché, Lumen and Umbra personas) by diffing the stub, the `copy` files, the root-level files and `main`'s `prompt.md`. Write the result into the registry paths.
2. Remove `buildPhilosophersCustomPrompt` and its mock text, or give it real content, per D-4. Add `lumen` and `umbra` to `TURN_BUILDERS`.
3. Delete the deprecated shims (`attacheCustomPrompt.js`, `detectiveCustomPromptDEPRECATED.js`, the deprecated alias in `philosophersMachine.js`) after checking callers.
4. Delete the `* copy.*` files and duplicate root-level prompts; keep or delete `attache_instructions_alt.md` after confirming it is unused.
5. Extend `validatePromptRegistry` and add a test that fails on stub-length personas and on placeholder or mock markers in any composed system prompt (use `composeAgentPrompt` for each agent and assert on the output).
6. Re-run the dev scenario lab and `llmPayloadPreview` for each agent and read the composed prompts end to end.

Exit check: composed prompts for all four agents contain no placeholder or mock text; tests pass.

### Phase 5: feature parity decisions (F-05)

For each of philosopher self-dialog, easter egg, and closers (D-2):

1. If dropped: remove the route (or keep a documented 410 for one release), contract fields, frontend code paths, README entries and prompt files.
2. If kept or reimplemented: write the design (endpoint or in-turn behavior, state it needs in `SessionState`, cost impact) and add it to this plan before implementing.
3. Update `frontend/api/contracts/chat-http.contract.json` and `README.md` API surface to match.

Exit check: README, contract and code agree on the endpoint list and response fields.

### Phase 6: configuration, docs, hygiene (F-08, F-10, F-13)

1. Rewrite `frontend/.env.example` to list only variables the code reads (generate the list with `rg "process.env\." frontend`), with correct defaults.
2. Update `docs/CONFIGURATION.md`, `docs/AZURE-SWA-STRUCTURE.md`, `docs/DEPLOY-AZURE-SWA.md`, `frontend/DEPLOY-AZURE-SWA.md` (consolidate the duplicate under `frontend/`) and the README (architecture, API surface, local dev, tests).
3. Fix the `dev` script to watch `api/prompts` and `api/src`.
4. `.gitignore`: add `!.env.example` after `.env*`, remove the `.env_the_wrongone` line, restore a `frontend/api/.gitignore` if the Functions tooling needs it.
5. Add `docs/ARCHITECTURE.md` (agents, state, prompt composition, request lifecycle) or fold it into the README. Keep `attacheOrchestrator-plan.md` only if it still matches the code; otherwise update or remove it.
6. Add `CHANGELOG.md` with the `v2.0.0` entry (section 6).

Exit check: a fresh clone can follow the README to run `OFFLINE=1` locally and run the tests; no document references a missing file (check with a script that greps for paths in docs).

### Phase 7: verification

Automated:

1. `npm test` (all tests), `npm run test:isolated`, CI green on the final PR.
2. An end-to-end offline script: walk through attaché baselines, handoff to detective, time-away re-baseline (use the mock-return dev hook), and closure, asserting envelopes, counters and statuses.

Staging (the PR to `main` creates an SWA preview environment through the existing workflow):

3. Configure the preview environment's app settings with a real `OPENAI_API_KEY`, low caps, and durable storage pointed at a test table.
4. Manually exercise the full flow in the browser: first visit, baseline, handoff, philosopher margin notes, closure, return after a gap, reload mid-conversation (state must survive), and a second browser profile.
5. Record token usage and latency per turn (use `DEBUG_PROMPTS_LEVEL=3` locally, or log usage from responses) to quantify F-02/F-14, then decide whether to apply a cost reduction before release.
6. Watch the Functions logs for cold-start errors; restart the Functions host mid-session to confirm durability.
7. Capture screenshots and a short screen recording of the browser run for the PR.

Exit check: staging run completes with no errors; measured cost per session fits the chosen caps; durability confirmed across a host restart.

### Phase 8: merge and release

1. Pre-merge: set production Azure app settings (cap values, `ENABLE_DURABLE_STORAGE=1`, storage connection string, table name, model) before the deploy, because new code reads them at startup. Ensure `ALLOW_TEST_SEED` and `DEBUG_LOGS` are unset.
2. Open the final PR `xstate` to `main` with: summary, link to this plan, the version-break checklist, verification evidence, and the rollback steps.
3. Squash merge (F-12). Tag `v2.0.0` on the resulting commit.
4. Monitor the production deploy: first requests, error rate, spend, and storage writes, for the first day.
5. Rollback: revert the merge commit on `main` (or redeploy `v1-legacy`) and restore the previous app settings. Sessions created under v2 are not compatible with v1, which is acceptable because v1 sessions are in-memory only.
6. Close out stale branches: `new-attache` (contained), `mid-media` (confirm abandoned, then archive via tag and delete), and the `xstate` branch after merge.

Exit check: production healthy for the monitoring window; branches cleaned up.

### Phase 9: follow-up, xstate decision (not blocking)

After release and with durable state in place, decide between keeping xstate and replacing it with plain functions.

Criteria:

- Does anyone use the Stately visualizer or the machine tags and meta?
- Does durable persistence of snapshots give real value (resume across deploys), or is it only used within a session?
- How much of the 2k lines of machine code is wiring versus logic? (`transition()` and the policy modules are already pure.)
- Are test and debugging costs lower with the machines?

If replacing:

1. Introduce `routeTurn(state, event)` as a pure function equivalent to `chatMachine` (regions become fields of a plain state object; tiers and guards become small functions). Keep `transition()` and policy functions as they are.
2. Keep both implementations side by side behind a test that runs the same scripted sessions through each and asserts identical envelopes and state projections.
3. Switch `chatService` to the pure implementation, remove snapshot migration code and `@xstate-layout` blobs, update the dev lab snapshot (`orchestrationLabSnapshot.js`), and remove the `xstate` dependency.
4. Update `docs/ARCHITECTURE.md` and the plan doc.

If keeping: remove the unused migration shims, keep the persist-invoke tests, and add the Stately export to the docs.

## 6. Version-break checklist

Include this in the `v2.0.0` release notes.

- HTTP API:
  - `POST /api/chat` success body now includes `envelope` and uses `lumen*` / `umbra*` keys (the frontend still accepts the old `leftPhilosopher*` keys, but the server no longer sends them).
  - New `GET /api/chat-state`.
  - `POST /api/philosopher-dialog` is removed or returns 410 (D-2).
  - Errors follow the contract's `errorKind` field.
- Environment variables: `AGENT_PROMPT_FILE` and `PHILOSOPHER_NOTES_FILE` are gone. New or changed: `ENABLE_DURABLE_STORAGE`, `AZURE_STORAGE_CONNECTION_STRING`, `DOSSIER_TABLE_NAME`, `ENABLE_RETURN_POLICY`, the `TIME_AWAY_*` settings, `DEBUG_STATE_LEVEL`, `DEBUG_PROMPTS_LEVEL`, `ALLOW_TEST_SEED`, `OPENAI_TIMEOUT_MS`, `DOSSIER_REFRESH_EVERY_N_DETECTIVE_TURNS`. Defaults for `MAX_USER_EXCHANGES` and `MAX_DAILY_USAGE` are set by D-1.
- Prompt files: `prompts/prompt.md`, `closers.md`, `easter_egg_prompt.md` and the philosopher response prompts are replaced by per-agent folders with persona, instructions, catalog and schema files.
- Product behavior: new visitors go through the attaché baseline before the detective; returning visitors are classified by time away and may be re-baselined; sessions end through the closure sequence instead of closers.
- Cost: up to 3 LLM calls per detective turn plus periodic dossier and summarization calls.
- Deploy layout: `contracts/` lives inside `frontend/api`; a storage account and table are required for durable state.
- Frontend file layout: all `public/js` files renamed (`area.name.js`); any external references to the old names break.
- Storage: sessions created under v1 do not carry over.

## 7. Decisions needed from the owner

| ID | Decision | Recommendation |
| --- | --- | --- |
| D-1 | Default `MAX_USER_EXCHANGES` and `MAX_DAILY_USAGE`, and the unit for the daily cap | Exchange cap high enough to cover the baseline plus a real conversation (for example 30 to 40), daily cap per turn, both overridable via app settings. Re-tune after the cost measurement in Phase 7. |
| D-2 | Keep, drop or reimplement: philosopher self-dialog, easter egg, closers | Drop the self-dialog endpoint (frontend already stopped using it) and fix the docs; keep the closure sequence in place of closers; defer the easter egg to a later release. |
| D-3 | Durable state now or documented limitation | Implement it (Phase 3). It is the only way a serverless deployment behaves correctly. |
| D-4 | Lumen and Umbra prompt tails: write real content or remove the mock | Remove the mock now, add real tails later if the design calls for them. |
| D-5 | Which Static Web App and workflow is production | Confirm, then delete the other workflow (F-11). |
| D-6 | Squash merge or merge commit | Squash, plus a detailed PR description and changelog. |
| D-7 | Keep xstate or replace it | Defer to Phase 9. |

## 8. Appendix: how the evidence was gathered

- Branch comparison: `git merge-base`, `git rev-list --count`, `git diff --stat origin/main...origin/xstate`, and `git merge-tree --write-tree origin/main origin/xstate` (clean, no conflicts).
- Tests: `cd frontend/api && npm ci && npm test` on a worktree of `origin/xstate` (131 pass, 0 fail).
- Offline run: `OFFLINE=1 node frontend/server.js`, then `POST /api/chat` four times with a cookie jar and `GET /api/chat-state`.
- F-01 reproduction: copy `frontend/api` alone to a temp directory and run `node -e 'require("./src/index.js")'` with `OFFLINE=1`.
- F-03: `node -e 'require("./src/storage/durableTableStorage")'` gives `SyntaxError: Unexpected end of input`; `rg reloadSessionFromDurable` finds only the call in `server.js`.
- F-02: `rg "incrementDailyUsage|readDailyUsage"` shows no call site in the chat path; `shared.js` lines 28 to 29 show the defaults.
- F-04: `wc -c` on the prompt files, and reading `philosophersCustomPrompt.js` and the `chatService.js` call sites.
- New blob volume: `git rev-list --objects origin/main..origin/xstate | git cat-file --batch-check` (359 blobs, about 4 MB).
