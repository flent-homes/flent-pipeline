import { NextResponse } from "next/server";
import { getServerEnv, sheetsConfigured } from "@/lib/env";

export async function GET() {
  const env = getServerEnv();
  return NextResponse.json({
    ok: true,
    sheetsConfigured: sheetsConfigured(env),
    range: env.GOOGLE_SHEET_RANGE,
  });
}
