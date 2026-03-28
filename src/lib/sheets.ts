import { google, sheets_v4 } from "googleapis";

let cached: sheets_v4.Sheets | null = null;

function getSheetsClient(serviceAccountJson: string): sheets_v4.Sheets {
  if (cached) return cached;
  const credentials = JSON.parse(serviceAccountJson) as Record<string, unknown>;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cached = google.sheets({ version: "v4", auth });
  return cached;
}

export async function fetchSheetValues(
  spreadsheetId: string,
  rangeA1: string,
  serviceAccountJson: string,
): Promise<string[][]> {
  const sheets = getSheetsClient(serviceAccountJson);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return (res.data.values as string[][]) ?? [];
}

/** 0-based column index → A, B, …, Z, AA, … */
export function columnIndexToLetter(colIndex: number): string {
  let dividend = colIndex + 1;
  let columnName = "";
  while (dividend > 0) {
    const mod = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + mod) + columnName;
    dividend = Math.floor((dividend - mod) / 26);
  }
  return columnName;
}

export type ColumnDef = { key: string; label: string };

/** Stable keys for duplicate headers (e.g. Comments, Comments (2)). */
export function makeColumnDefs(rawHeaders: (string | undefined)[]): ColumnDef[] {
  const counts = new Map<string, number>();
  return rawHeaders.map((cell, i) => {
    const label = String(cell ?? "").trim() || `Column ${i + 1}`;
    const n = (counts.get(label) ?? 0) + 1;
    counts.set(label, n);
    const key = n === 1 ? label : `${label} (${n})`;
    return { key, label };
  });
}

/** Row from the sheet: string fields plus numeric `_sheetRow` (1-based). */
export type DealRow = {
  _sheetRow: number;
  [key: string]: string | number;
};

/** First row = headers; data rows include `_sheetRow` (1-based Google sheet row). */
export function rowsToDealRecords(rows: string[][]): {
  columns: ColumnDef[];
  deals: DealRow[];
} {
  if (!rows.length) return { columns: [], deals: [] };
  const rawHeaders = rows[0] ?? [];
  const columns = makeColumnDefs(rawHeaders);
  const deals: DealRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const line = rows[r] ?? [];
    if (line.every((c) => String(c ?? "").trim() === "")) continue;
    const sheetRow = r + 1;
    const obj: DealRow = { _sheetRow: sheetRow };
    columns.forEach((col, i) => {
      obj[col.key] = String(line[i] ?? "").trim();
    });
    deals.push(obj);
  }
  return { columns, deals };
}

/** Parse tab name from `SupplyDump!A:ZZ` or `My Tab!A1` (quoted names supported). */
export function parseTabNameFromRange(rangeA1: string): string {
  const bang = rangeA1.indexOf("!");
  if (bang === -1) return rangeA1;
  let tab = rangeA1.slice(0, bang).trim();
  if (tab.startsWith("'") && tab.endsWith("'")) {
    tab = tab.slice(1, -1).replace(/''/g, "'");
  }
  return tab;
}

export async function batchUpdateCells(
  spreadsheetId: string,
  rangeA1: string,
  sheetRow: number,
  updates: Record<string, string>,
  columnKeysInOrder: string[],
  serviceAccountJson: string,
): Promise<void> {
  const sheets = getSheetsClient(serviceAccountJson);
  const tab = parseTabNameFromRange(rangeA1);
  const needsQuote = /[\s']/.test(tab);
  const tabRef = needsQuote ? `'${tab.replace(/'/g, "''")}'` : tab;

  const keyToIndex = new Map<string, number>();
  columnKeysInOrder.forEach((k, i) => keyToIndex.set(k, i));

  const data: Array<{ range: string; values: string[][] }> = [];
  const unknownKeys: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === "_sheetRow") continue;
    const idx = keyToIndex.get(key);
    if (idx === undefined) {
      unknownKeys.push(key);
      continue;
    }
    const letter = columnIndexToLetter(idx);
    const range = `${tabRef}!${letter}${sheetRow}`;
    data.push({ range, values: [[value]] });
  }

  if (unknownKeys.length) {
    throw new Error(
      `Unknown column key(s): ${unknownKeys.join(", ")}. Headers may not match the loaded sheet.`,
    );
  }

  if (!data.length) {
    const wanted = Object.keys(updates).filter((k) => k !== "_sheetRow");
    if (wanted.length > 0) {
      throw new Error("No valid cells to update.");
    }
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
}

/**
 * Ensure required headers exist on row 1; append any missing headers at the end.
 * Returns the final header list in left-to-right order.
 */
export async function ensureHeaders(
  spreadsheetId: string,
  rangeA1: string,
  requiredHeaders: string[],
  serviceAccountJson: string,
): Promise<string[]> {
  const sheets = getSheetsClient(serviceAccountJson);
  const tab = parseTabNameFromRange(rangeA1);
  const needsQuote = /[\s']/.test(tab);
  const tabRef = needsQuote ? `'${tab.replace(/'/g, "''")}'` : tab;

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabRef}!1:1`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const currentHeaders = ((headerRes.data.values?.[0] as string[]) ?? []).map((h) =>
    String(h ?? "").trim(),
  );

  const missing = requiredHeaders.filter(
    (h) => h && !currentHeaders.includes(h),
  );
  if (!missing.length) return currentHeaders;

  const startCol = currentHeaders.length;
  const endCol = startCol + missing.length - 1;
  const startLetter = columnIndexToLetter(startCol);
  const endLetter = columnIndexToLetter(endCol);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabRef}!${startLetter}1:${endLetter}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [missing] },
  });

  return [...currentHeaders, ...missing];
}

/** A1 tab reference with quoting for names that contain spaces or quotes. */
export function tabRefForSheetName(tabName: string): string {
  const needsQuote = /[\s']/.test(tabName);
  return needsQuote ? `'${tabName.replace(/'/g, "''")}'` : tabName;
}

async function getSheetIdByTitle(
  spreadsheetId: string,
  title: string,
  serviceAccountJson: string,
): Promise<number | null> {
  const sheets = getSheetsClient(serviceAccountJson);
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const found = (meta.data.sheets ?? []).find(
    (s) => s.properties?.title === title,
  );
  const id = found?.properties?.sheetId;
  return id === undefined || id === null ? null : id;
}

/**
 * Create the worksheet if missing; ensure row 1 has the same headers as the main tab when empty.
 */
export async function ensureLostWorksheetWithHeaders(
  spreadsheetId: string,
  lostSheetName: string,
  headerRow: string[],
  serviceAccountJson: string,
): Promise<void> {
  if (!headerRow.length) {
    throw new Error("ensureLostWorksheetWithHeaders: header row is empty.");
  }
  const sheets = getSheetsClient(serviceAccountJson);
  if (
    (await getSheetIdByTitle(
      spreadsheetId,
      lostSheetName,
      serviceAccountJson,
    )) === null
  ) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: lostSheetName },
            },
          },
        ],
      },
    });
  }

  const tabRef = tabRefForSheetName(lostSheetName);
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabRef}!1:1`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const existing = (headerRes.data.values?.[0] as string[]) ?? [];
  const rowEmpty =
    !existing.length ||
    existing.every((c) => !String(c ?? "").trim());
  if (rowEmpty) {
    const endLetter = columnIndexToLetter(headerRow.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabRef}!A1:${endLetter}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headerRow] },
    });
  }
}

export async function appendRowToSheetTab(
  spreadsheetId: string,
  tabName: string,
  rowValues: string[],
  serviceAccountJson: string,
): Promise<void> {
  const sheets = getSheetsClient(serviceAccountJson);
  const tabRef = tabRefForSheetName(tabName);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabRef}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowValues] },
  });
}
