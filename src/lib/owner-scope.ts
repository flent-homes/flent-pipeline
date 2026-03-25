/**
 * Match sheet rows by Deal Owner with flexible matching:
 * - empty query → all deals
 * - case-insensitive exact match on trimmed names
 * - else substring match (case-insensitive) on owner field
 */
export function matchDealsByOwnerScope<
  T extends Record<string, string | number> & { _sheetRow: number },
>(
  deals: T[],
  ownerColumnKey: string,
  raw: string | undefined,
): {
  deals: T[];
  resolved: string | null;
  matchMode: "all" | "exact" | "partial" | "no_results";
} {
  const q = raw?.trim();
  if (!q) {
    return { deals, resolved: null, matchMode: "all" };
  }

  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const qn = norm(q);

  const ownerOf = (d: T) => String(d[ownerColumnKey] ?? "").trim();

  // Exact (case-insensitive) match
  const exact = deals.filter((d) => norm(ownerOf(d)) === qn);
  if (exact.length) {
    const distinct = [...new Set(exact.map(ownerOf).filter(Boolean))];
    return {
      deals: exact,
      resolved: distinct[0] ?? q,
      matchMode: "exact",
    };
  }

  // Substring / partial match on owner name
  const partial = deals.filter((d) => norm(ownerOf(d)).includes(qn));
  if (partial.length) {
    const distinct = [...new Set(partial.map(ownerOf).filter(Boolean))];
    return {
      deals: partial,
      resolved:
        distinct.length === 1
          ? distinct[0]!
          : `${distinct.length} owners (${q})`,
      matchMode: "partial",
    };
  }

  return { deals: [], resolved: null, matchMode: "no_results" };
}
