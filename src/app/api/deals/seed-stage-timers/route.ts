import { NextResponse } from "next/server";
import { google } from "googleapis";
import {
  ensureHeaders,
  fetchSheetValues,
  parseTabNameFromRange,
  rowsToDealRecords,
} from "@/lib/sheets";
import { getServerEnv, sheetsConfigured } from "@/lib/env";
import { resolveServiceAccountJson } from "@/lib/google-credentials";

const STAGE_KEY = "Deal Stage";
const DISQ_KEY = "Disqualified";
const STAGE_ENTERED_AT_KEY = "Stage Entered At";

function isDisqualifiedValue(value: string | number | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

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
    const { columns, deals } = rowsToDealRecords(rows);

    const headersInOrder = await ensureHeaders(
      env.GOOGLE_SPREADSHEET_ID!,
      env.GOOGLE_SHEET_RANGE,
      [STAGE_ENTERED_AT_KEY],
      credentials,
    );

    const stageEnteredAtExists = columns.some((c) => c.key === STAGE_ENTERED_AT_KEY);
    const nowIso = new Date().toISOString();
    const updates: Array<{ range: string; values: string[][] }> = [];
    let skippedNoStage = 0;
    let skippedDisqualified = 0;
    let alreadySeeded = 0;

    const colIndex = headersInOrder.indexOf(STAGE_ENTERED_AT_KEY);
    if (colIndex === -1) {
      return NextResponse.json(
        { error: "missing_stage_entered_at", message: "Could not resolve Stage Entered At column." },
        { status: 500 },
      );
    }

    const letter = (() => {
      let dividend = colIndex + 1;
      let columnName = "";
      while (dividend > 0) {
        const mod = (dividend - 1) % 26;
        columnName = String.fromCharCode(65 + mod) + columnName;
        dividend = Math.floor((dividend - mod) / 26);
      }
      return columnName;
    })();

    const tab = parseTabNameFromRange(env.GOOGLE_SHEET_RANGE);
    const needsQuote = /[\s']/.test(tab);
    const tabRef = needsQuote ? `'${tab.replace(/'/g, "''")}'` : tab;

    for (const deal of deals) {
      const stage = String(deal[STAGE_KEY] ?? "").trim();
      if (!stage) {
        skippedNoStage += 1;
        continue;
      }
      if (isDisqualifiedValue(deal[DISQ_KEY])) {
        skippedDisqualified += 1;
        continue;
      }
      const existing = stageEnteredAtExists
        ? String(deal[STAGE_ENTERED_AT_KEY] ?? "").trim()
        : "";
      if (existing) {
        alreadySeeded += 1;
        continue;
      }
      updates.push({
        range: `${tabRef}!${letter}${deal._sheetRow}`,
        values: [[nowIso]],
      });
    }

    if (updates.length) {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(credentials) as Record<string, unknown>,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const sheets = google.sheets({ version: "v4", auth });

      const chunkSize = 500;
      for (let i = 0; i < updates.length; i += chunkSize) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: env.GOOGLE_SPREADSHEET_ID!,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: updates.slice(i, i + chunkSize),
          },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      seeded: updates.length,
      alreadySeeded,
      skippedNoStage,
      skippedDisqualified,
      seededAt: nowIso,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "seed_failed", message },
      { status: 502 },
    );
  }
}

