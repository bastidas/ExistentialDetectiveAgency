# Existential Detective Agency — layout

Vanilla static site + Azure Functions API. Local dev uses Express (`server-dev.js`); production is Azure Static Web Apps (`web/` + `api/`).

## Tree

```
web/                 # SWA app_location — static site
  index.html, app.js
  js/{shared,chat,notes,philosophers,poem}/
  styles/
  assets/, data/, content/
  lab/               # notedebug, orchestration-dev, scenario tools
api/                 # SWA api_location — Functions + all backend code
  index.js           # production HTTP (Azure Functions)
  config.js, shared.js, chatService.js, logger.js
  contracts/         # HTTP JSON contract (must stay inside api/)
  prompts/           # model-facing markdown/JSON
  prompting/         # prompt composer / registry (code)
  agents/
    shared/          # LLM payload helpers, mock, refusal
    attache/, detective/, philosophers/
  dossier/, orchestration/, session/, storage/, lab/
server-dev.js        # local Express only (serves web/, requires api/)
docs/, archive/, .cursor/
```

## Where to edit

| Change | Location |
|--------|----------|
| Chat / notes / poem UI | `web/js/` and `web/styles/` |
| Agent prompts (persona, catalogs) | `api/prompts/{attache,detective,lumen,umbra}/` |
| Prompt assembly code | `api/prompting/` |
| Character runtime / XState | `api/agents/{attache,detective,philosophers}/` |
| Shared LLM plumbing | `api/agents/shared/` |
| Turn routing | `api/orchestration/`, `api/chatService.js` |
| HTTP contract | `api/contracts/` |

## Rules

- Do not add files under `frontend/`.
- Anything production `require()`s must live inside `api/` (SWA only deploys that folder for Functions).
- `api/prompts/` is model text; `api/prompting/` is composer code. Do not mix them.
- `api/agents/shared/` is not a character. Character code goes under `attache`, `detective`, or `philosophers`.
- Local: `npm run dev` (Express). Production: SWA workflows with `app_location: web`, `api_location: api`.
