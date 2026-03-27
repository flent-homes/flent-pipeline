import { NextResponse } from "next/server";
import { google } from "googleapis";
import {
  fetchSheetValues,
  parseTabNameFromRange,
  rowsToDealRecords,
} from "@/lib/sheets";
import { getServerEnv, sheetsConfigured } from "@/lib/env";
import { resolveServiceAccountJson } from "@/lib/google-credentials";

const HEADERS_TO_REMOVE = new Set([
  "AI_Score",
  "AI_Tier",
  "AI_Reason",
  "AI_Run_At",
  "Time in To be contacted (POC) (mins)",
  "Time in To be contacted (mins)",
  "Time in In touch (mins)",
  "Time in Landlord interested (mins)",
  "Time in Evaluation in progress (mins)",
  "Time in Qualified (mins)",
  "Time in Negotiations started (mins)",
  "Time in Offer Extended (mins)",
  "Time in Under contract (mins)",
]);

export async function POST() {
  const env = getServerEnv();
  const credentials = resolveServiceAccountJson(env);
  if (!sheetsConfigured(env) || !credentials) {
    return NextResponse.json({ error: "missing_config" }, { status: 503 });
  }

  try {
    const rows = await fetchSheetValues(
      env.GOOGLE_SPREADSHEET_ID!,
      env.GOOGLE_SHEET_RANGE,
      credentials,
    );
    const { columns } = rowsToDealRecords(rows);
    const tabName = parseTabNameFromRange(env.GOOGLE_SHEET_RANGE);

    const toDeleteIndexes = columns
      .map((c, idx) => ({ key: c.key, idx }))
      .filter(({ key }) => HEADERS_TO_REMOVE.has(key))
      .map(({ idx }) => idx);

    if (!toDeleteIndexes.length) {
      return NextResponse.json({
        ok: true,
        removed: [],
        message: "No matching columns found to remove.",
      });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentials) as Record<string, unknown>,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: env.GOOGLE_SPREADSHEET_ID!,
      fields: "sheets(properties(sheetId,title))",
    });
    const targetSheet = (meta.data.sheets ?? []).find(
      (s) => s.properties?.title === tabName,
    );
    const sheetId = targetSheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
      return NextResponse.json(
        {
          error: "sheet_not_found",
          message: `Could not resolve sheetId for tab '${tabName}'.`,
        },
        { status: 500 },
      );
    }

    const requests = [...toDeleteIndexes]
      .sort((a, b) => b - a) // delete right-to-left so indexes stay valid
      .map((idx) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "COLUMNS" as const,
            startIndex: idx,
            endIndex: idx + 1,
          },
        },
      }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: env.GOOGLE_SPREADSHEET_ID!,
      requestBody: { requests },
    });

    const removed = columns
      .filter((c) => HEADERS_TO_REMOVE.has(c.key))
      .map((c) => c.key);

    return NextResponse.json({
      ok: true,
      removed,
      removedCount: removed.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "cleanup_failed", message },
      { status: 502 },
    );
  }
}

