# Repo structure for Azure Static Web Apps

## Tree

```
ExistentialDetectiveAgency/
├── .github/workflows/
│   ├── azure-static-web-apps.yml
│   └── azure-static-web-apps-green-desert-063e5891e.yml
├── web/                            # App location (static content)
│   ├── index.html
│   ├── staticwebapp.config.json
│   ├── js/, styles/, assets/, lab/
├── api/                            # API location (Azure Functions)
│   ├── host.json
│   ├── package.json
│   ├── index.js                    # HTTP triggers
│   ├── prompts/                    # model-facing content (must ship with the API)
│   └── ...
├── server-dev.js                   # Local Express (not deployed)
└── README.md
```

## Deployment mapping

| Azure SWA concept | Repo path | Notes |
|-------------------|-----------|--------|
| **App location** | `web` | Static files; no build step (`skip_app_build: true` on the hand-written workflow). |
| **API location** | `api` | Azure Functions (Node 20, v4 programming model). |
| **Workflow paths** | `web/**`, `api/**`, workflow file | Hand-written workflow only runs when these change. |

## Key files

- **`web/staticwebapp.config.json`** — Sets `platform.apiRuntime: "node:20"` and SPA fallback (rewrite to `/index.html`, exclude `/api/*` and static assets).
- **`api/host.json`** — Functions host config; uses extension bundle 4.x.
- **`api/index.js`** — HTTP triggers (`/api/config`, `/api/chat`, `/api/chat-state`, …); prompts from `api/prompts/`.
