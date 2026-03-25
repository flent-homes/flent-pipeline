# Flent pipeline (web)

Next.js app that reads **SupplyDump** (or any tab) via **Google Sheets API** and shows a pipeline table. This is the first slice toward the full GCP product (Cloud Run, Vertex, Slack, reminders).

## Quick start

See [SETUP.md](./SETUP.md) for Google Cloud service account, sharing the sheet, and `.env.local`.

**Push to GitHub:** step-by-step **[GITHUB.md](./GITHUB.md)**.

**Deploy to production:** **[Production deploy (Vercel)](./SETUP.md#production-deploy-vercel--recommended)** in [SETUP.md](./SETUP.md) (env vars, root directory if the app is in a subfolder, CLI commands).

```bash
npm install
npm run dev
```

- UI: `/` and `/pipeline`
- API: `GET /api/health`, `GET /api/deals`

## Repo layout

- `src/lib/sheets.ts` — Sheets client + row → object helper
- `src/lib/env.ts` — environment validation
- `src/app/api/deals/route.ts` — JSON API for the dashboard

## Security

Never commit real `GOOGLE_SERVICE_ACCOUNT_JSON`. Use `.env.local` (gitignored) or Secret Manager on GCP.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/deals` | List deals (columns + `_sheetRow` on each row) |
| PATCH | `/api/deals/[row]` | Update cells for sheet row `row` (JSON body: column keys → values) |
| POST | `/api/ai/score` | Body `{ "sheetRow": number, "applyToSheet"?: boolean }` — Vertex Gemini |
| POST | `/api/slack/notify` | Body `{ "text": string }` — requires `SLACK_WEBHOOK_URL` |

See [INTEGRATIONS.md](./INTEGRATIONS.md) for GCP and Slack setup.

## Root causes fixed in this iteration

- **Duplicate column headers** (e.g. two “Comments”) broke React keys and overwrote data — headers are now unique keys (`Comments`, `Comments (2)`, …).
- **`next lint` failed** — the script now runs `eslint .` (Next 16 quirk with project dir).
- **Sheets row identity** — each deal includes **`_sheetRow`** for PATCH and AI scoring.
