import fs from "node:fs";
import path from "node:path";
import type { ServerEnv } from "@/lib/env";

/** Load service account JSON from inline env or key file (server / API routes only). */
export function resolveServiceAccountJson(env: ServerEnv): string | null {
  const inline = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return inline;

  const keyPath = env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH?.trim();
  if (!keyPath) return null;

  const abs = path.isAbsolute(keyPath)
    ? keyPath
    : path.join(process.cwd(), keyPath);

  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}
