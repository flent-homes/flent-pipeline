import { NextResponse } from "next/server";
import { z } from "zod";
import {
  batchUpdateCells,
  ensureHeaders,
  fetchSheetValues,
  makeColumnDefs,
  rowsToDealRecords,
} from "@/lib/sheets";
import { getServerEnv, sheetsConfigured } from "@/lib/env";
import { resolveServiceAccountJson } from "@/lib/google-credentials";

const patchBodySchema = z.record(z.string(), z.string());
const STAGE_KEY = "Deal Stage";
const DISQ_KEY = "Disqualified";
const STAGE_ENTERED_AT_KEY = "Stage Entered At";
const STAGE_TIME_COLUMNS_HUMAN: Record<string, string> = {
  "to be contacted (poc)": "Time in To be contacted (POC)",
  "to be contacted": "Time in To be contacted",
  "in touch": "Time in In touch",
  "landlord interested": "Time in Landlord interested",
  "evaluation in progress": "Time in Evaluation in progress",
  qualified: "Time in Qualified",
  "negotiations started": "Time in Negotiations started",
  "offer extended": "Time in Offer Extended",
  "under contract": "Time in Under contract",
};
const STAGE_TIME_COLUMNS_LEGACY: Record<string, string> = {
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

function parseDurationToMinutes(value: string | number | undefined): number {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return 0;
  // Legacy numeric minutes.
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);

  let total = 0;
  const dayMatch = raw.match(/(\d+)\s*d/);
  const hourMatch = raw.match(/(\d+)\s*h/);
  const minuteMatch = raw.match(/(\d+)\s*m/);
  if (dayMatch) total += Number.parseInt(dayMatch[1], 10) * 24 * 60;
  if (hourMatch) total += Number.parseInt(hourMatch[1], 10) * 60;
  if (minuteMatch) total += Number.parseInt(minuteMatch[1], 10);
  return Number.isFinite(total) ? total : 0;
}

function formatMinutesHuman(totalMinutes: number): string {
  const mins = Math.max(0, Math.floor(totalMinutes));
  const days = Math.floor(mins / (24 * 60));
  const hours = Math.floor((mins % (24 * 60)) / 60);
  const minutes = mins % 60;
  if (days > 0) {
    return minutes > 0 ? `${days}d ${hours}h ${minutes}m` : `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function resolveEffectiveTimeColumns(existingHeaders: string[]): {
  byStage: Record<string, string>;
  missingHeadersToCreate: string[];
} {
  const hasAnyLegacy = Object.values(STAGE_TIME_COLUMNS_LEGACY).some((h) =>
    existingHeaders.includes(h),
  );
  const byStage: Record<string, string> = {};
  const missingHeadersToCreate: string[] = [];

  for (const stage of Object.keys(STAGE_TIME_COLUMNS_HUMAN)) {
    const human = STAGE_TIME_COLUMNS_HUMAN[stage];
    const legacy = STAGE_TIME_COLUMNS_LEGACY[stage];
    if (existingHeaders.includes(human)) {
      byStage[stage] = human;
      continue;
    }
    if (existingHeaders.includes(legacy)) {
      byStage[stage] = legacy;
      continue;
    }
    const preferred = hasAnyLegacy ? legacy : human;
    byStage[stage] = preferred;
    missingHeadersToCreate.push(preferred);
  }

  return { byStage, missingHeadersToCreate };
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

    const existingHeaderKeys = columns.map((c) => c.key);
    const { byStage: effectiveTimeColumns, missingHeadersToCreate } =
      resolveEffectiveTimeColumns(existingHeaderKeys);

    // Ensure only missing required columns exist; avoid creating dual (legacy + new) sets.
    const headersInOrder = await ensureHeaders(
      env.GOOGLE_SPREADSHEET_ID!,
      env.GOOGLE_SHEET_RANGE,
      [STAGE_ENTERED_AT_KEY, ...missingHeadersToCreate],
      credentials,
    );

    // Add elapsed minutes to the stage being exited.
    if ((stageChanged || disqualified) && previousStageCanonical) {
      const timeCol = effectiveTimeColumns[previousStageCanonical];
      if (timeCol) {
        const enteredAtRaw = String(currentRow[STAGE_ENTERED_AT_KEY] ?? "").trim();
        const enteredAt = enteredAtRaw ? new Date(enteredAtRaw) : null;
        if (enteredAt && !Number.isNaN(enteredAt.getTime())) {
          const elapsedMs = Date.now() - enteredAt.getTime();
          const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / (1000 * 60)));
          const existingMinutes = parseDurationToMinutes(
            String(currentRow[timeCol] ?? ""),
          );
          updates[timeCol] = formatMinutesHuman(existingMinutes + elapsedMinutes);
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

    // Mirror UI keying for duplicate headers (e.g. "Comments", "Comments (2)")
    // so PATCH updates can target the correct duplicate column by index.
    const columnKeysInOrder = makeColumnDefs(headersInOrder).map((c) => c.key);

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
