# Flent pipeline — setup

## What you need from Flent (blocking)

1. **Google Cloud project** (you have credits): enable **Google Sheets API**.
2. **Service account**: create one, add a JSON key. Copy the **client email** (ends with `@...iam.gserviceaccount.com`).
3. **Share the spreadsheet** with that email (Viewer for read-only; Editor once we add writes).
4. **Spreadsheet ID**: from the URL `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.
5. **Tab name**: confirm the main tab is `SupplyDump` or tell us the exact name — update `GOOGLE_SHEET_RANGE` (e.g. `MyTab!A1:ZZ`).

## Default local setup (this repo)

Copy `supply-fde-*.json` into `flent-pipeline/` (same folder as `package.json`) and use `.env.local`:

- `GOOGLE_SPREADSHEET_ID` — spreadsheet id from the URL  
- `GOOGLE_SERVICE_ACCOUNT_KEY_PATH=supply-fde-d60d5c58f840.json`  
- `GOOGLE_SHEET_RANGE=SupplyDump!A:ZZ` — full tab (all rows, columns A–ZZ)

Key files are listed in `.gitignore` — do not commit them.

## Step 4 — Create `.env.local` (after the service account JSON exists)

You already shared the workbook and tab: **Supply Pipeline** spreadsheet, tab **`SupplyDump`**.

1. In the `flent-pipeline` folder, copy the example env file:

   ```bash
   cd flent-pipeline
   cp .env.example .env.local
   ```

2. Open **`.env.local`** in Cursor (or any editor). It is gitignored — safe for secrets.

3. Set these three variables:

   **`GOOGLE_SPREADSHEET_ID`** — only the ID from the URL (no slashes):

   ```text
   1peTQ64QT7XI1yXreRNtNczH35sJvwk5vRI3YzeRwug0
   ```

   **`GOOGLE_SHEET_RANGE`** — leave as below unless your tab name differs:

   ```text
   SupplyDump!A1:ZZ
   ```

   **`GOOGLE_SERVICE_ACCOUNT_JSON`** — the **entire** contents of the downloaded key file, as **one single line** (minified JSON).

   **Option A — use `jq` (macOS: `brew install jq` if needed):**

   ```bash
   jq -c . ~/Downloads/your-project-xxxxx.json
   ```

   Copy the single line it prints. In `.env.local` use **double quotes** around it:

   ```bash
   GOOGLE_SERVICE_ACCOUNT_JSON="{\"type\":\"service_account\",...}"
   ```

   **Option B — paste in the editor:** open the `.json` key file, remove all line breaks so it is one line, then paste after `GOOGLE_SERVICE_ACCOUNT_JSON=`.

   **Option C — single quotes (often easiest on Mac/Linux):** wrap the whole JSON in **single quotes** so you do not escape inner double quotes:

   ```bash
   GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...",...}'
   ```

   **Important:** Do not commit `.env.local`. If the app says `sheets_fetch_failed`, re-check that the spreadsheet is **shared** with the service account email from the JSON (`client_email`).

4. Run the app:

   ```bash
   npm install
   npm run dev
   ```

Open [http://localhost:3000/pipeline](http://localhost:3000/pipeline). If something fails, open [http://localhost:3000/api/deals](http://localhost:3000/api/deals) and read the `message` field.

## API checks

- `GET /api/health` — whether Sheets env is set.
- `GET /api/deals` — headers + deal rows as JSON.

## Production deploy (Vercel — recommended)

This app is a standard **Next.js** Node server (`next start`). The easiest hosted option is **[Vercel](https://vercel.com)** (same team as Next.js).

### 1. Prerequisites

- Code in **GitHub / GitLab / Bitbucket** (or deploy with the Vercel CLI without Git).
- Same Google setup as local: **Sheets API** enabled, **service account** JSON, spreadsheet **shared** with the service account email.

### 2. Create the Vercel project

**From Git (dashboard):**

1. [Import](https://vercel.com/new) your repository.
2. If this repo’s root is the parent folder (e.g. “Flent Onboarding Forms”) and the app lives in a subfolder, set **Root Directory** to `flent-pipeline`.
3. Framework preset: **Next.js** (auto-detected). Build: `npm run build`, Output: Next default.

**From CLI (in `flent-pipeline`):**

```bash
npm run build          # confirm green locally first
npx vercel@latest      # preview deploy, follow login/link prompts
npx vercel@latest --prod
```

Linking creates `.vercel/` (gitignored). Production URL is shown when the deploy finishes.

### 3. Environment variables (Vercel → Project → Settings → Environment Variables)

Set for **Production** (and **Preview** if you want previews to hit real data):

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `GOOGLE_SPREADSHEET_ID` | Yes | Same as local. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | **Use inline JSON** (Vercel has no filesystem key file). Minify to one line: `jq -c . path/to/key.json` and paste the whole string. |
| `GOOGLE_SHEET_RANGE` | Yes | e.g. `SupplyDump!A:ZZ` |
| `OPENAI_API_KEY` | No | Agent chat narrative; omit if you only need the pipeline UI. |
| `OPENAI_MODEL` | No | Defaults to `gpt-4.1-mini` in code. |

Do **not** rely on `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` in production unless you use a custom Docker image that bakes in the file; prefer **`GOOGLE_SERVICE_ACCOUNT_JSON`**.

Redeploy after changing env vars (Deployments → … → Redeploy, or push a commit).

### 4. Smoke test

- Open `https://<your-project>.vercel.app/pipeline`
- `https://<your-project>.vercel.app/api/health` should not report missing config.

### Other hosts (Railway, Render, Fly.io, Cloud Run)

Use **Node** runtime: install deps, `npm run build`, start with `npm run start` (port from `PORT` env). Provide the same env vars as above; **`GOOGLE_SERVICE_ACCOUNT_JSON`** is still the practical way to pass credentials.

## Next (not in this repo yet)

- GCP Cloud Run deploy, Vertex AI scoring, Firestore reminders, Slack app — see project plan.
