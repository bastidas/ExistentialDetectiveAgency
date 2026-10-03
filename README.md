# Existential Detective Agency

Unified landing, querent chat, and poem experiences served from `frontend/public` and powered by a lightweight Express API layer.

## Live site
- https://www.existentialdetectiveagency.com

## Project layout
- `frontend/` – primary workspace. Contains the Express server, Azure Functions proxies, and the static document (landing/chat/poem) under `public/`.
- `frontend/public/assets` – canonical home for all imagery/video used by every route.
- `frontend/public/js` – router, chat bootstrap, and poem runtime (vanilla JS, no bundler).
- `yang/` – archived Vite/React prototype kept for reference only; it is no longer part of the deploy/development path.

## Local development
1. `cd frontend`
2. `npm install`
3. `npm run dev`

`npm run dev` wraps `server.js` with `nodemon`, so edits to HTML/CSS/JS or prompt files trigger an automatic reload while serving `frontend/public`. Use `npm start` for a production-like run without live reload.

### Environment variables
- Create `frontend/.env` with `OPENAI_API_KEY` to enable live responses. Set `OFFLINE=1` to get mock replies without calling OpenAI (no key needed).

### API surface
- `POST /api/chat` – main querent endpoint. Returns the assistant `reply`, the routing `envelope`, and the Lumen/Umbra margin output (`lumen*` / `umbra*`) for the same turn. Responses: `429` once the daily cap (`MAX_DAILY_USAGE`) is reached, `204` after the session's final reply.
- `GET /api/chat-state` – restores chat UI state (envelope, counters, resume hints) for the current session.
- `GET /api/config` – client flags (dev/debug).
- Express dev server only: `GET /api/debug` (needs `DEBUG_LOGS=1`), `POST /api/chat-stream`, and `/api/dev/*` (needs `ALLOW_TEST_SEED=1`).

The wire format is defined in `frontend/api/contracts/chat-http.contract.json`. `POST /api/philosopher-dialog` from v1 no longer exists.

## Deployment notes
- Azure Static Web Apps consumes `frontend/public/staticwebapp.config.json`, which already rewrites unknown paths to `/index.html` while excluding `/api/*` and `/assets/*`. No extra configuration is needed for the History API router.
- The `frontend` server continues to serve `public/index.html` for any GET without an extension, so deep links like `/q` and `/p` work locally and in production.
