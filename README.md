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
- Create `frontend/.env` with `OPENAI_API_KEY` to enable live responses. Set `MODE=dev` if you want deterministic stub replies without calling OpenAI.

### API surface
- `GET /api/debug` – diagnostics when `DEBUG=true`.
- `POST /api/chat` – main querent endpoint.
- `POST /api/philosopher-dialog` – side-channel lore.

## Deployment notes
- Azure Static Web Apps consumes `frontend/public/staticwebapp.config.json`, which already rewrites unknown paths to `/index.html` while excluding `/api/*` and `/assets/*`. No extra configuration is needed for the History API router.
- The `frontend` server continues to serve `public/index.html` for any GET without an extension, so deep links like `/q` and `/p` work locally and in production.
