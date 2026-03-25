import { z } from "zod";

const serverSchema = z.object({
  /** Inline JSON (one line). Prefer GOOGLE_SERVICE_ACCOUNT_KEY_PATH for local dev. */
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(2).optional(),
  /** Path to service account JSON file, relative to project root or absolute. */
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: z.string().min(1).optional(),
  GOOGLE_SPREADSHEET_ID: z.string().min(5).optional(),
  /** Full tab: `SupplyDump!A:ZZ` = all rows, columns A–ZZ */
  GOOGLE_SHEET_RANGE: z.string().min(1).default("SupplyDump!A:ZZ"),

  /** GCP project for Vertex (defaults to project_id inside service account JSON). */
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  /** Vertex region, e.g. us-central1 or asia-south1 */
  VERTEX_LOCATION: z.string().min(1).default("us-central1"),
  /** Gemini model id on Vertex */
  VERTEX_GEMINI_MODEL: z.string().min(1).default("gemini-2.0-flash-001"),

  /** Slack Incoming Webhook URL for server-side notifications */
  SLACK_WEBHOOK_URL: z.string().min(1).optional(),
  /** Optional OpenAI API key; if present AI scoring uses OpenAI first. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  /** Optional Gemini API key (AI Studio). Used before Vertex if present. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL_NAME: z.string().min(1).default("gemini-2.5-pro"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function getServerEnv(): ServerEnv {
  return serverSchema.parse({
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    GOOGLE_SERVICE_ACCOUNT_KEY_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    GOOGLE_SPREADSHEET_ID: process.env.GOOGLE_SPREADSHEET_ID,
    GOOGLE_SHEET_RANGE: process.env.GOOGLE_SHEET_RANGE,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    VERTEX_LOCATION: process.env.VERTEX_LOCATION,
    VERTEX_GEMINI_MODEL: process.env.VERTEX_GEMINI_MODEL,
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL_NAME: process.env.GEMINI_MODEL_NAME,
  });
}

/** True if spreadsheet id is set and either inline JSON or key path is configured. */
export function sheetsConfigured(env: ServerEnv): boolean {
  const hasCreds =
    Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) ||
    Boolean(env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH?.trim());
  return Boolean(env.GOOGLE_SPREADSHEET_ID && hasCreds);
}
