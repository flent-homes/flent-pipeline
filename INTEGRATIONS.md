# Integrations: Vertex AI, Slack, Sheets (step by step)

Your app uses the **service account JSON** (`client_email` inside the file) to call Google Sheets and (optionally) Vertex AI. Slack uses a **webhook URL** — no OAuth for simple posting.

---

## 1. Give the service account access to Vertex AI (Gemini)

The API is enabled in the project; **IAM** still must grant *this service account* permission to call Vertex.

### A. Find the service account email

1. Open your key file (e.g. `supply-fde-d60d5c58f840.json`).
2. Copy the value of **`client_email`** (looks like `something@supply-fde.iam.gserviceaccount.com`).

### B. Grant the Vertex AI User role (console)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select project **`supply-fde`** (or your project).
2. Go to **IAM & Admin** → **IAM** (direct: *IAM & Admin* → *IAM*).
3. Click **Grant access** (or **+ Grant access**).
4. In **New principals**, paste the **`client_email`** from the JSON.
5. Under **Role**, choose **Vertex AI** → **Vertex AI User**  
   (role id: `roles/aiplatform.user`).
6. Save.

### C. (Alternative) gcloud CLI

```bash
gcloud config set project supply-fde

gcloud projects add-iam-policy-binding supply-fde \
  --member="serviceAccount:YOUR_CLIENT_EMAIL_HERE" \
  --role="roles/aiplatform.user"
```

Replace `YOUR_CLIENT_EMAIL_HERE` with the exact `client_email`.

### E. OpenAI alternative (simpler)

If you set `OPENAI_API_KEY` in `.env.local`, the app uses OpenAI for scoring first and only uses Vertex when OpenAI key is absent.

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

### F. Gemini API key alternative (your provided key)

If `GEMINI_API_KEY` is set, the app can score with Gemini API directly (no Vertex IAM needed for scoring calls).

```bash
GEMINI_API_KEY=AIza...
GEMINI_MODEL_NAME=gemini-2.5-flash-lite
```

For better quality (higher cost/latency), try:

```bash
GEMINI_MODEL_NAME=gemini-2.5-pro
```

### D. Region and model

- Default in app: `VERTEX_LOCATION=us-central1`, `VERTEX_GEMINI_MODEL=gemini-2.0-flash-001`.
- If you get “model not found” or region errors, set in `.env.local` a region where that model exists (check [Vertex AI models](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models) for your project).

---

## 2. Slack: Incoming Webhook (fastest path)

This posts messages **into one channel** from your server. No Slack “bot user” required for basic alerts.

### A. Create an app and enable Incoming Webhooks

1. Open [Slack API: Your Apps](https://api.slack.com/apps).
2. **Create New App** → **From scratch** → name it (e.g. “Flent Pipeline”) → pick your **Flent workspace**.
3. In the app sidebar, open **Incoming Webhooks**.
4. Turn **Activate Incoming Webhooks** **On**.
5. Click **Add New Webhook to Workspace**.
6. Pick the **channel** (e.g. `#supply-pipeline` or `#sales-alerts`).
7. Copy the **Webhook URL** (starts with `https://hooks.slack.com/services/...`).

### B. Put it in `.env.local`

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...
```

Restart `npm run dev`.

### C. Test from terminal

```bash
curl -X POST http://localhost:3000/api/slack/notify \
  -H "Content-Type: application/json" \
  -d '{"text":"Flent pipeline: test message"}'
```

You should see the message in the Slack channel.

### D. Later: richer Slack (optional)

- Slash commands, DMs, and interactive buttons need a **Slack app** with OAuth and more scopes — we can add that after webhooks work.

---

## 3. Google Sheets writes (reminder)

The same **`client_email`** must have **Editor** access to the spreadsheet:

**Sheets → Share →** add the service account email → **Editor**.

Viewer-only works for read, not for **Save** or **Score + sheet**.

---

## Troubleshooting

| Symptom | What to check |
| -------- | ---------------- |
| Vertex `403` / `Permission denied` | IAM **Vertex AI User** on the **exact** `client_email` |
| Vertex `404` / model not found | `VERTEX_LOCATION` and `VERTEX_GEMINI_MODEL` |
| Slack 404 from `hooks.slack.com` | Webhook URL copied fully; app still installed |
| Sheet update fails | Service account = **Editor** on the file |
