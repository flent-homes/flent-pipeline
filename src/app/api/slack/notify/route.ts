import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
});

/** POST a plain-text message to Slack via Incoming Webhook. */
export async function POST(request: Request) {
  const env = getServerEnv();
  const url = env.SLACK_WEBHOOK_URL?.trim();
  if (!url) {
    return NextResponse.json(
      {
        error: "missing_slack_webhook",
        message: "Set SLACK_WEBHOOK_URL in .env.local (Incoming Webhook URL).",
      },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: parsed.data.text }),
  });

  if (!res.ok) {
    const t = await res.text();
    return NextResponse.json(
      { error: "slack_failed", status: res.status, message: t.slice(0, 500) },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
