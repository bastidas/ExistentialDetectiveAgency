# Deploy to Azure Static Web Apps

This app is set up to deploy as an **Azure Static Web App** with a Node.js API (Azure Functions).

## What’s included

- **Static app**: `public/` (HTML, CSS, JS) is served as the front end.
- **API**: `api/` runs as Azure Functions and serves `/api/debug`, `/api/chat`, and `/api/chat-state`.
- **Config**: `public/staticwebapp.config.json` sets the API runtime to Node 20.

## 1. Create the Static Web App in Azure

1. In [Azure Portal](https://portal.azure.com), create a **Static Web App**.
2. Choose your subscription and resource group (or create one).
3. **Build Presets**: choose **Custom**.
4. **Deployment**:
   - **Source**: GitHub.
   - Authorize Azure to your GitHub account and select this repo and branch (e.g. `main`).
5. **Build Details** (you can change these later in the workflow file):
   - **App location**: `frontend/public`
   - **Output location**: leave empty (we use `skip_app_build`)
   - **API location**: `frontend/api`
6. Create the resource. Azure will add a GitHub Actions workflow and a **deployment token** secret to your repo.

If you create the Static Web App from the portal with “Connect to GitHub”, it may add its own workflow. You can keep that and adjust it to match the settings above, or use the workflow in `.github/workflows/azure-static-web-apps.yml` and set the secret name to match what Azure created (e.g. `AZURE_STATIC_WEB_APPS_API_TOKEN_<app-name>`).

## 2. Configure application settings (secrets)

In Azure Portal:

1. Open your **Static Web App** → **Settings** → **Configuration**.
2. Under **Application settings**, add:

| Name | Description | Example |
|------|-------------|---------|
| `OPENAI_API_KEY` | **Required.** Your OpenAI API key. | `sk-...` |
| `OPENAI_MODEL` | Optional. Model name. | `gpt-4o` or `gpt-4o-mini` |
| `OPENAI_SERVICE_TIER` | Optional. Use `flex` for cheaper/slower. | `flex` or leave empty |
| `MAX_USER_EXCHANGES` | Optional. Max exchanges per session before closers. | `5` |
| `MAX_DAILY_USAGE` | Optional. Max API calls per day (all users). | `100` |
| `DEV` | Optional. Enable dev-only UI and advanced tools. | `1` or `true` |
| `OFFLINE` | Optional. Disable LLM; return dummy responses (no API key needed). | `1` or `true` |
| `DEBUG_LOGS` | Optional. Enable /api/debug and verbose logs (e.g. full message to LLM). | `1` or `true` |
| `AZURE_STORAGE_CONNECTION_STRING` | **Durable storage.** Full storage connection string from the Azure portal (Access keys). | `DefaultEndpointsProtocol=...` |
| `DOSSIER_TABLE_NAME` | **Durable storage.** Azure Table name for session, dossier, and usage rows (one table, multiple partition keys). | e.g. `UserDossiers` |
| `ENABLE_DURABLE_STORAGE` | Optional. Set to `0` / `false` to disable table persistence even when the two settings above are set. | `0` |
| `MAX_THREAD_EVENTS` | Optional. Max thread events per session row (default `400`). | |
| `MAX_THREAD_JSON_CHARS` | Optional. Serialized JSON size guard for thread events (default `800000`). | |

Durable storage is **enabled automatically** when both `AZURE_STORAGE_CONNECTION_STRING` and `DOSSIER_TABLE_NAME` are set (unless `ENABLE_DURABLE_STORAGE=0`).

**Greenfield schema:** Partition keys are `EDA_session`, `EDA_dossier`, `EDA_usageSession`, `EDA_usageDaily`. If you previously used `session` / `profile` partitions, **delete and recreate the table** (or use a new table name) when deploying this version—see `docs/durable-user-state.md`.

Save the configuration.

## 3. Deploy

- **From GitHub**: Push to `main` (or the branch you connected). The workflow will build and deploy.
- **From Azure CLI** (optional): You can also use `swa deploy` or the Azure Static Web Apps CLI with the same app location and API location.

## 4. Notes

- **Durable session / dossier (Azure Table Storage)**: When `AZURE_STORAGE_CONNECTION_STRING` and `DOSSIER_TABLE_NAME` are set, session runtime (detective state, baseline runtime, **thread events** for restore, conversation summaries JSON), per-session usage, and daily usage are stored under partitions `EDA_session`, `EDA_usageSession`, `EDA_usageDaily`. The **`EDA_dossier` row is written only after a dossier analysis run** (baseline handoff or periodic detective-phase update), not on every chat message.
- **Without table storage**: The API still keeps session state and daily usage **in memory** (and the Express dev server writes daily usage to a local file). Cold starts or multiple instances can reset counts.
- **Prompt files**: All prompt/closer markdown lives in **`frontend/api/prompts/`** (`prompt.md`, `closers.md`, `easter_egg_prompt.md`). Both the Express server and the Azure API read from this folder. Edit them there.
- **Local dev**: Keep using `npm run dev` in `frontend` for the Express server. The Azure Functions in `api/` mirror the same behavior for production.

## 5. GitHub secret

After creating the Static Web App, Azure will create a GitHub secret (e.g. `AZURE_STATIC_WEB_APPS_API_TOKEN_...`). In `.github/workflows/azure-static-web-apps.yml`, the workflow uses:

```yaml
azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
```

If Azure used a different name, replace `AZURE_STATIC_WEB_APPS_API_TOKEN` with that secret name in the workflow file.
