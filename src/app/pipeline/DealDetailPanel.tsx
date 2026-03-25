"use client";

import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import {
  BUILDING_KEY,
  CLUSTER_KEY,
  DATE_ADDED_KEY,
  DISQ_KEY,
  LISTING_LINK_KEY,
  OWNER_KEY,
  POC_TYPE_KEY,
  RENT_KEY,
  SOURCE_KEY,
  STAGE_KEY,
  stageBadgeClass,
} from "./helpers";

type ColumnDef = { key: string; label: string };

type Deal = Record<string, string | number> & { _sheetRow: number };

type Props = {
  selected: Deal;
  columns: ColumnDef[];
  editDraft: Record<string, string>;
  setEditDraft: Dispatch<SetStateAction<Record<string, string>>>;
  /** Options for dropdown-only columns (stage, disqualified, POC type, source); omit key for free text. */
  fieldOptions: Record<string, string[] | undefined>;
  saving: boolean;
  saveError: string | null;
  aiLoading: boolean;
  aiResult: string | null;
  onClose: () => void;
  onAiScore: (applyToSheet: boolean) => void;
};

const HIGHLIGHT_KEYS = new Set([
  STAGE_KEY,
  RENT_KEY,
  OWNER_KEY,
  CLUSTER_KEY,
  SOURCE_KEY,
  POC_TYPE_KEY,
  DATE_ADDED_KEY,
  DISQ_KEY,
  BUILDING_KEY,
  LISTING_LINK_KEY,
]);

function FieldEditor({
  colKey,
  label,
  value,
  options,
  onChange,
}: {
  colKey: string;
  label: string;
  value: string;
  /** When defined (including empty array), render a dropdown; otherwise a textarea. */
  options?: string[];
  onChange: (v: string) => void;
}) {
  const isDropdown = options !== undefined;

  const opts = useMemo(() => {
    const base = options ?? [];
    if (value && !base.includes(value)) return [...base, value].sort((a, b) => a.localeCompare(b));
    return base;
  }, [options, value]);

  if (isDropdown) {
    return (
      <label className="block">
        <span className="text-[11px] text-app-muted">{label}</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg bg-app-input border border-app-border px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-ringBrand"
        >
          <option value="">—</option>
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="text-[11px] text-app-muted">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={colKey.includes("Comment") ? 3 : 2}
        className="mt-1 w-full rounded-lg bg-app-input border border-app-border px-3 py-2 text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-ringBrand"
      />
    </label>
  );
}

export function DealDetailPanel({
  selected,
  columns,
  editDraft,
  setEditDraft,
  fieldOptions,
  saving,
  saveError,
  aiLoading,
  aiResult,
  onClose,
  onAiScore,
}: Props) {
  const [showAllFields, setShowAllFields] = useState(false);

  const listingUrl = String(selected[LISTING_LINK_KEY] ?? "").trim();
  const mapsUrl = String(selected["Google Map Location"] ?? "").trim();

  const highlightCols = useMemo(
    () =>
      columns.filter(
        (c) => HIGHLIGHT_KEYS.has(c.key) || c.key.startsWith("AI_"),
      ),
    [columns],
  );

  const restCols = useMemo(
    () =>
      columns.filter(
        (c) =>
          c.key !== "_sheetRow" &&
          !HIGHLIGHT_KEYS.has(c.key) &&
          !c.key.startsWith("AI_"),
      ),
    [columns],
  );

  return (
    <aside className="w-full max-w-[420px] shrink-0 border-l border-flentGreen/10 bg-app-panel flex flex-col h-full shadow-brand dark:border-flentNight/20">
      <div className="p-4 border-b border-app-border flex justify-between items-start gap-3 bg-gradient-to-br from-flentNight/12 via-app-panel to-flentGreen/[0.06] dark:from-flentNight/25 dark:via-app-panel dark:to-flentGreen/10">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-flentGreen font-medium dark:text-flentCyan/90">
            Row {selected._sheetRow}
          </p>
          <h2 className="text-lg font-semibold text-app-text mt-1 leading-snug">
            {String(selected[BUILDING_KEY] || selected["Property Type"] || "Untitled lead")}
          </h2>
          <div className="flex flex-wrap gap-2 mt-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${stageBadgeClass(String(selected[STAGE_KEY] ?? ""))}`}
            >
              {String(selected[STAGE_KEY] || "—")}
            </span>
            {String(selected[RENT_KEY] || "").trim() && (
              <span className="text-xs text-flentGreen bg-flentGreen/10 border border-flentGreen/30 rounded-full px-2.5 py-0.5 font-medium dark:text-flentCyan dark:bg-flentGreen/15 dark:border-flentGreen/35">
                {String(selected[RENT_KEY])}
              </span>
            )}
            {String(selected[CLUSTER_KEY] || "").trim() && (
              <span className="text-xs text-app-muted">{String(selected[CLUSTER_KEY])}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg px-2 py-1 text-sm text-app-muted hover:text-app-text hover:bg-app-hover dark:hover:bg-app-hover-strong"
        >
          ✕
        </button>
      </div>

      <div className="px-4 py-3 border-b border-app-border flex flex-wrap gap-2">
        {listingUrl && /^https?:\/\//i.test(listingUrl) && (
          <a
            href={listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium rounded-lg bg-flentGreen/20 text-flentGreen border border-flentGreen/40 px-3 py-1.5 hover:bg-flentGreen/30 dark:text-white"
          >
            Open listing
          </a>
        )}
        {mapsUrl && /^https?:\/\//i.test(mapsUrl) && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium rounded-lg bg-app-hover-night text-flentNight border border-flentNight/25 px-3 py-1.5 hover:bg-app-hover-night-strong dark:text-flentCyan dark:border-flentCyan/25 dark:bg-flentNight/15 dark:hover:bg-flentNight/25"
          >
            Maps
          </a>
        )}
        <button
          type="button"
          disabled={aiLoading}
          onClick={() => onAiScore(false)}
          className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-app-surface2 text-app-text border border-app-border hover:bg-app-hover disabled:opacity-50 dark:bg-app-hover-night dark:text-flentCyan/90 dark:border-flentNight/25 dark:hover:bg-app-hover-night-strong"
        >
          {aiLoading ? "AI…" : "AI score"}
        </button>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(
              `${String(selected[BUILDING_KEY] || "Lead")} · row ${selected._sheetRow}`,
            )
          }
          className="text-xs text-app-muted hover:text-app-text px-2 py-1"
        >
          Copy label
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-app-muted font-semibold mb-2">
            Pipeline
          </h3>
          <div className="grid gap-2">
            {highlightCols.map((col) => (
              <FieldEditor
                key={col.key}
                colKey={col.key}
                label={col.label}
                value={editDraft[col.key] ?? ""}
                options={fieldOptions[col.key]}
                onChange={(v) =>
                  setEditDraft((d) => ({ ...d, [col.key]: v }))
                }
              />
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={() => setShowAllFields((v) => !v)}
          className="text-xs text-flentGreen hover:text-flentNight font-medium dark:text-flentCyan dark:hover:text-flentCyan/80"
        >
          {showAllFields ? "Hide" : "Show"} all sheet columns ({restCols.length})
        </button>

        {showAllFields && (
          <section className="space-y-2 border-t border-app-border pt-4">
            {restCols.map((col) => (
              <FieldEditor
                key={col.key}
                colKey={col.key}
                label={col.label}
                value={editDraft[col.key] ?? ""}
                options={fieldOptions[col.key]}
                onChange={(v) =>
                  setEditDraft((d) => ({ ...d, [col.key]: v }))
                }
              />
            ))}
          </section>
        )}

        {saveError && (
          <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 dark:text-red-400 dark:bg-red-950/40 dark:border-red-500/30">
            {saveError}
          </p>
        )}

        {aiResult && (
          <div className="rounded-lg border border-flentGreen/15 bg-app-surface2 p-3 text-xs text-app-text whitespace-pre-wrap max-h-40 overflow-y-auto dark:bg-app-hover-night/50 dark:border-flentNight/20">
            {aiResult}
          </div>
        )}

        {/* Sticky actions so reps never need to scroll down to Save. */}
        <div className="sticky bottom-0 left-0 right-0 bg-app-panel/95 backdrop-blur border-t border-flentGreen/10 p-3 z-20 dark:border-flentNight/15">
          <div className="flex items-center justify-between gap-3">
            {saving ? (
              <span className="text-xs text-app-muted">Auto-saving…</span>
            ) : (
              <span className="text-xs text-app-muted">Edits auto-apply to Sheets</span>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => onAiScore(false)}
                className="rounded-lg border border-app-border bg-app-surface2 px-3 py-2 text-sm text-app-text hover:bg-app-hover disabled:opacity-50 dark:border-flentNight/20 dark:bg-app-hover-night dark:text-flentCyan/90 dark:hover:bg-app-hover-night-strong"
              >
                {aiLoading ? "…" : "AI score"}
              </button>
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => onAiScore(true)}
                className="rounded-lg border border-flentGreen/45 bg-flentGreen/12 px-3 py-2 text-sm font-semibold text-flentGreen hover:bg-flentGreen/20 disabled:opacity-50 dark:border-flentCyan/35 dark:bg-flentGreen/20 dark:text-flentCyan dark:hover:bg-flentGreen/28"
              >
                Score + sheet
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
