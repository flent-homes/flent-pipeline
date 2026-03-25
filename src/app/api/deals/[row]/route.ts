import { NextResponse } from "next/server";
import { z } from "zod";
import {
  batchUpdateCells,
  fetchSheetValues,
  rowsToDealRecords,
} from "@/lib/sheets";
import { getServerEnv, sheetsConfigured } from "@/lib/env";
import { resolveServiceAccountJson } from "@/lib/google-credentials";

const patchBodySchema = z.record(z.string(), z.string());

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

    const { columns } = rowsToDealRecords(rows);
    const columnKeysInOrder = columns.map((c) => c.key);

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
