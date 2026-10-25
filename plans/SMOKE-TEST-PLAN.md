# Smoke and deploy-verification plan

Status: plan only, nothing here is implemented. No new frameworks: Node's built-in `fetch` and `node:test`, plus Playwright for one browser spec.

Goal: catch the quiet failures in a chat app on Azure, not just "does it boot": a 200 that serves the old build, a reload that loses or duplicates the conversation, a handoff that fires twice, dev flags left on, routing that swallows API errors, storage that is configured but unreachable.

Dependencies: Tier B reuses `api/test-support/fakeOpenAI.js` (CI harness, PR #5). The limit settings and `durableStorageReady` come with the spend controls (PR #6). Both must be in `xstate` before this is built.

## Files

| New file | Lines |
|---|---|
| `scripts/smoke.js` (Tier A local mode, Tier C deployed mode) | ~110 |
| `e2e/replay.spec.js` (Tier B) | ~130 |
| `api/storage/durableProbe.test.js` (read-only guard test) | ~45 |

Edits: `probeDurableStorage()` in `api/storage/durableTableStorage.js` plus wiring in `api/index.js` and `server-dev.js` (~30), cookie changes (~8), `package.json` (+5), `test.yml` e2e job (~30), Azure workflow (~35). Total about 285 new lines plus about 110 of edits. Playwright needs no config file: servers start inside the spec and flags go on the command line.

## Tier A: HTTP smoke (about 3 s, `npm run smoke`)
`scripts/smoke.js` spawns the real `node server-dev.js` with `OFFLINE=1 DURABLE_STORAGE_MODE=off PORT=<free port>`, waits up to 10 s for the port, runs plain `fetch` calls, kills the process.
1. `GET /` returns 200 HTML, and every local `<script src>` and `<link href>` on it returns 200.
2. `GET /api/config` returns 200 JSON with `devMode`, `lastNClientTranscriptTurns`, `durableStorageMode`, `durableStorageReady`. With mode `off`, ready must be `false`.
3. `GET /api/chat-state` returns 200, sets `sessionId` and `edaUserId` cookies, and a snapshot with `envelope` and `serverSeq`.
4. `POST /api/chat {"message":"hello"}` returns 200 with a reply. A 5,000-character message returns 400 `bad_request`.

## Tier B: browser replay spec (about 30 to 45 s, `npm run e2e`)
`e2e/replay.spec.js` starts Azurite, `startFakeOpenAI()`, and `server-dev.js`, then drives headless Chromium through the real UI. Run with `npx playwright test e2e --trace=retain-on-failure`.

**Server setup (checked against the code)**
- `server-dev.js` builds `new OpenAI({ apiKey, timeout, maxRetries: 1 })` with no `baseURL`. The installed SDK (4.104) reads `OPENAI_BASE_URL` and `OPENAI_API_KEY` from the environment, so the fake is injected with env only: `OPENAI_BASE_URL=<fake.baseURL> OPENAI_API_KEY=sk-fake`. The key must be non-empty or the server exits.
- Also set `DURABLE_STORAGE_MODE=azurite AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`, a fresh `DOSSIER_TABLE_NAME=e2e<timestamp>` so no stale state carries over, and `MAX_REQUESTS_PER_MINUTE=0` so fast turns do not trip the burst limiter. Do not load a developer `.env`.

**Selectors (checked against `web/index.html` and `web/js/chat/`)**
- Editor `#input-wrap` is a `contenteditable` div inside `#form`, which starts with class `form--hidden`. Wait for the editor to be visible before typing.
- Type with the locator's `fill()` and send with `Enter`. `input.js` turns Enter into `form.requestSubmit()`. Shift+Enter inserts a newline.
- Transcript is `#messages`, with `.message.user` and `.message.assistant` rows and `.label--attache` / `.label--detective` classes. Labels are typed out by a typewriter effect, so do not assert on label text mid-animation.
- Source of truth for the active agent is `envelope.active_agent` in each `/api/chat` response (`page.waitForResponse`). Use the label class only after the reply settles. The label text is `*** ATTACHÉ ***` / `*** DETECTIVE ***`.

**Scenarios**
1. Handoff: send turns (cap at 12) until `active_agent` flips from `attache` to `detective`. It flips exactly once and never back. The first detective upstream payload ends with the user's actual last message. No system prompt sent upstream contains `[mock` or placeholder text (read from `fake.requests`).
2. Reload replay: record transcript, `serverSeq`, and cookies, then reload. Same transcript, no duplicate or lost lines, same cookies, detective still active, zero new upstream calls. `durableStorageReady` is `true`.
3. Local storage cleared: clear `localStorage`, reload. The server rebuilds the transcript from Azurite. Send one more turn: `serverSeq` is monotonic and roles alternate.
4. Server restart with the client ahead: stop and restart `server-dev.js` mid-conversation with checkpointing effectively off (`SESSION_CHECKPOINT_EVERY_K_TURNS=1000`). The client holds lines the server lost, so `mergeChatStatePayload` marks a recovered tail and calls `/api/chat-sync`. After reload the transcript is complete with no duplicates, and `serverSeq` is advanced by the appended user turns.

"Replay" here means restoring the transcript on reload. The repo documents no named replay bug, so scenarios 2 to 4 cover the replay paths in the code: normal restore, server rebuild, and recovered-tail merge (`route.js` skips replaying the server transcript when `resumeUi.transcriptMode` is `hidden` and nothing was recovered). The long-absence `hidden` case needs a time-away fixture and is out of scope.

## Tier C: post-deploy check (about 10 to 70 s)
The same `scripts/smoke.js` in deployed mode, as a `verify_deploy` job after the deploy job. It polls for up to 60 s (120 s on previews) before failing.

**Targets**
- Production, on pushes to `main`: `SMOKE_BASE_URL=https://existentialdetectiveagency.com` (repo variable). The script follows redirects and asserts the final host is `www.existentialdetectiveagency.com`, the canonical host in the README. The apex must redirect to it.
- PR previews, on PRs to `main`: the base URL is the preview URL from the deploy action. Verify the action's URL output when building; the fallback is the URL in the PR comment the action posts. The canonical-host assertion is skipped on previews. Previews to `xstate` need `xstate` added to the workflow's `pull_request.branches` (leave `push` on `main` only).

**Assertions**
- Right build is live: the workflow writes `web/version.txt` with `$GITHUB_SHA` before deploying (the merge commit on PRs). Poll `/version.txt` until it matches.
- `/` and its assets return 200. `/api/config` and `/api/chat-state` return 200, `application/json`, valid shapes.
- `GET /api/nonexistent` returns a plain 404, not the `index.html` fallback.
- `devMode` is false, offline is off, and `/api/debug` and other dev routes return 404.
- Cookies on the first `/api/chat-state` response: `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`, expected `Max-Age` (7 days session, 400 days user).
- `/api/config` answers in under 5 s once warm.
- `durableStorageMode` and `durableStorageReady` are printed. They are not asserted yet: the expected mode is unconfirmed and `SMOKE_EXPECT_DURABLE` stays unset. Once it is set to anything but `off`, ready must be `true`.
- Opt-in `SMOKE_CHAT=1` (production only, never previews): one short real turn must return 200 and no mock or error diagnostic text.

Static Web Apps has no slot swap or rollback, so a red production check is a fast alert, not a prevention. Previews are where it can block a merge.

## `durableStorageReady` (read-only, no round trip)
`/api/config` gains the boolean `durableStorageReady`.
- True only when the mode is not `off`, the connection string and table name are set, and the probe succeeds.
- Probe: one `getEntity` for partition `EDA_health`, row `probe`, a key the app never writes. Not found means credentials and table are fine (true). Table-not-found, auth failure, timeout, or no client means false.
- Never touches session, dossier, or usage partitions, never lists, writes, or deletes, and never creates the table (unlike `ensureTable`).
- Cached for 60 s, 2 s timeout. `/api/config` is public, so repeated hits cannot become a storage-read flood. It returns only the boolean.
- `durableProbe.test.js` uses a mock table client that throws on any method other than `getEntity` and on any partition other than `EDA_health`. It covers each outcome and the cache.
- Limits: it shows credentials and table are reachable, not that sessions persist (Tier B covers that against Azurite). It also passes if `DOSSIER_TABLE_NAME` names a different existing table.

## Cookie flags
Today (`api/shared.js`): `HttpOnly; Path=/; Max-Age; SameSite=Lax`, no `Secure`, no `Domain`.
- Add `Secure` on the Functions path (`buildCookieHeader`). Leave the Express dev path alone, since dev runs over http. Existing sessions stay valid because the cookie names do not change.
- Keep `SameSite=Lax` (Strict would drop the session on links from other sites; Lax also blocks cross-site POSTs to `/api/chat`), `Path=/`, and host-only with no `Domain`.
- Apex and `www` are separate hosts, so a visitor on both gets two sessions. That resets the per-session exchange cap and splits the dossier. The fix is one canonical redirect (the default custom domain in Static Web Apps), which Tier C asserts. The daily cap and per-IP limit are the real spend backstops, since a cookie is never a trust boundary.
- `edaUserIdEcho` returns the raw user id in `/api/chat-state` JSON, and `persist.js` stores it in `localStorage`, so page JavaScript can read what `HttpOnly` was meant to hide. Echo a truncated one-way hash instead; the client only compares it to detect an identity change.
- Functions re-sends the cookies on every response (sliding expiry) and Express only on creation. Local runs will not show Functions cookie behavior, so the cookie assertions live in Tier C.

## CI wiring
- `test.yml`: new `e2e` job on Node 22. Azurite as in the existing job, `npm ci` at the root, Playwright Chromium with a browser cache, then `npm run smoke` and `npm run e2e`. Upload traces on failure. About 1 min cached, 1.5 to 2.5 min cold, parallel with the existing job.
- Azure workflow: version-stamp step before deploy, `verify_deploy` after it. Repo variables: `SMOKE_BASE_URL`, optionally `SMOKE_CHAT`, and `SMOKE_EXPECT_DURABLE` once decided. List them in `docs/DEPLOY-AZURE-SWA.md`.

## Not covered
- Tier B runs the Express dev server, not the Azure Functions host; only Tier C exercises Functions.
- Caps and rate limits stay with the existing integration tests.
- Real model reply quality; Tier C only rules out error diagnostics.

## Open
- Expected `durableStorageMode` in production (check the Azure app settings or the live `/api/config`).
- Whether the deploy action exposes the preview URL as an output.
- Whether the apex currently redirects to `www`, and whether both hosts reach this Static Web App.
