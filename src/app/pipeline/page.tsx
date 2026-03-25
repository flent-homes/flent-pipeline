"use client";

import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DealDetailPanel } from "./DealDetailPanel";
import Link from "next/link";
import {
  ACTIVE_DAYS_WINDOW,
  CLUSTER_KEY,
  DATE_ADDED_KEY,
  OWNER_KEY,
  PIPELINE_HIDDEN_COLUMN_KEYS,
  RENT_KEY,
  STAGE_KEY,
  SOURCE_KEY,
  countByStage,
  isActiveDeal,
  isUnderContractDeal,
  isWarmPipelineStage,
  isWithinLastDays,
  stageSortIndex,
  stageBadgeClass,
} from "./helpers";
import { DROPDOWN_COLUMN_KEYS, selectOptionsForColumn } from "./columnOptions";
import { getAiPicksToBeContacted } from "@/lib/agentRules";

type ColumnDef = { key: string; label: string };

type Deal = Record<string, string | number> & { _sheetRow: number };

/** Match loaded sheet headers (case-insensitive) to the first candidate that exists. */
function resolveColumnKey(columns: ColumnDef[], candidates: string[]): string | null {
  const exact = new Set(columns.map((c) => c.key));
  for (const cand of candidates) {
    if (exact.has(cand)) return cand;
  }
  const lowerToKey = new Map<string, string>();
  for (const c of columns) {
    lowerToKey.set(c.key.toLowerCase(), c.key);
  }
  for (const cand of candidates) {
    const k = lowerToKey.get(cand.toLowerCase());
    if (k) return k;
  }
  return null;
}

type DealsResponse = {
  columns?: ColumnDef[];
  rowCount?: number;
  deals?: Deal[];
  error?: string;
  message?: string;
};

type ViewMode = "table" | "stages";

export default function PipelinePage() {
  const [data, setData] = useState<DealsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");
  /** When true, table/stages show only Landlord interested and later funnel stages. */
  const [warmFunnelOnly, setWarmFunnelOnly] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  /** Show only rows the rule engine ranks as “top to pursue” (same logic as the agent). */
  const [aiRecommendedOnly, setAiRecommendedOnly] = useState(false);
  const [selected, setSelected] = useState<Deal | null>(null);
  const selectedRef = useRef<Deal | null>(null);
  selectedRef.current = selected;
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  /** Single-cell inline edit: explicit Save / Cancel only (no blur autosave). */
  const [activeCell, setActiveCell] = useState<{
    row: Deal;
    colKey: string;
  } | null>(null);
  const [cellDraft, setCellDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setAiResult(null);
    try {
      const res = await fetch("/api/deals");
      const json = (await res.json()) as DealsResponse;
      setData(json);
    } catch {
      setData({ error: "fetch_failed", message: "Could not reach /api/deals" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const owner = params.get("owner") ?? "";
    const stage = params.get("stage") ?? "";
    if (owner) setOwnerFilter(owner);
    if (stage) setStageFilter(stage);
  }, []);

  const columns = useMemo(() => data?.columns ?? [], [data?.columns]);
  const deals = useMemo(() => data?.deals ?? [], [data?.deals]);
  const dealsRef = useRef(deals);
  dealsRef.current = deals;

  /** All non-DQ deals in the 60d window (includes Under contract / onboarded). */
  const recentDeals = useMemo(() => {
    return deals.filter(
      (d) =>
        isActiveDeal(d) &&
        isWithinLastDays(d[DATE_ADDED_KEY], ACTIVE_DAYS_WINDOW),
    );
  }, [deals]);

  /** In-motion work only — excludes Under contract (onboarded). */
  const openPipelineDeals = useMemo(
    () => recentDeals.filter((d) => !isUnderContractDeal(d)),
    [recentDeals],
  );

  /**
   * Scope for stage pill counts: same as the table except **stage** selection.
   * So when an owner (or warm funnel / search) is applied, per-stage numbers match that slice.
   */
  const dealsForStageStats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recentDeals.filter((d) => {
      if (warmFunnelOnly && !isWarmPipelineStage(d[STAGE_KEY])) {
        return false;
      }
      if (ownerFilter) {
        const owner = String(d[OWNER_KEY] ?? "").trim() || "(unassigned)";
        if (owner !== ownerFilter) return false;
      }
      if (!q) return true;
      return Object.values(d).some((v) =>
        String(v).toLowerCase().includes(q),
      );
    });
  }, [recentDeals, query, ownerFilter, warmFunnelOnly]);

  const stageCounts = useMemo(
    () => countByStage(dealsForStageStats),
    [dealsForStageStats],
  );
  const stageOptions = useMemo(() => {
    return Array.from(stageCounts.keys()).sort(
      (a, b) => stageSortIndex(a) - stageSortIndex(b),
    );
  }, [stageCounts]);

  const ownerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of recentDeals) {
      const owner = String(d[OWNER_KEY] ?? "").trim() || "(unassigned)";
      m.set(owner, (m.get(owner) ?? 0) + 1);
    }
    return m;
  }, [recentDeals]);
  const ownerOptions = useMemo(
    () =>
      Array.from(ownerCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name),
    [ownerCounts],
  );

  const filteredDeals = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recentDeals.filter((d) => {
      if (warmFunnelOnly && !isWarmPipelineStage(d[STAGE_KEY])) {
        return false;
      }
      if (stageFilter && String(d[STAGE_KEY] ?? "").trim() !== stageFilter) {
        return false;
      }
      if (ownerFilter) {
        const owner = String(d[OWNER_KEY] ?? "").trim() || "(unassigned)";
        if (owner !== ownerFilter) return false;
      }
      if (!q) return true;
      return Object.values(d).some((v) =>
        String(v).toLowerCase().includes(q),
      );
    });
  }, [recentDeals, query, stageFilter, ownerFilter, warmFunnelOnly]);

  const { aiRecommendedRows, aiRecommendedCount } = useMemo(() => {
    const picks = getAiPicksToBeContacted(filteredDeals);
    return {
      aiRecommendedRows: new Set(picks.map((r) => r.sheetRow)),
      aiRecommendedCount: picks.length,
    };
  }, [filteredDeals]);

  const visibleDeals = useMemo(() => {
    let list = filteredDeals;
    if (aiRecommendedOnly) {
      list = filteredDeals.filter((d) => aiRecommendedRows.has(d._sheetRow));
    }
    return [...list].sort((a, b) => a._sheetRow - b._sheetRow);
  }, [filteredDeals, aiRecommendedOnly, aiRecommendedRows]);

  /** Grouped by stage; empty string = missing stage (shown as "No stage set", not a funnel pill). */
  const groupedEntries = useMemo(() => {
    const m = new Map<string, Deal[]>();
    for (const d of visibleDeals) {
      const s = String(d[STAGE_KEY] ?? "").trim();
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(d);
    }
    return [...m.entries()].sort(([a], [b]) => {
      const emptyA = !a;
      const emptyB = !b;
      if (emptyA && !emptyB) return 1;
      if (!emptyA && emptyB) return -1;
      const ia = stageSortIndex(a);
      const ib = stageSortIndex(b);
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });
  }, [visibleDeals]);

  const kpis = useMemo(() => {
    const total = deals.length;
    const warmOrLateRecent = openPipelineDeals.filter((d) =>
      isWarmPipelineStage(d[STAGE_KEY]),
    ).length;
    const openPipeline = openPipelineDeals.length;
    const onboardedRecent = recentDeals.filter((d) =>
      isUnderContractDeal(d),
    ).length;
    return {
      total,
      warmOrLateRecent,
      openPipeline,
      onboardedRecent,
      filtered: filteredDeals.length,
    };
  }, [deals.length, filteredDeals.length, openPipelineDeals, recentDeals]);

  const visibleColumns = useMemo(() => {
    // Keep exact sheet order; hide synthetic empty columns and pipeline-hidden fields.
    return columns.filter(
      (c) =>
        !/^Column \d+$/.test(c.label) &&
        !PIPELINE_HIDDEN_COLUMN_KEYS.has(c.key),
    );
  }, [columns]);

  /** "By stage" table: Deal No, Source, Price, Locality, Furnishing — keys resolved from actual headers. */
  const stageViewKeys = useMemo(() => {
    const r = (cands: string[]) => resolveColumnKey(columns, cands);
    return {
      dealNo: r([
        "Deal No",
        "S. No.",
        "S No",
        "S.No",
        "S.No.",
        "Deal No.",
        "Serial No",
      ]),
      source: r([SOURCE_KEY, "Source"]),
      price: r([RENT_KEY, "Price", "Rent", "Monthly Rent", "Expected rent"]),
      locality: r(["Locality", CLUSTER_KEY, "Area", "Location"]),
      furnishing: r([
        "Furnishing Status",
        "Furnishing",
        "Furnishing status",
        "Furnished",
      ]),
    };
  }, [columns]);

  const fieldOptions = useMemo(() => {
    const o: Record<string, string[] | undefined> = {};
    for (const k of DROPDOWN_COLUMN_KEYS) {
      o[k] = selectOptionsForColumn(k, deals);
    }
    return o;
  }, [deals]);

  const openCellEdit = useCallback((sheetRow: number, colKey: string) => {
    const row = dealsRef.current.find((d) => d._sheetRow === sheetRow);
    if (!row) return;
    setSaveError(null);
    setActiveCell({ row, colKey });
    setCellDraft(String(row[colKey] ?? ""));
  }, []);

  const cancelInlineEdit = useCallback(() => {
    setActiveCell(null);
    setCellDraft("");
    setSaveError(null);
  }, []);

  const saveInlineCell = useCallback(async () => {
    const ac = activeCell;
    if (!ac) return;
    const draft = cellDraft;
    const prev = String(ac.row[ac.colKey] ?? "");
    if (draft === prev) {
      cancelInlineEdit();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/deals/${ac.row._sheetRow}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [ac.colKey]: draft }),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setSaveError(json.message ?? json.error ?? "Save failed");
        return;
      }
      setSaveError(null);
      const payload = { [ac.colKey]: draft } as Record<string, string>;
      setData((prevData) => {
        if (!prevData?.deals) return prevData;
        return {
          ...prevData,
          deals: prevData.deals.map((d) =>
            d._sheetRow === ac.row._sheetRow ? { ...d, ...payload } : d,
          ),
        };
      });
      setSelected((prevSel) =>
        prevSel && prevSel._sheetRow === ac.row._sheetRow
          ? { ...prevSel, ...payload }
          : prevSel,
      );
      setEditDraft((ed) => {
        const sel = selectedRef.current;
        if (sel && sel._sheetRow === ac.row._sheetRow) {
          return { ...ed, [ac.colKey]: draft };
        }
        return ed;
      });
      setActiveCell(null);
      setCellDraft("");
    } catch {
      setSaveError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }, [activeCell, cellDraft, cancelInlineEdit]);

  const openDealPanel = useCallback((row: Deal) => {
    setActiveCell(null);
    setCellDraft("");
    setSelected(row);
    setAiResult(null);
  }, []);

  const onCellDoubleClick = useCallback(
    (e: MouseEvent, row: Deal) => {
      e.preventDefault();
      const mergedRow =
        dealsRef.current.find((d) => d._sheetRow === row._sheetRow) ?? row;
      openDealPanel(mergedRow);
    },
    [openDealPanel],
  );

  /** Only reset panel draft when switching rows — not when `selected` is replaced after an inline save (same row). */
  const lastDraftRowRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selected) {
      setEditDraft({});
      lastDraftRowRef.current = null;
      return;
    }
    const row = selected._sheetRow;
    if (lastDraftRowRef.current !== row) {
      lastDraftRowRef.current = row;
      const draft: Record<string, string> = {};
      for (const c of visibleColumns) {
        if (c.key === "_sheetRow") continue;
        draft[c.key] = String(selected[c.key] ?? "");
      }
      setEditDraft(draft);
      setSaveError(null);
      return;
    }
    // Same row: merge in newly visible columns if the sheet finished loading after the panel opened.
    if (visibleColumns.length === 0) return;
    setEditDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of visibleColumns) {
        if (c.key === "_sheetRow") continue;
        if (!(c.key in next)) {
          next[c.key] = String(selected[c.key] ?? "");
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selected, visibleColumns]);

  const persistEdits = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    const payload: Record<string, string> = {};
    for (const k of Object.keys(editDraft)) {
      if (editDraft[k] !== String(selected[k] ?? "")) {
        payload[k] = editDraft[k];
      }
    }
    if (Object.keys(payload).length === 0) {
      setSaving(false);
      return;
    }
    try {
      const res = await fetch(`/api/deals/${selected._sheetRow}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setSaveError(json.message ?? json.error ?? "Save failed");
        return;
      }
      const rowId = selected._sheetRow;
      setSelected((prev) => (prev ? { ...prev, ...payload } : prev));
      setEditDraft((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(payload)) {
          next[k] = payload[k];
        }
        return next;
      });
      setData((prev) => {
        if (!prev?.deals) return prev;
        return {
          ...prev,
          deals: prev.deals.map((d) =>
            d._sheetRow === rowId ? { ...d, ...payload } : d,
          ),
        };
      });
    } catch {
      setSaveError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }, [selected, editDraft]);

  const isDirty = useMemo(() => {
    if (!selected) return false;
    for (const c of visibleColumns) {
      if (c.key === "_sheetRow") continue;
      if (String(editDraft[c.key] ?? "") !== String(selected[c.key] ?? "")) {
        return true;
      }
    }
    return false;
  }, [visibleColumns, editDraft, selected]);

  // Auto-save: after you stop typing for ~1s, persist diffs to Sheets.
  useEffect(() => {
    if (!selected) return;
    if (!isDirty) return;
    const t = window.setTimeout(() => {
      void persistEdits();
    }, 500);
    return () => window.clearTimeout(t);
  }, [selected, isDirty, persistEdits]);

  const runAiScore = async (applyToSheet: boolean) => {
    if (!selected) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await fetch("/api/ai/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetRow: selected._sheetRow,
          applyToSheet,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        message?: string;
        score?: number;
        tier?: string;
        reason?: string;
      };
      if (!res.ok) {
        setAiResult(`${json.error ?? "error"}: ${json.message ?? ""}`);
        return;
      }
      setAiResult(
        `Score ${json.score} · Tier ${json.tier}\n\n${json.reason ?? ""}`,
      );
      if (applyToSheet) await load();
    } catch {
      setAiResult("Request failed.");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text flex flex-col">
      <header className="border-b border-app-border bg-app-surface">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-start justify-between gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="relative max-w-xl pl-3 border-l-2 border-flentGreen/60">
          <p className="text-brand-accent text-[11px] font-semibold uppercase tracking-[0.2em]">
            Flent supply
          </p>
          <h1 className="text-2xl font-semibold text-app-text mt-1 tracking-tight">
            Pipeline
          </h1>
          <p className="text-sm text-app-muted mt-1 max-w-xl">
            Open pipeline (last {ACTIVE_DAYS_WINDOW} days) excludes Under contract (onboarded). Edits save to Google Sheets.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void load()}
          className="btn-primary px-5 py-2.5"
        >
          Refresh
        </button>
        <Link
          href="/agent"
          className="btn-secondary px-5 py-2.5"
        >
          AI insights
        </Link>
        </div>
        </div>
      </header>

      {/* KPI strip */}
      <section className="border-b border-app-border bg-app-surface2/80 backdrop-blur-sm">
        <div className="mx-auto grid max-w-[1600px] grid-cols-2 gap-4 px-4 py-8 sm:px-6 md:grid-cols-3 lg:grid-cols-5 lg:gap-5 lg:px-10">
        <div className="rounded-xl border border-app-border bg-app-card px-4 py-3 shadow-sm shadow-flentNight/5">
          <p className="text-[11px] uppercase tracking-wider text-app-muted">Total in tab</p>
          <p className="text-2xl font-semibold text-app-text tabular-nums">{kpis.total}</p>
        </div>
        <button
          type="button"
          aria-pressed={warmFunnelOnly}
          aria-label={
            warmFunnelOnly
              ? "Warm funnel filter on, click to clear"
              : "Filter to warm funnel only"
          }
          onClick={() => {
            setWarmFunnelOnly((prev) => {
              const next = !prev;
              if (next) setStageFilter("");
              return next;
            });
          }}
          className={`group text-left rounded-2xl border px-4 py-4 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ringBrand ${
            warmFunnelOnly
              ? "border-flentGreen/50 bg-flentGreen/[0.12] ring-1 ring-flentGreen/30 dark:bg-flentGreen/20 dark:ring-flentGreen/25"
              : "border-app-border bg-app-card hover:border-flentGreen/35 hover:bg-app-hover dark:hover:bg-app-hover-strong"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold leading-tight text-app-text">
                Warm funnel
              </p>
              <p className="mt-1 text-xs leading-snug text-app-muted">
                Landlord interested → Offer extended
              </p>
            </div>
            <span
              className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                warmFunnelOnly
                  ? "bg-flentGreen/25 text-app-text dark:bg-flentGreen/35 dark:text-white"
                  : "bg-app-surface2 text-app-muted group-hover:bg-app-hover dark:bg-white/5"
              }`}
            >
              {warmFunnelOnly ? "On" : "Filter"}
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-app-text">
            {kpis.warmOrLateRecent}
          </p>
          <p className="mt-2 text-[11px] text-app-muted">
            {warmFunnelOnly
              ? "Showing these deals below · click again to clear"
              : "Click to show only this funnel"}
          </p>
        </button>
        <div className="rounded-xl border border-app-border bg-app-card px-4 py-3 shadow-sm shadow-flentNight/5">
          <p className="text-[11px] uppercase tracking-wider text-app-muted">
            Active pipeline (last {ACTIVE_DAYS_WINDOW}d)
          </p>
          <p className="text-2xl font-semibold text-app-text tabular-nums">
            {kpis.openPipeline}
          </p>
        </div>
        <div className="rounded-xl border border-app-border bg-app-card px-4 py-3 shadow-sm shadow-flentNight/5">
          <p className="text-[11px] uppercase tracking-wider text-app-muted">Onboarded (under contract)</p>
          <p className="text-2xl font-semibold text-app-text tabular-nums">
            {kpis.onboardedRecent}
          </p>
        </div>
        <div className="hidden rounded-xl border border-flentGreen/25 bg-gradient-to-br from-flentGreen/12 to-flentNight/10 px-4 py-3 md:block dark:from-flentGreen/18 dark:to-flentNight/20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-brand-accent">Stages</p>
          <p className="text-sm text-app-muted leading-snug">
            {stageOptions.length} distinct · use pills below
          </p>
        </div>
        </div>
      </section>

      {/* Controls: filters in a card; search on its own row */}
      <div className="border-b border-app-border bg-app-bg">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="surface-muted p-5 sm:p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">
                  Owner
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOwnerFilter("")}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${!ownerFilter ? "border-flentGreen/45 bg-flentGreen/15 font-semibold text-app-text dark:bg-flentGreen/25 dark:text-white" : "border-app-border text-app-muted hover:bg-app-hover dark:hover:bg-app-hover-strong"}`}
                  >
                    All owners
                  </button>
                  {ownerOptions.map((owner) => (
                    <button
                      key={owner}
                      type="button"
                      onClick={() =>
                        setOwnerFilter(owner === ownerFilter ? "" : owner)
                      }
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${ownerFilter === owner ? "border-flentGreen/40 bg-flentGreen/15 font-semibold text-app-text dark:bg-flentGreen/25 dark:text-white" : "border-app-border text-app-muted hover:bg-app-hover dark:hover:bg-app-hover-strong"}`}
                    >
                      {owner} ({ownerCounts.get(owner)})
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0 flex-1 lg:border-l lg:border-app-border lg:pl-10">
                <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">
                  Stage
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setWarmFunnelOnly(false);
                      setStageFilter("");
                    }}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
                      !stageFilter
                        ? "border-flentGreen/45 bg-flentGreen/15 font-semibold text-app-text dark:bg-flentGreen/25 dark:text-white"
                        : "border-app-border text-app-muted hover:bg-app-hover dark:hover:bg-app-hover-strong"
                    }`}
                  >
                    All ({dealsForStageStats.length})
                  </button>
                  {stageOptions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setWarmFunnelOnly(false);
                        setStageFilter(s === stageFilter ? "" : s);
                      }}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
                        stageFilter === s
                          ? "border-flentNight/40 bg-flentNight/10 font-semibold text-flentNight dark:bg-flentNight/35 dark:text-white"
                          : "border-app-border text-app-muted hover:bg-app-hover dark:hover:bg-app-hover-strong"
                      }`}
                    >
                      {s} ({stageCounts.get(s)})
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-5">
            <div className="relative min-w-0 flex-1">
              <span
                className="pointer-events-none absolute left-4 top-1/2 z-[1] -translate-y-1/2 text-flentGreen/70 dark:text-flentGreen/80"
                aria-hidden
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </span>
              <input
                type="search"
                placeholder="Search building, POC, source, rent…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-full border-0 bg-app-input py-3.5 pl-12 pr-5 text-sm text-app-text shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-inset ring-app-border/70 placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-flentGreen/35 dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:gap-4 lg:shrink-0">
              {/* Read-only count — typographic + divider, not another “card” */}
              <div
                className="flex min-h-[3rem] flex-col justify-center border-l-0 border-t border-app-border pt-3 sm:border-l-2 sm:border-t-0 sm:border-flentNight/25 sm:pl-4 sm:pt-0 dark:sm:border-flentNight/35"
                aria-live="polite"
              >
                <span className="text-[10px] font-medium uppercase tracking-wider text-app-muted">
                  {aiRecommendedOnly ? "Showing (AI filter)" : "Matching rows"}
                </span>
                <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0">
                  <span className="text-2xl font-bold tabular-nums leading-none tracking-tight text-app-text">
                    {aiRecommendedOnly ? visibleDeals.length : kpis.filtered}
                  </span>
                  {aiRecommendedOnly ? (
                    <span className="text-xs tabular-nums text-app-muted">
                      of {kpis.filtered} · {aiRecommendedCount} To be contacted
                    </span>
                  ) : null}
                </span>
              </div>

              {/* AI filter — pill + icon; reads as a control, not a stat box */}
              <button
                type="button"
                aria-pressed={aiRecommendedOnly}
                aria-label={
                  aiRecommendedOnly
                    ? "Show all matching rows"
                    : "Show only AI-recommended deals"
                }
                onClick={() => setAiRecommendedOnly((v) => !v)}
                className={`group inline-flex items-center gap-3 rounded-full border-2 px-1.5 py-1.5 pl-2 pr-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-flentGreen/50 focus-visible:ring-offset-2 focus-visible:ring-offset-appBg ${
                  aiRecommendedOnly
                    ? "border-flentGreen/55 bg-gradient-to-r from-flentGreen/[0.14] to-flentNight/[0.12] shadow-md shadow-flentGreen/10 dark:from-flentGreen/25 dark:to-flentNight/25 dark:shadow-flentGreen/20"
                    : "border-dashed border-app-border/90 bg-app-surface/80 hover:border-flentGreen/35 hover:bg-app-hover dark:bg-app-panel/80 dark:hover:bg-app-hover-strong"
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${
                    aiRecommendedOnly
                      ? "bg-flentGreen text-white shadow-inner dark:bg-flentGreen dark:text-white"
                      : "bg-app-surface2 text-flentNight/80 ring-1 ring-app-border/60 group-hover:bg-flentGreen/10 group-hover:text-flentGreen dark:bg-white/5 dark:text-flentGreen/90"
                  }`}
                  aria-hidden
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
                    />
                  </svg>
                </span>
                <span className="min-w-0 pr-1">
                  <span className="block text-sm font-semibold leading-tight text-app-text">
                    AI picks
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-app-muted">
                    {aiRecommendedOnly
                      ? "Filter on"
                      : aiRecommendedCount > 0
                        ? `${aiRecommendedCount} in To be contacted`
                        : "To be contacted only"}
                  </span>
                </span>
              </button>

              {/* View mode — segmented pills inside a track */}
              <div
                className="inline-flex rounded-full bg-app-surface2/90 p-1 ring-1 ring-app-border/80 dark:bg-black/25 dark:ring-white/10"
                role="group"
                aria-label="View layout"
              >
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    viewMode === "table"
                      ? "bg-white text-app-text shadow-sm ring-1 ring-app-border/50 dark:bg-white/15 dark:text-white dark:ring-white/10"
                      : "text-app-muted hover:text-app-text"
                  }`}
                >
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("stages")}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    viewMode === "stages"
                      ? "bg-white text-app-text shadow-sm ring-1 ring-app-border/50 dark:bg-white/15 dark:text-white dark:ring-white/10"
                      : "text-app-muted hover:text-app-text"
                  }`}
                >
                  By stage
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-auto px-4 py-8 sm:px-6 lg:px-10 min-w-0">
          {loading && (
            <div className="flex items-center gap-2 text-app-muted text-sm">
              <span className="inline-block h-4 w-4 border-2 border-flentGreen/40 border-t-flentGreen/70 rounded-full animate-spin" />
              Loading pipeline…
            </div>
          )}

          {!loading && data?.error === "missing_config" && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 text-sm max-w-2xl dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-medium mb-2">Sheets not connected</p>
              <p className="text-amber-900/90 dark:text-amber-200/80">{data.message}</p>
            </div>
          )}

          {!loading && data?.error === "sheets_fetch_failed" && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-950 text-sm max-w-2xl dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-100">
              <p className="font-medium mb-1">Could not read the spreadsheet</p>
              <p className="text-red-900/90 dark:text-red-200/80">{data.message}</p>
            </div>
          )}

          {!loading && !data?.error && visibleDeals.length === 0 && (
            <p className="text-app-muted text-sm">
              {filteredDeals.length > 0 && aiRecommendedOnly
                ? "No AI-recommended deals in this filtered view. Turn off the toggle or widen filters."
                : "No matching rows. Clear filters or search."}
            </p>
          )}

          {!loading && !data?.error && viewMode === "table" && visibleDeals.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-app-border bg-app-panel/95 shadow-brand backdrop-blur-sm">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead>
                  <tr className="border-b border-app-border bg-app-surface2/50 text-[11px] uppercase tracking-wider text-app-muted dark:bg-white/[0.03]">
                    {visibleColumns.map((col) => (
                      <th key={col.key} className="px-4 py-3.5 font-semibold min-w-[120px]">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleDeals.map((row) => {
                    const rowActive =
                      selected?._sheetRow === row._sheetRow ||
                      activeCell?.row._sheetRow === row._sheetRow;
                    return (
                      <tr
                        key={row._sheetRow}
                        className={`border-b border-app-border/50 dark:border-white/5 transition-colors hover:bg-app-hover ${
                          rowActive ? "bg-flentGreen/15 dark:bg-flentGreen/20" : ""
                        }`}
                      >
                        {visibleColumns.map((col) => {
                          const editing =
                            activeCell?.row._sheetRow === row._sheetRow &&
                            activeCell.colKey === col.key;
                          const isDropdown = DROPDOWN_COLUMN_KEYS.has(col.key);
                          const baseOpts = fieldOptions[col.key] ?? [];
                          const displayVal = String(row[col.key] ?? "");
                          const selectOpts =
                            isDropdown && editing
                              ? (() => {
                                  const s = [...baseOpts];
                                  if (
                                    cellDraft &&
                                    !s.includes(cellDraft)
                                  ) {
                                    s.push(cellDraft);
                                  }
                                  return s.sort((a, b) =>
                                    a.localeCompare(b),
                                  );
                                })()
                              : [];

                          return (
                            <td
                              key={col.key}
                              className="max-w-[260px] px-4 py-3 align-top text-app-text"
                              onClick={(e) => {
                                e.stopPropagation();
                                openCellEdit(row._sheetRow, col.key);
                              }}
                              onDoubleClick={(e) => onCellDoubleClick(e, row)}
                            >
                              {editing ? (
                                <div
                                  className="relative z-30 min-w-[220px]"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="rounded-xl border border-flentGreen/25 bg-app-card p-2 shadow-lg">
                                    {isDropdown ? (
                                      <select
                                        autoFocus
                                        value={cellDraft}
                                        onChange={(e) =>
                                          setCellDraft(e.target.value)
                                        }
                                        className="w-full rounded-lg border border-app-border bg-app-input px-2 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-ringBrand"
                                      >
                                        <option value="">—</option>
                                        {selectOpts.map((opt) => (
                                          <option key={opt} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <textarea
                                        autoFocus
                                        rows={3}
                                        value={cellDraft}
                                        onChange={(e) =>
                                          setCellDraft(e.target.value)
                                        }
                                        className="w-full rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm leading-relaxed text-app-text focus:outline-none focus:ring-2 focus:ring-ringBrand"
                                      />
                                    )}
                                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                                      {saveError && (
                                        <span className="mr-auto text-[11px] text-red-600 dark:text-red-400">
                                          {saveError}
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={cancelInlineEdit}
                                        className="rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-xs font-medium text-app-text hover:bg-app-hover"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => void saveInlineCell()}
                                        className="rounded-lg bg-flentGreen px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                                      >
                                        {saving ? "Saving…" : "Save"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : col.key === STAGE_KEY ? (
                                <span
                                  className={`stage-badge inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${stageBadgeClass(displayVal)}`}
                                >
                                  {displayVal || "—"}
                                </span>
                              ) : (
                                <span className="line-clamp-3 break-words">
                                  {displayVal || "—"}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !data?.error && viewMode === "stages" && visibleDeals.length > 0 && (
            <div className="space-y-6">
              {groupedEntries.map(([stage, rows]) => (
                <section key={stage || "__no_stage__"}>
                  <div className="flex items-baseline gap-3 mb-2">
                    {stage ? (
                      <span
                        className={`stage-badge inline-flex rounded-full border px-3 py-1 text-sm font-medium ${stageBadgeClass(stage)}`}
                      >
                        {stage}
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-app-muted">
                        No stage set
                      </span>
                    )}
                    <span className="text-xs text-app-muted">{rows.length} leads</span>
                  </div>
                  <div className="overflow-x-auto rounded-2xl border border-app-border bg-app-panel/95 shadow-brand backdrop-blur-sm">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-app-border bg-app-surface2/50 text-[11px] uppercase tracking-wider text-app-muted dark:bg-white/[0.03]">
                          <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                            Deal No
                          </th>
                          <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                            Source
                          </th>
                          <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                            Price
                          </th>
                          <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                            Locality
                          </th>
                          <th className="min-w-[120px] px-3 py-2.5 font-semibold">
                            Furnishing Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const active = selected?._sheetRow === row._sheetRow;
                          const cell = (key: string | null) =>
                            key ? String(row[key] ?? "").trim() || "—" : "—";
                          return (
                            <tr
                              key={row._sheetRow}
                              role="button"
                              tabIndex={0}
                              onClick={() => openDealPanel(row)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openDealPanel(row);
                                }
                              }}
                              className={`cursor-pointer border-b border-app-border/50 transition-colors hover:bg-app-hover ${
                                active
                                  ? "bg-flentGreen/15 dark:bg-flentGreen/20"
                                  : ""
                              }`}
                            >
                              <td className="px-3 py-2.5 tabular-nums text-app-text">
                                {cell(stageViewKeys.dealNo)}
                              </td>
                              <td className="px-3 py-2.5 text-app-text max-w-[180px]">
                                <span className="line-clamp-2 break-words">
                                  {cell(stageViewKeys.source)}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-app-text whitespace-nowrap">
                                {cell(stageViewKeys.price)}
                              </td>
                              <td className="px-3 py-2.5 text-app-text max-w-[200px]">
                                <span className="line-clamp-2 break-words">
                                  {cell(stageViewKeys.locality)}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-app-text max-w-[220px]">
                                <span className="line-clamp-2 break-words">
                                  {cell(stageViewKeys.furnishing)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </main>

        {selected && (
          <DealDetailPanel
            selected={selected}
            columns={visibleColumns}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            fieldOptions={fieldOptions}
            saving={saving}
            saveError={saveError}
            aiLoading={aiLoading}
            aiResult={aiResult}
            onClose={() => setSelected(null)}
            onAiScore={(apply) => void runAiScore(apply)}
          />
        )}
      </div>
    </div>
  );
}
