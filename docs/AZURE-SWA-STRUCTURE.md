# Repo structure for Azure Static Web Apps

Overview of the repository layout as used by the Azure Static Web Apps deployment.

## Tree

```
ExistentialDetectiveAgency/
├── .github/workflows/
│   └── azure-static-web-apps.yml   # CI/CD: runs on push/PR when frontend/** or workflow changes
├── frontend/
│   ├── public/                     # App location (static content)
│   │   ├── index.html
│   │   ├── app.js
│   │   ├── style.css
│   │   └── staticwebapp.config.json  # Node 20 API runtime, SPA fallback
│   ├── api/                        # API location (Azure Functions)
│   │   ├── host.json
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.js            # HTTP triggers: /api/debug, /api/chat
│   │   │   └── shared.js
│   │   └── prompts/
│   │       ├── prompt.md
│   │       ├── closers.md
│   │       └── easter_egg_prompt.md
│   ├── server.js                   # Local Express dev (not deployed)
│   ├── package.json
│   └── DEPLOY-AZURE-SWA.md
└── README.md
```

## Deployment mapping

| Azure SWA concept | Repo path | Notes |
|-------------------|-----------|--------|
| **App location** | `frontend/public` | Static files; no build step (`skip_app_build: true`). |
| **API location** | `frontend/api` | Azure Functions (Node 20, v4 programming model). |
| **Workflow paths** | `frontend/**`, workflow file | Pipeline runs only when these change. |

## Key files

- **`frontend/public/staticwebapp.config.json`** — Sets `platform.apiRuntime: "node:20"` and SPA fallback (rewrite to `/index.html`, exclude `/api/*` and static assets).
- **`frontend/api/host.json`** — Functions host config; uses extension bundle 4.x.
- **`frontend/api/src/index.js`** — Defines `debug` (GET) and `chat` (POST) HTTP triggers; uses `frontend/api/prompts/` for prompt/closers markdown.

## Checklist before first deploy

1. **Paths** — Workflow uses `frontend/public` and `frontend/api` (already updated from `new_frontend`).
2. **GitHub secret** — Set `AZURE_STATIC_WEB_APPS_API_TOKEN` (or the name Azure gives when you connect the repo).
3. **Azure app config** — Add `OPENAI_API_KEY` (and optional `OPENAI_MODEL`, `MAX_USER_EXCHANGES`, `MAX_DAILY_USAGE`, `DEBUG`) in Static Web App → Configuration.
4. **Branch** — Workflow targets `main`; ensure the Azure resource is connected to the same branch.
