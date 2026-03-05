# Deploy to Azure Static Web Apps

This app is set up to deploy as an **Azure Static Web App** with a Node.js API (Azure Functions).

## What’s included

- **Static app**: `public/` (HTML, CSS, JS) is served as the front end.
- **API**: `api/` runs as Azure Functions and serves `/api/debug` and `/api/chat`.
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

Save the configuration.

## 3. Deploy

- **From GitHub**: Push to `main` (or the branch you connected). The workflow will build and deploy.
- **From Azure CLI** (optional): You can also use `swa deploy` or the Azure Static Web Apps CLI with the same app location and API location.

## 4. Notes

- **Session and daily usage**: The API keeps session state and daily usage **in memory**. After a cold start or with multiple instances, counts can reset. For production, you can later add Azure Table Storage (or similar) for persistent daily usage and session data.
- **Prompt files**: All prompt/closer markdown lives in **`frontend/api/prompts/`** (`prompt.md`, `closers.md`, `easter_egg_prompt.md`). Both the Express server and the Azure API read from this folder. Edit them there.
- **Local dev**: Keep using `npm run dev` in `frontend` for the Express server. The Azure Functions in `api/` mirror the same behavior for production.

## 5. GitHub secret

After creating the Static Web App, Azure will create a GitHub secret (e.g. `AZURE_STATIC_WEB_APPS_API_TOKEN_...`). In `.github/workflows/azure-static-web-apps.yml`, the workflow uses:

```yaml
azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
```

If Azure used a different name, replace `AZURE_STATIC_WEB_APPS_API_TOKEN` with that secret name in the workflow file.
