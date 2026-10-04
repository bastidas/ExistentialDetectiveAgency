# Deploy to Azure Static Web Apps

This app deploys as an **Azure Static Web App** with a Node.js API (Azure Functions).

## What’s included

- **Static app**: `web/` (HTML, CSS, JS) is served as the front end.
- **API**: `api/` runs as Azure Functions (`index.js` HTTP triggers).
- **Config**: `web/staticwebapp.config.json` sets the API runtime to Node 20.

## 1. Create the Static Web App in Azure

1. In [Azure Portal](https://portal.azure.com), create a **Static Web App**.
2. Choose your subscription and resource group (or create one).
3. **Build Presets**: choose **Custom**.
4. **Deployment**:
   - **Source**: GitHub.
   - Authorize Azure to your GitHub account and select this repo and branch (e.g. `main`).
5. **Build Details** (you can change these later in the workflow file):
   - **App location**: `web`
   - **Output location**: leave empty (we use `skip_app_build`)
   - **API location**: `api`
6. Create the resource. Azure will add a GitHub Actions workflow and a **deployment token** secret to your repo.

If you create the Static Web App from the portal with “Connect to GitHub”, it may add its own workflow. You can keep that and adjust it to match the settings above, or use the workflow in `.github/workflows/azure-static-web-apps.yml` and set the secret name to match what Azure created (e.g. `AZURE_STATIC_WEB_APPS_API_TOKEN_<app-name>`).

The portal-generated workflow in this repo is `.github/workflows/azure-static-web-apps-green-desert-063e5891e.yml`.

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
| `DURABLE_STORAGE_MODE` | Optional durability mode selector: `off`, `azurite`, `azure-cloud`. | `azure-cloud` |
| `ENABLE_DURABLE_STORAGE` | Legacy fallback toggle when `DURABLE_STORAGE_MODE` is unset. | `0` |
| `MAX_THREAD_EVENTS` | Optional. Max thread events per session row (default `400`). | |
| `MAX_THREAD_JSON_CHARS` | Optional. Serialized JSON size guard for thread events (default `800000`). | |
| `CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY` | Optional summarization threshold in chars. | `6000` |
| `DETECTIVE_HISTORY_STORAGE_CHAR_LIMIT` | Optional max chars stored for detective history. | `450000` |
| `LAST_N_MESSAGES_FOR_DOSSIER` | Optional dossier analyzer recent-message cap. | `12` |

Durable storage is enabled when `DURABLE_STORAGE_MODE` is `azurite` or `azure-cloud` and storage settings are present.

**Greenfield schema:** Partition keys are `EDA_session`, `EDA_dossier`, `EDA_usageSession`, `EDA_usageDaily`. If you previously used `session` / `profile` partitions, **delete and recreate the table** (or use a new table name) when deploying this version—see `docs/durable-user-state.md`.

Save the configuration.

## 3. Deploy

- **From GitHub**: Push to `main` (or the branch you connected). The workflow will build and deploy.
- **From Azure CLI** (optional): You can also use `swa deploy` or the Azure Static Web Apps CLI with the same app location and API location.

## 4. Notes

- **Durable session / dossier (Azure Table Storage)**: When `AZURE_STORAGE_CONNECTION_STRING` and `DOSSIER_TABLE_NAME` are set, session runtime (detective state, baseline runtime, **thread events** for restore, conversation summaries JSON), per-session usage, and daily usage are stored under partitions `EDA_session`, `EDA_usageSession`, `EDA_usageDaily`. The **`EDA_dossier` row is written only after a dossier analysis run** (baseline handoff or periodic detective-phase update), not on every chat message.
- **Without table storage**: The API still keeps session state and daily usage **in memory** (and the Express dev server writes daily usage to a local file). Cold starts or multiple instances can reset counts.
- **Prompt files**: All prompt markdown/JSON lives in **`api/prompts/`**. Both the Express server and the Azure Functions API read from this folder.
- **Local dev**: `npm run dev` at the repo root (Express). The Azure Functions in `api/` mirror the same behavior for production.

## 5. GitHub secret

After creating the Static Web App, Azure will create a GitHub secret (e.g. `AZURE_STATIC_WEB_APPS_API_TOKEN_...`). The hand-written workflow uses `AZURE_STATIC_WEB_APPS_API_TOKEN`. The portal-generated workflow uses `AZURE_STATIC_WEB_APPS_API_TOKEN_GREEN_DESERT_063E5891E`.

If Azure used a different name, replace the secret name in the matching workflow file.
