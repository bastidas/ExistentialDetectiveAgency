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

### API surface
- `GET /api/debug` — diagnostics when `DEBUG_LOGS=1`.
- `POST /api/chat` — main querent endpoint.
- `GET /api/chat-state` — restore session snapshot.

## Deployment notes
- Azure Static Web Apps uses `web/` as `app_location` and `api/` as `api_location`.
- `web/staticwebapp.config.json` rewrites unknown paths to `/index.html` while excluding `/api/*` and static assets.
- Deep links like `/q` and `/p` work locally (Express SPA fallback) and in production (SWA navigation fallback).
