"use client";

import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DealDetailPanel } from "./DealDetailPanel";
import Link from "next/link";
import {
  ACTIVE_DAYS_WINDOW,
  CLUSTER_KEY,
  DATE_ADDED_KEY,
  LISTING_LINK_KEY,
  OWNER_KEY,
  PIPELINE_HIDDEN_COLUMN_KEYS,
  POC_NUMBER_KEY,
  RENT_KEY,
  STAGE_KEY,
  SOURCE_KEY,
  countByStage,
  isActiveDeal,
  isUnderContractDeal,
  isWarmPipelineStage,
  parseSheetDate,
  isWithinLastDays,
  stageSortIndex,
  stageBadgeClass,
  stageConcept,
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

/** Serial / deal # columns — tighter width so other columns get more room on narrow screens. */
function tableColumnWidths(col: ColumnDef): { th: string; td: string } {
  const label = col.label.toLowerCase();
  const key = col.key.toLowerCase();
  const narrow =
    /\bs\.?\s*no\.?\b/.test(label) ||
    /\bdeal\s*no\.?\b/.test(label) ||
    /\bserial\b/.test(label) ||
    key.includes("deal no") ||
    key.includes("s.no") ||
    key.includes("s. no");
  if (narrow) {
    return {
      th: "px-2 py-3.5 font-semibold w-[4.125rem] min-w-[3.575rem] max-w-[4.95rem] whitespace-nowrap",
      td: "max-w-[4.95rem] px-2 py-3 align-top text-app-text tabular-nums whitespace-nowrap",
    };
  }
  return {
    th: "px-4 py-3.5 font-semibold min-w-[120px]",
    td: "max-w-[260px] px-4 py-3 align-top text-app-text",
  };
}

type DealsResponse = {
  columns?: ColumnDef[];
  rowCount?: number;
  deals?: Deal[];
  error?: string;
  message?: string;
};

type ViewMode = "table" | "kanban";
type DealSortOrder = "latest_to_oldest" | "oldest_to_latest";

const EXCLUDED_KANBAN_STAGE_NORMALIZED = new Set([
  "not picking up",
]);

function canonicalKanbanStageLabel(stage: string): string {
  const raw = String(stage ?? "").trim();
  if (!raw) return "";
  const concept = stageConcept(raw);
  switch (concept) {
    case "to_be_contacted":
      // Keep the dedicated POC sub-stage as a separate first column.
      if (raw.toLowerCase() === "to be contacted (poc)") return "To be contacted (POC)";
      return "To be contacted";
    case "in_touch":
      return "In touch";
    case "landlord_interested":
      return "Landlord interested";
    case "evaluation_in_progress":
      return "Evaluation in progress";
    case "qualified":
      return "Qualified";
    case "negotiations_started":
      return "Negotiations started";
    case "offer_extended":
      return "Offer Extended";
    case "under_contract":
      return "Under contract";
    default:
      return raw;
  }
}

function shouldShowKanbanStage(stage: string): boolean {
  const normalized = String(stage ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (EXCLUDED_KANBAN_STAGE_NORMALIZED.has(normalized)) return false;
  // Guard against accidental date values used as stage names.
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normalized)) return false;
  return true;
}

function extractFirstUrl(raw: string): string | null {
  const direct = raw.match(/https?:\/\/[^\s,]+/i);
  if (direct) return direct[0];
  const loose = raw.match(/\b(?:www\.)[^\s,]+/i);
  if (loose) return `https://${loose[0]}`;
  return null;
}

function normalizePhoneForCopy(raw: string): string {
  return raw.replace(/[^\d+]/g, "").trim();
}

function formatElapsedSince(isoValue: string): string | null {
  const d = new Date(isoValue);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60)));
  const days = Math.floor(mins / (24 * 60));
  const hours = Math.floor((mins % (24 * 60)) / 60);
  const minutes = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function elapsedMinutesSince(isoValue: string): number | null {
  const d = new Date(isoValue);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60)));
}

function isDisqualifiedValue(value: string | number | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toggleSelection(prev: string[], value: string): string[] {
  if (prev.includes(value)) return prev.filter((v) => v !== value);
  return [...prev, value];
}

export default function PipelinePage() {
  const [data, setData] = useState<DealsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [stageFilters, setStageFilters] = useState<string[]>([]);
  /** When true, table/stages show only Landlord interested and later funnel stages. */
  const [warmFunnelOnly, setWarmFunnelOnly] = useState(false);
  const [ownerFilters, setOwnerFilters] = useState<string[]>([]);
  const [sourceFilters, setSourceFilters] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [sortOrder, setSortOrder] = useState<DealSortOrder>("latest_to_oldest");
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
  const [draggingRow, setDraggingRow] = useState<number | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [movingRow, setMovingRow] = useState<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);

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
    setOwnerFilters(parseCsvParam(params.get("owner")));
    setStageFilters(parseCsvParam(params.get("stage")));
    setSourceFilters(parseCsvParam(params.get("source")));
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
    const ownerSet = new Set(ownerFilters);
    const sourceSet = new Set(sourceFilters);
    return recentDeals.filter((d) => {
      if (warmFunnelOnly && !isWarmPipelineStage(d[STAGE_KEY])) {
        return false;
      }
      if (ownerSet.size > 0) {
        const owner = String(d[OWNER_KEY] ?? "").trim() || "(unassigned)";
        if (!ownerSet.has(owner)) return false;
      }
      if (sourceSet.size > 0) {
        const source = String(d[SOURCE_KEY] ?? "").trim() || "(unassigned)";
        if (!sourceSet.has(source)) return false;
      }
      if (!q) return true;
      return Object.values(d).some((v) =>
        String(v).toLowerCase().includes(q),
      );
    });
  }, [recentDeals, query, ownerFilters, sourceFilters, warmFunnelOnly]);

  const stageCounts = useMemo(
    () => countByStage(dealsForStageStats),
    [dealsForStageStats],
  );
  const stageOptions = useMemo(() => {
    return Array.from(stageCounts.keys()).sort((a, b) => {
      const ia = stageSortIndex(a);
      const ib = stageSortIndex(b);
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });
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
  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of recentDeals) {
      const source = String(d[SOURCE_KEY] ?? "").trim() || "(unassigned)";
      m.set(source, (m.get(source) ?? 0) + 1);
    }
    return m;
  }, [recentDeals]);
  const sourceOptions = useMemo(
    () =>
      Array.from(sourceCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name),
    [sourceCounts],
  );

  const filteredDeals = useMemo(() => {
    const q = query.trim().toLowerCase();
    const stageSet = new Set(stageFilters);
    const ownerSet = new Set(ownerFilters);
    const sourceSet = new Set(sourceFilters);
    return recentDeals.filter((d) => {
      if (warmFunnelOnly && !isWarmPipelineStage(d[STAGE_KEY])) {
        return false;
      }
      if (stageSet.size > 0) {
        const stage = String(d[STAGE_KEY] ?? "").trim();
        if (!stageSet.has(stage)) return false;
      }
      if (ownerSet.size > 0) {
        const owner = String(d[OWNER_KEY] ?? "").trim() || "(unassigned)";
        if (!ownerSet.has(owner)) return false;
      }
      if (sourceSet.size > 0) {
        const source = String(d[SOURCE_KEY] ?? "").trim() || "(unassigned)";
        if (!sourceSet.has(source)) return false;
      }
      if (!q) return true;
      return Object.values(d).some((v) =>
        String(v).toLowerCase().includes(q),
      );
    });
  }, [recentDeals, query, stageFilters, ownerFilters, sourceFilters, warmFunnelOnly]);

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
    return [...list].sort((a, b) => {
      const da = parseSheetDate(a[DATE_ADDED_KEY]);
      const db = parseSheetDate(b[DATE_ADDED_KEY]);
      if (da && db) {
        const diff = da.getTime() - db.getTime();
        if (diff !== 0) {
          return sortOrder === "latest_to_oldest" ? -diff : diff;
        }
      } else if (da && !db) {
        return sortOrder === "latest_to_oldest" ? -1 : 1;
      } else if (!da && db) {
        return sortOrder === "latest_to_oldest" ? 1 : -1;
      }
      return sortOrder === "latest_to_oldest"
        ? b._sheetRow - a._sheetRow
        : a._sheetRow - b._sheetRow;
    });
  }, [filteredDeals, aiRecommendedOnly, aiRecommendedRows, sortOrder]);

  /** Kanban should always show full stage columns, even if some are empty. */
  const kanbanColumns = useMemo(() => {
    const stageOpts = selectOptionsForColumn(STAGE_KEY, deals).filter(Boolean);
    for (const s of stageFilters) {
      if (s && !stageOpts.includes(s)) stageOpts.push(s);
    }

    const canonical = new Map<string, true>();
    for (const s of stageOpts) {
      const label = canonicalKanbanStageLabel(s);
      if (!shouldShowKanbanStage(label)) continue;
      canonical.set(label, true);
    }
    return [...canonical.keys()].sort((a, b) => {
      const ia = stageSortIndex(a);
      const ib = stageSortIndex(b);
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });
  }, [deals, stageFilters]);

  const kanbanByStage = useMemo(() => {
    const m = new Map<string, Deal[]>();
    for (const stage of kanbanColumns) {
      m.set(stage, []);
    }
    for (const d of visibleDeals) {
      const s = canonicalKanbanStageLabel(String(d[STAGE_KEY] ?? "").trim());
      if (!shouldShowKanbanStage(s)) continue;
      if (!s) continue;
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(d);
    }
    return m;
  }, [kanbanColumns, visibleDeals]);

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
      const json = (await res.json()) as {
        error?: string;
        message?: string;
        movedToLost?: boolean;
      };
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
      if (json.movedToLost) void load();
    } catch {
      setSaveError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }, [activeCell, cellDraft, cancelInlineEdit, load]);

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
      const json = (await res.json()) as {
        error?: string;
        message?: string;
        movedToLost?: boolean;
      };
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
      if (json.movedToLost) void load();
    } catch {
      setSaveError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }, [selected, editDraft, load]);

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

  const moveDealToStage = useCallback(
    async (rowId: number, targetStage: string) => {
      const row = dealsRef.current.find((d) => d._sheetRow === rowId);
      if (!row) return;
      const prevStage = String(row[STAGE_KEY] ?? "").trim();
      if (!targetStage || prevStage === targetStage) return;

      setSaveError(null);
      setMovingRow(rowId);

      const applyLocalStage = (stage: string) => {
        setData((prevData) => {
          if (!prevData?.deals) return prevData;
          return {
            ...prevData,
            deals: prevData.deals.map((d) =>
              d._sheetRow === rowId ? { ...d, [STAGE_KEY]: stage } : d,
            ),
          };
        });
        setSelected((prevSel) =>
          prevSel && prevSel._sheetRow === rowId
            ? { ...prevSel, [STAGE_KEY]: stage }
            : prevSel,
        );
        setEditDraft((ed) => {
          const sel = selectedRef.current;
          if (sel && sel._sheetRow === rowId) {
            return { ...ed, [STAGE_KEY]: stage };
          }
          return ed;
        });
      };

      applyLocalStage(targetStage);

      try {
        const res = await fetch(`/api/deals/${rowId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [STAGE_KEY]: targetStage }),
        });
        const json = (await res.json()) as {
          error?: string;
          message?: string;
          movedToLost?: boolean;
        };
        if (!res.ok) {
          applyLocalStage(prevStage);
          setSaveError(json.message ?? json.error ?? "Save failed");
        } else if (json.movedToLost) {
          void load();
        }
      } catch {
        applyLocalStage(prevStage);
        setSaveError("Network error while saving.");
      } finally {
        setMovingRow(null);
      }
    },
    [load],
  );

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
              if (next) setStageFilters([]);
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
            <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">
                  Owner
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOwnerFilters([])}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${ownerFilters.length === 0 ? "border-flentGreen/45 bg-flentGreen/15 font-semibold text-app-text dark:bg-flentGreen/25 dark:text-white" : "border-app-border text-app-muted hover:bg-app-hover dark:hover:bg-app-hover-strong"}`}
                  >
                    All owners
                  </button>
                  {ownerOptions.map((owner) => (
                    <button
                      key={owner}
                      type="button"
                      onClick={() =>
                        setOwnerFilters((prev) => toggleSelection(prev, owner))
                      }
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${ownerFilters.includes(owner) ? "border-flentGreen/40 bg-flentGreen/15 font-semibold text-app-text dark:bg-flentGreen/25 dark:text-white" : "border-app-border text-app-muted hover:bg-app-hover dark:hover:bg-app-hover-strong"}`}
                    >
                      {owner} ({ownerCounts.get(owner)})
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0 flex-1 lg:border-l lg:border-app-border lg:pl-8">
                <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">
                  Source
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSourceFilters([])}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${sourceFilters.length === 0 ? "border-flentGreen/45 bg-flentGreen/15 font-semibold text-app-text dark:bg-flentGreen/25 dark:text-white" : "border-app-border text-app-muted hover:bg-app-hover dark:hover:bg-app-hover-strong"}`}
                  >
                    All sources
                  </button>
                  {sourceOptions.map((source) => (
                    <button
                      key={source}
                      type="button"
                      onClick={() =>
                        setSourceFilters((prev) => toggleSelection(prev, source))
                      }
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${sourceFilters.includes(source) ? "border-flentGreen/40 bg-flentGreen/15 font-semibold text-app-text dark:bg-flentGreen/25 dark:text-white" : "border-app-border text-app-muted hover:bg-app-hover dark:hover:bg-app-hover-strong"}`}
                    >
                      {source} ({sourceCounts.get(source)})
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0 flex-1 lg:border-l lg:border-app-border lg:pl-8">
                <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">
                  Stage
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setWarmFunnelOnly(false);
                      setStageFilters([]);
                    }}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
                      stageFilters.length === 0
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
                        setStageFilters((prev) => toggleSelection(prev, s));
                      }}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
                        stageFilters.includes(s)
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
                      ? "bg-app-surface text-app-text shadow-sm ring-1 ring-app-border/60 dark:bg-app-card dark:text-app-text dark:ring-white/15"
                      : "text-app-muted hover:text-app-text"
                  }`}
                >
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("kanban")}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    viewMode === "kanban"
                      ? "bg-app-surface text-app-text shadow-sm ring-1 ring-app-border/60 dark:bg-app-card dark:text-app-text dark:ring-white/15"
                      : "text-app-muted hover:text-app-text"
                  }`}
                >
                  Kanban
                </button>
              </div>
              <label className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-surface px-3 py-2 text-xs text-app-muted dark:bg-app-panel/80">
                <span className="font-medium uppercase tracking-wider">Sort</span>
                <select
                  value={sortOrder}
                  onChange={(e) =>
                    setSortOrder(e.target.value as DealSortOrder)
                  }
                  className="rounded-md border border-app-border bg-app-input px-2 py-1 text-xs text-app-text focus:outline-none focus:ring-2 focus:ring-ringBrand"
                  aria-label="Sort deals"
                >
                  <option value="latest_to_oldest">Latest to oldest</option>
                  <option value="oldest_to_latest">Oldest to latest</option>
                </select>
              </label>
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
            <div className="max-h-[72vh] overflow-auto rounded-2xl border border-app-border bg-app-panel/95 shadow-brand backdrop-blur-sm">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="sticky top-0 z-30">
                  <tr className="border-b border-app-border text-[11px] uppercase tracking-wider text-app-muted shadow-[0_1px_0_0_rgba(148,163,184,0.35)]">
                    {visibleColumns.map((col) => {
                      const cw = tableColumnWidths(col);
                      return (
                        <th
                          key={col.key}
                          className={`${cw.th} sticky top-0 z-30 bg-app-surface text-app-muted`}
                        >
                          {col.label}
                        </th>
                      );
                    })}
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
                          const cw = tableColumnWidths(col);
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
                          const isTimeInColumn = /^time in /i.test(col.key);
                          const currentStageLabel = canonicalKanbanStageLabel(
                            String(row[STAGE_KEY] ?? ""),
                          );
                          const columnStageLabel = isTimeInColumn
                            ? canonicalKanbanStageLabel(col.key.replace(/^time in /i, ""))
                            : "";
                          const enteredAtRaw = String(row["Stage Entered At"] ?? "").trim();
                          const runningStageTime = enteredAtRaw
                            ? formatElapsedSince(enteredAtRaw)
                            : null;
                          const shouldShowRunningStageTime =
                            isTimeInColumn &&
                            !displayVal &&
                            !!runningStageTime &&
                            !isDisqualifiedValue(row["Disqualified"]) &&
                            columnStageLabel === currentStageLabel;

                          return (
                            <td
                              key={col.key}
                              className={cw.td}
                              onPointerDown={() => {
                                if (col.key !== POC_NUMBER_KEY || editing) return;
                                suppressClickRef.current = false;
                                if (longPressTimerRef.current) {
                                  window.clearTimeout(longPressTimerRef.current);
                                }
                                longPressTimerRef.current = window.setTimeout(() => {
                                  const rawPhone = String(row[col.key] ?? "");
                                  const phone = normalizePhoneForCopy(rawPhone) || rawPhone.trim();
                                  if (!phone) return;
                                  suppressClickRef.current = true;
                                  void navigator.clipboard.writeText(phone);
                                  setCopiedMsg(`Copied: ${phone}`);
                                  window.setTimeout(() => setCopiedMsg(null), 1400);
                                }, 600);
                              }}
                              onPointerUp={() => {
                                if (longPressTimerRef.current) {
                                  window.clearTimeout(longPressTimerRef.current);
                                  longPressTimerRef.current = null;
                                }
                              }}
                              onPointerCancel={() => {
                                if (longPressTimerRef.current) {
                                  window.clearTimeout(longPressTimerRef.current);
                                  longPressTimerRef.current = null;
                                }
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (suppressClickRef.current) {
                                  suppressClickRef.current = false;
                                  return;
                                }
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
                              ) : col.key === LISTING_LINK_KEY ? (
                                (() => {
                                  const href = extractFirstUrl(displayVal);
                                  if (!href) {
                                    return (
                                      <span className="line-clamp-3 break-words">
                                        {displayVal || "—"}
                                      </span>
                                    );
                                  }
                                  return (
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="inline-flex max-w-full items-center gap-1 text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                    >
                                      <span className="truncate">{displayVal || href}</span>
                                    </a>
                                  );
                                })()
                              ) : shouldShowRunningStageTime ? (
                                <span className="line-clamp-3 break-words">
                                  {runningStageTime}
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

          {!loading && !data?.error && viewMode === "kanban" && (
            <div className="overflow-x-auto pb-3">
              <div className="flex min-w-max items-start gap-4">
                {kanbanColumns.map((stage) => {
                  const rows = kanbanByStage.get(stage) ?? [];
                  const dropActive = dropStage === stage;
                  return (
                    <section
                      key={stage}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropStage(stage);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const transferred = Number.parseInt(
                          e.dataTransfer.getData("text/plain"),
                          10,
                        );
                        const rowId = Number.isFinite(transferred)
                          ? transferred
                          : draggingRow;
                        setDropStage(null);
                        setDraggingRow(null);
                        if (!rowId) return;
                        void moveDealToStage(rowId, stage);
                      }}
                      className={`w-[292px] shrink-0 rounded-2xl border bg-app-panel/95 p-3 shadow-brand backdrop-blur-sm transition ${
                        dropActive
                          ? "border-flentGreen/55 ring-2 ring-flentGreen/25"
                          : "border-app-border"
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span
                          className={`stage-badge inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${stageBadgeClass(stage)}`}
                        >
                          {stage}
                        </span>
                        <span className="text-xs text-app-muted">
                          {rows.length} deals
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {rows.map((row) => {
                          const active = selected?._sheetRow === row._sheetRow;
                          const pending = movingRow === row._sheetRow;
                          const cell = (key: string | null) =>
                            key ? String(row[key] ?? "").trim() || "—" : "—";
                          return (
                            <article
                              key={row._sheetRow}
                              draggable={!pending}
                              onDragStart={(e) => {
                                setDraggingRow(row._sheetRow);
                                e.dataTransfer.setData(
                                  "text/plain",
                                  String(row._sheetRow),
                                );
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                setDraggingRow(null);
                                setDropStage(null);
                              }}
                              onClick={() => openDealPanel(row)}
                              className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${
                                pending
                                  ? "border-app-border bg-app-surface2 opacity-60"
                                  : active
                                    ? "border-flentGreen/45 bg-flentGreen/12 dark:bg-flentGreen/20"
                                    : "border-app-border bg-app-card text-app-text hover:border-flentGreen/35 hover:bg-app-hover dark:bg-app-card"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="line-clamp-2 text-sm font-semibold text-app-text">
                                  {cell(stageViewKeys.locality)}
                                </p>
                                <span className="shrink-0 text-[11px] tabular-nums text-app-muted">
                                  #{row._sheetRow}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-app-muted">
                                <span className="truncate">Src: {cell(stageViewKeys.source)}</span>
                                <span className="whitespace-nowrap">{cell(stageViewKeys.price)}</span>
                              </div>
                              <p className="mt-1 line-clamp-1 text-xs text-app-muted">
                                Cluster: {cell(CLUSTER_KEY)}
                              </p>
                              <p className="mt-1 line-clamp-1 text-xs text-app-muted">
                                {cell(stageViewKeys.furnishing)}
                              </p>
                              {(() => {
                                const enteredAt = String(row["Stage Entered At"] ?? "").trim();
                                const elapsed = enteredAt ? formatElapsedSince(enteredAt) : null;
                                const elapsedMins = enteredAt
                                  ? elapsedMinutesSince(enteredAt)
                                  : null;
                                if (!elapsed) return null;
                                const elapsedClass =
                                  elapsedMins !== null && elapsedMins > 48 * 60
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                                    : elapsedMins !== null && elapsedMins > 24 * 60
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
                                return (
                                  <p className={`mt-2 inline-flex rounded-md px-2 py-1 text-[11px] font-medium ${elapsedClass}`}>
                                    In stage: {elapsed}
                                  </p>
                                );
                              })()}
                              {pending ? (
                                <p className="mt-2 text-[11px] font-medium text-app-muted">
                                  Updating stage…
                                </p>
                              ) : null}
                            </article>
                          );
                        })}
                        {rows.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-app-border px-3 py-6 text-center text-xs text-app-muted">
                            Drop deals here
                          </div>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>

      {selected && (
        <DealDetailPanel
          selected={selected}
          columns={visibleColumns}
          editDraft={editDraft}
          setEditDraft={setEditDraft}
          fieldOptions={fieldOptions}
            saveError={saveError}
          aiLoading={aiLoading}
          aiResult={aiResult}
          onClose={() => setSelected(null)}
          onAiScore={(apply) => void runAiScore(apply)}
        />
      )}
      {copiedMsg ? (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[220] -translate-x-1/2 rounded-full bg-app-panel px-4 py-2 text-xs text-app-text shadow-brand ring-1 ring-app-border">
          {copiedMsg}
        </div>
      ) : null}
    </div>
  );
}
