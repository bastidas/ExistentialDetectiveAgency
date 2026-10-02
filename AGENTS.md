# Agent guidelines

## Git workflow

- Never push to `main` (or commit directly to it). Always create a branch named `cursor/<descriptive-name>-fa33` for any change.
- Never run `git push`, open a pull request, or update one without asking the user first and receiving explicit approval.
- Committing locally on a feature branch is fine. Use one commit per logical change with a descriptive message.
- Never commit secrets or `.env` files. Keep credentials in the Cursor dashboard Secrets.

## Running the app

- `cd frontend && npm install && npm run dev` starts the Express server on port 3000.
- Set `OFFLINE=1` to stub AI replies without an OpenAI key, and `DEV=1` for dev mode.
