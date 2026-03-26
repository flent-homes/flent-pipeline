import { NextResponse } from "next/server";
import { z } from "zod";
import {
  batchUpdateCells,
  ensureHeaders,
  fetchSheetValues,
  rowsToDealRecords,
} from "@/lib/sheets";
import { getServerEnv, sheetsConfigured } from "@/lib/env";
import { resolveServiceAccountJson } from "@/lib/google-credentials";

const patchBodySchema = z.record(z.string(), z.string());
const STAGE_KEY = "Deal Stage";
const DISQ_KEY = "Disqualified";
const STAGE_ENTERED_AT_KEY = "Stage Entered At";
const STAGE_TIME_COLUMNS: Record<string, string> = {
  "to be contacted (poc)": "Time in To be contacted (POC) (mins)",
  "to be contacted": "Time in To be contacted (mins)",
  "in touch": "Time in In touch (mins)",
  "landlord interested": "Time in Landlord interested (mins)",
  "evaluation in progress": "Time in Evaluation in progress (mins)",
  qualified: "Time in Qualified (mins)",
  "negotiations started": "Time in Negotiations started (mins)",
  "offer extended": "Time in Offer Extended (mins)",
  "under contract": "Time in Under contract (mins)",
};

function normalizeStage(stage: string | number | undefined): string {
  return String(stage ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function canonicalStageForTiming(stage: string | number | undefined): string {
  const s = normalizeStage(stage);
  if (!s) return "";
  if (s === "to be contacted (poc)") return "to be contacted (poc)";
  if (s.includes("to be contacted")) return "to be contacted";
  if (s.includes("in touch")) return "in touch";
  if (s.includes("landlord interested")) return "landlord interested";
  if (s.includes("evaluation")) return "evaluation in progress";
  if (s.includes("qualified")) return "qualified";
  if (s.includes("negotiations")) return "negotiations started";
  if (s.includes("offer extended")) return "offer extended";
  if (s.includes("under contract")) return "under contract";
  return s;
}

function isDisqualifiedValue(value: string | number | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ row: string }> },
) {
  const env = getServerEnv();
  const credentials = resolveServiceAccountJson(env);
  if (!sheetsConfigured(env) || !credentials) {
    return NextResponse.json(
      { error: "missing_config" },
      { status: 503 },
    );
  }

  const { row: rowParam } = await context.params;
  const sheetRow = Number.parseInt(rowParam, 10);
  if (!Number.isFinite(sheetRow) || sheetRow < 2) {
    return NextResponse.json(
      { error: "invalid_row", message: "Row must be a sheet row number ≥ 2 (row 1 is headers)." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updates: Record<string, string> = { ...parsed.data };
  delete updates._sheetRow;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "empty_updates", message: "Send at least one column key to update." },
      { status: 400 },
    );
  }

  try {
    const rows = await fetchSheetValues(
      env.GOOGLE_SPREADSHEET_ID!,
      env.GOOGLE_SHEET_RANGE,
      credentials,
    );

    if (sheetRow > rows.length) {
      return NextResponse.json(
        { error: "row_not_found", message: `No row ${sheetRow} in fetched range.` },
        { status: 404 },
      );
    }

    const { columns, deals } = rowsToDealRecords(rows);
    const currentRow = deals.find((d) => d._sheetRow === sheetRow);
    if (!currentRow) {
      return NextResponse.json(
        { error: "row_not_found", message: `No row ${sheetRow} in fetched range.` },
        { status: 404 },
      );
    }

    const nowIso = new Date().toISOString();
    const previousStage = String(currentRow[STAGE_KEY] ?? "").trim();
    const incomingStage = String(updates[STAGE_KEY] ?? previousStage).trim();
    const previousStageCanonical = canonicalStageForTiming(previousStage);
    const incomingStageCanonical = canonicalStageForTiming(incomingStage);
    const stageChanged = !!incomingStage && incomingStage !== previousStage;

    const incomingDisq = updates[DISQ_KEY] ?? String(currentRow[DISQ_KEY] ?? "");
    const disqualified = isDisqualifiedValue(incomingDisq);

    const requiredTimingHeaders = [
      STAGE_ENTERED_AT_KEY,
      ...Object.values(STAGE_TIME_COLUMNS),
    ];
    const headersInOrder = await ensureHeaders(
      env.GOOGLE_SPREADSHEET_ID!,
      env.GOOGLE_SHEET_RANGE,
      requiredTimingHeaders,
      credentials,
    );

    // Add elapsed minutes to the stage being exited.
    if ((stageChanged || disqualified) && previousStageCanonical) {
      const timeCol = STAGE_TIME_COLUMNS[previousStageCanonical];
      if (timeCol) {
        const enteredAtRaw = String(currentRow[STAGE_ENTERED_AT_KEY] ?? "").trim();
        const enteredAt = enteredAtRaw ? new Date(enteredAtRaw) : null;
        if (enteredAt && !Number.isNaN(enteredAt.getTime())) {
          const elapsedMs = Date.now() - enteredAt.getTime();
          const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / (1000 * 60)));
          const prevMins = Number.parseInt(String(currentRow[timeCol] ?? "0"), 10);
          const existingMinutes = Number.isFinite(prevMins) ? prevMins : 0;
          updates[timeCol] = String(existingMinutes + elapsedMinutes);
        }
      }
    }

    // If disqualified, stop timer. Otherwise refresh entry time on stage change.
    if (disqualified) {
      updates[STAGE_ENTERED_AT_KEY] = "";
    } else if (stageChanged && incomingStageCanonical) {
      updates[STAGE_ENTERED_AT_KEY] = nowIso;
    } else if (!String(currentRow[STAGE_ENTERED_AT_KEY] ?? "").trim() && incomingStageCanonical) {
      // Backfill for existing rows that never had timing enabled.
      updates[STAGE_ENTERED_AT_KEY] = nowIso;
    }

    const columnKeysInOrder = headersInOrder;

    await batchUpdateCells(
      env.GOOGLE_SPREADSHEET_ID!,
      env.GOOGLE_SHEET_RANGE,
      sheetRow,
      updates,
      columnKeysInOrder,
      credentials,
    );

    return NextResponse.json({ ok: true, sheetRow, updated: Object.keys(updates) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "sheets_update_failed", message },
      { status: 502 },
    );
  }
}
