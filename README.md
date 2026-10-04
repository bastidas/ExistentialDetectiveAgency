# Existential Detective Agency

The Existential Detective Agency is a place for self inquiry, ontological discovery, poetry, philosophy, and of course existential questioning.

High-level concept, philosophy, and how prompt state is meant to be split: [`docs/concept.md`](docs/concept.md).


## Live site
- https://www.existentialdetectiveagency.com

## Project layout
Unified landing, querent chat, and poem experiences served from `web/` and powered by an Azure Functions API in `api/`. Local development uses Express (`server-dev.js`).

- `web/` — static site (SWA `app_location`): landing, chat, poem, assets, styles, and `web/lab/` tools.
- `api/` — Azure Functions + orchestration, agents, prompts (SWA `api_location`).
- `server-dev.js` — local Express server only (serves `web/`, requires `api/`).
- `archive/` — legacy prompts, leftover images, old Vite prototype.
- See `AGENTS.md` for the full map.

## Local development
1. `npm install` (repo root) and `npm install --prefix api`
2. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` (or `OFFLINE=1`)
3. `npm run dev`

`npm run dev` wraps `server-dev.js` with `nodemon`. Use `npm start` without live reload. `npm test` runs the API test suite.

### Testing

Run from `api/` (or the repo root with `npm test`):

- `npm test` — all `*.test.js` under `api/` (`node --test`). Storage tests need Azurite; without it they skip locally and fail when `CI=true`. To run them: `npx --package azurite azurite-table`, then set `DURABLE_STORAGE_MODE=azurite`, `AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`, `DOSSIER_TABLE_NAME=edatest`.
- `npm run test:isolated` — copies `api/` alone to a temp folder and loads `index.js`, as the Azure deploy would.
- `npm run baseline` — prints how many model calls a 45-turn session makes and how stable each agent's system prompt is. Compare before and after any prompt change.
- `api/test-support/fakeOpenAI.js` — an OpenAI-compatible server that records every request. Start it standalone with `FAKE_PORT=4999 node api/test-support/fakeOpenAI.js` and run the app with `OPENAI_BASE_URL=http://127.0.0.1:4999/v1 OPENAI_API_KEY=sk-fake npm start`.
- `api/test-support/knownDefects*.test.js` — documented bugs as `todo` tests. They report as `# TODO` while the bug exists.

### API surface
- `GET /api/debug` — diagnostics when `DEBUG_LOGS=1`.
- `POST /api/chat` — main querent endpoint.
- `GET /api/chat-state` — restore session snapshot.

## Deployment notes
- Azure Static Web Apps uses `web/` as `app_location` and `api/` as `api_location`.
- `web/staticwebapp.config.json` rewrites unknown paths to `/index.html` while excluding `/api/*` and static assets.
- Deep links like `/q` and `/p` work locally (Express SPA fallback) and in production (SWA navigation fallback).
