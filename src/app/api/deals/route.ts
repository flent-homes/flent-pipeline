import { NextResponse } from "next/server";
import {
  fetchSheetValues,
  rowsToDealRecords,
} from "@/lib/sheets";
import { getServerEnv, sheetsConfigured } from "@/lib/env";
import { resolveServiceAccountJson } from "@/lib/google-credentials";

export async function GET() {
  const env = getServerEnv();
  const credentials = resolveServiceAccountJson(env);
  if (!sheetsConfigured(env) || !credentials) {
    return NextResponse.json(
      {
        error: "missing_config",
        message:
          "Set GOOGLE_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_KEY_PATH (or GOOGLE_SERVICE_ACCOUNT_JSON) in .env.local",
      },
      { status: 503 },
    );
  }
  try {
    const rows = await fetchSheetValues(
      env.GOOGLE_SPREADSHEET_ID!,
      env.GOOGLE_SHEET_RANGE,
      credentials,
    );
    const { columns, deals } = rowsToDealRecords(rows);
    const columnKeys = columns.map((c) => c.key);
    return NextResponse.json({
      spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
      range: env.GOOGLE_SHEET_RANGE,
      columns,
      columnKeys,
      /** @deprecated use columns[].label */
      headers: columns.map((c) => c.label),
      rowCount: deals.length,
      deals,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "sheets_fetch_failed", message },
      { status: 502 },
    );
  }
}
