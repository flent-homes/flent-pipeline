import {
  DISQ_KEY,
  POC_TYPE_KEY,
  SOURCE_KEY,
  STAGE_KEY,
  STAGE_ORDER,
} from "./helpers";

/** Columns that must be edited via dropdown in the table (values from sheet + sensible presets). */
export const DROPDOWN_COLUMN_KEYS = new Set([
  STAGE_KEY,
  DISQ_KEY,
  POC_TYPE_KEY,
  SOURCE_KEY,
]);

function uniqSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function uniqueColumnValues(
  deals: Array<Record<string, string | number>>,
  colKey: string,
): string[] {
  const out = new Set<string>();
  for (const d of deals) {
    const v = String(d[colKey] ?? "").trim();
    if (v) out.add(v);
  }
  return uniqSorted(out);
}

/** Options for <select>: presets first in pipeline order, then any other values seen in the sheet. */
export function selectOptionsForColumn(
  colKey: string,
  deals: Array<Record<string, string | number>>,
): string[] {
  if (colKey === STAGE_KEY) {
    const seen = uniqueColumnValues(deals, STAGE_KEY);
    const preset = [...STAGE_ORDER];
    const merged = new Map<string, true>();
    const out: string[] = [];
    for (const p of preset) {
      if (!merged.has(p)) {
        merged.set(p, true);
        out.push(p);
      }
    }
    for (const s of seen) {
      if (!merged.has(s)) {
        merged.set(s, true);
        out.push(s);
      }
    }
    return out;
  }
  if (colKey === DISQ_KEY) {
    const seen = uniqueColumnValues(deals, DISQ_KEY);
    const preset = ["Yes", "No", "Y", "N"];
    const merged = new Set<string>([...preset, ...seen]);
    return uniqSorted(merged);
  }
  if (colKey === POC_TYPE_KEY || colKey === SOURCE_KEY) {
    return uniqueColumnValues(deals, colKey);
  }
  return [];
}

/** Empty option label for optional clears (Disqualified often blank). */
export function allowEmptyOption(colKey: string): boolean {
  return colKey === DISQ_KEY;
}
