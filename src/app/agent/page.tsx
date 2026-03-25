"use client";

import Link from "next/link";
import { useState } from "react";

type DealRec = {
  sheetRow: number;
  owner: string;
  building: string;
  configuration: string;
  expectedRent: string;
  perUnit: number | null;
  stage: string;
  stageConcept: string;
  stageLastEdit: string;
  source: string;
  phoneMissing: boolean;
  nextStep: string;
};

type MissingPhoneAction = {
  category: string;
  items: Array<{
    sheetRow: number;
    owner: string;
    building: string;
    configuration: string;
    stage: string;
    source: string;
    detail: string;
  }>;
};

type AgentReport = {
  openPipelineCount: number;
  onboardedRecentCount: number;
  overdueCount: number;
  stageCounts: Array<{ stage: string; count: number }>;
  sourceCounts: Array<{ source: string; count: number }>;
  ownerCounts: Array<{ owner: string; count: number }>;
  staleToBeContacted: DealRec[];
  topToPursue: DealRec[];
  /** Full count before list cap (7+ deals → at most 6 cards). */
  topToPursueTotal: number;
  notGreatDeals: DealRec[];
  notGreatDealsTotal: number;
  missingPhoneActions: MissingPhoneAction[];
  /** All missing-phone rows before cap. */
  missingPhoneItemsTotal: number;
};

type AgentChatResponse = {
  assistantText: string;
  intent: string;
  /** Omitted for greeting-only turns — no metrics or deal cards. */
  report?: AgentReport;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  payload?: AgentChatResponse;
};

/** Shapes how the assistant frames the answer (sent as insightFocus; server prepends guidance for the model). */
type InsightFocus = "balanced" | "sla" | "economics" | "contact";

const FOCUS_OPTIONS: Array<{
  id: InsightFocus;
  title: string;
  description: string;
  prefix: string;
}> = [
  {
    id: "balanced",
    title: "Balanced",
    description: "Neutral tone — no extra dashboard; that’s opt-in under each reply.",
    prefix: "",
  },
  {
    id: "sla",
    title: "Speed & SLAs",
    description: "Highlight stuck stages, overdue follow-ups, and time risk.",
    prefix:
      "Emphasize SLA risk, deals stuck in early stages, and overdue follow-ups. ",
  },
  {
    id: "economics",
    title: "Economics",
    description: "Stress per-unit rent, negotiation pressure, and deal quality.",
    prefix:
      "Emphasize per-unit rent, negotiation-heavy deals, and commercial quality. ",
  },
  {
    id: "contact",
    title: "Contact gaps",
    description: "Call out missing phones and enrichment blockers.",
    prefix:
      "Emphasize missing phone numbers, POC contact gaps, and what to fix first. ",
  },
];

const OVERVIEW_PROMPT =
  "Summarize pipeline health by deal stage and sources.";

const QUICK_PROMPTS: Array<{ label: string; prompt: string }> = [
  {
    label: "Stuck in “To be contacted” (72h+)",
    prompt:
      "Which deals are stuck in to be contacted for 72+ hours?",
  },
  {
    label: "Best deals to pursue (value & stage)",
    prompt: "Show me top deals considering per-unit price <= 45,000.",
  },
  {
    label: "Negotiation-heavy / high per-unit",
    prompt:
      "Which deals are not great / negotiation-heavy (per-unit > 45000)?",
  },
  {
    label: "Missing phone — next steps",
    prompt:
      "Which deals are missing phone numbers, and what should we do next?",
  },
  { label: "Full overview", prompt: OVERVIEW_PROMPT },
];

export default function AgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text:
        "Ask about your pipeline in plain language or use a quick prompt. You’ll get a direct answer first — open “Pipeline breakdown” under a reply only if you want metrics and sample rows.",
    },
  ]);
  /** Which assistant messages show the optional KPI + deal cards (off by default). */
  const [pipelineBreakdownOpen, setPipelineBreakdownOpen] = useState<
    Record<string, boolean>
  >({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insightFocus, setInsightFocus] = useState<InsightFocus>("balanced");

  const togglePipelineBreakdown = (messageId: string) => {
    setPipelineBreakdownOpen((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const send = async (text: string) => {
    setError(null);
    setSending(true);
    // Show the question only; framing is sent as insightFocus so "overdue" in SLA presets does not force stuck intent.
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text }]);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          insightFocus,
        }),
      });
      const json = (await res.json()) as Partial<AgentChatResponse> & {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? "Request failed");
      }
      const assistantText =
        json.assistantText ??
        "Done—ask for overdue deals, top pursuits, or missing phones if useful.";
      const payload = json.report
        ? ({
            assistantText,
            intent: (json as AgentChatResponse).intent ?? "overview",
            report: json.report,
          } as AgentChatResponse)
        : assistantText
          ? ({
              assistantText,
              intent: (json as AgentChatResponse).intent ?? "overview",
            } as AgentChatResponse)
          : undefined;
      const assistantId = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        { id: assistantId, role: "assistant", text: assistantText, payload },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Something went wrong: ${msg}. Try again.`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const openPipelineForDeal = (d: { owner: string; stage: string }) => {
    const qs: string[] = [];
    if (d.owner?.trim()) qs.push(`owner=${encodeURIComponent(d.owner.trim())}`);
    if (d.stage?.trim()) qs.push(`stage=${encodeURIComponent(d.stage.trim())}`);
    return `/pipeline${qs.length ? `?${qs.join("&")}` : ""}`;
  };

  const formatPerUnit = (v: number | null) =>
    v == null ? "—" : Math.round(v).toLocaleString();

  const DealCards = ({
    title,
    items,
    totalCount,
    limit = 3,
  }: {
    title: string;
    items: DealRec[];
    /** When set and greater than `items.length`, label shows “Showing n of total”. */
    totalCount?: number;
    limit?: number;
  }) => {
    if (!items.length) return null;
    const countLabel =
      totalCount != null && totalCount > items.length
        ? `Showing ${items.length} of ${totalCount}`
        : `${totalCount ?? items.length} total`;
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-app-border pb-2">
          <h3 className="text-base font-semibold text-app-text">{title}</h3>
          <span className="text-xs font-medium tabular-nums text-app-muted">
            {countLabel}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.slice(0, limit).map((d) => (
            <div key={d.sheetRow} className="surface-elevated p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-app-muted">
                    Row {d.sheetRow}
                  </p>
                  <p className="mt-1 font-semibold leading-snug text-app-text">
                    {d.building}
                  </p>
                  <p className="mt-1 text-sm text-app-muted">
                    {d.configuration} · Rent {d.expectedRent || "—"}
                  </p>
                </div>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <dt className="text-app-muted shrink-0">Stage</dt>
                  <dd className="text-app-text">{d.stage || "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-app-muted shrink-0">Owner</dt>
                  <dd className="text-app-text">{d.owner}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-app-muted shrink-0">Per-unit</dt>
                  <dd className="tabular-nums text-app-text">
                    {formatPerUnit(d.perUnit)}
                  </dd>
                </div>
              </dl>
              {d.nextStep ? (
                <p className="mt-3 border-t border-app-border pt-3 text-sm leading-relaxed text-app-text">
                  {d.nextStep}
                </p>
              ) : null}
              <div className="mt-4">
                <Link
                  href={openPipelineForDeal({ owner: d.owner, stage: d.stage })}
                  className="btn-secondary w-full text-center text-sm sm:w-auto"
                >
                  Open in Pipeline
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text">
      {/* Hero — single column, breathing room */}
      <header className="border-b border-app-border bg-app-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 max-w-xl">
              <p className="text-brand-accent text-[11px] font-semibold uppercase tracking-[0.2em]">
                Flent · AI
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-app-text">
                Pipeline insights
              </h1>
              <p className="mt-3 text-base leading-relaxed text-app-muted">
                Answers are framed for sales ops and leadership — pipeline
                health, economics, and where to focus — not just row counts.
                Grounded on SupplyDump (last 60 days, disqualified blank). Pick
                framing, then ask or use a shortcut.
              </p>
            </div>
            <Link
              href="/pipeline"
              className="btn-secondary shrink-0 self-start px-5 py-2.5"
            >
              Open Pipeline
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Insight focus — replaces opaque “owner scope” */}
        <section className="mb-12" aria-labelledby="insight-focus">
          <h2
            id="insight-focus"
            className="text-lg font-semibold text-app-text"
          >
            How should answers be framed?
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-app-muted">
            Framing only shapes how the answer is written. It does not add charts
            — use Show pipeline breakdown on a reply when you want numbers and sample rows.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FOCUS_OPTIONS.map((opt) => {
              const selected = insightFocus === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setInsightFocus(opt.id)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected
                      ? "border-flentGreen/50 bg-app-hover shadow-sm ring-1 ring-flentGreen/25 dark:border-flentGreen/40 dark:bg-app-hover-strong dark:ring-flentGreen/20"
                      : "border-app-border bg-app-card hover:bg-app-hover dark:hover:bg-app-hover-strong"
                  }`}
                >
                  <span className="font-semibold text-app-text">{opt.title}</span>
                  <span className="mt-1 block text-sm leading-snug text-app-muted">
                    {opt.description}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Quick questions — scannable list, not a wall of pills */}
        <section className="mb-12" aria-labelledby="quick-questions">
          <h2
            id="quick-questions"
            className="text-lg font-semibold text-app-text"
          >
            Quick questions
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            One tap sends the question with your framing choice above.
          </p>
          <ul className="mt-5 flex flex-col gap-2">
            {QUICK_PROMPTS.map(({ label, prompt }) => (
              <li key={label}>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void send(prompt)}
                  className="surface-muted w-full px-4 py-3.5 text-left text-sm font-medium text-app-text transition hover:bg-app-hover disabled:opacity-50 dark:hover:bg-app-hover-strong"
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Conversation */}
        <section aria-label="Conversation" className="space-y-8">
          {messages.map((msg) => (
            <article
              key={msg.id}
              className={
                msg.role === "assistant"
                  ? "surface-elevated p-5 sm:p-6"
                  : "surface-muted border-flentGreen/25 p-5 sm:p-6 dark:border-flentGreen/30"
              }
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">
                {msg.role === "assistant" ? "Assistant" : "You"}
              </p>
              {msg.payload?.report ? (
                <div className="mt-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-app-text">
                    {msg.text}
                  </p>

                  <button
                    type="button"
                    aria-expanded={Boolean(pipelineBreakdownOpen[msg.id])}
                    onClick={() => togglePipelineBreakdown(msg.id)}
                    className="mt-4 rounded-lg border border-app-border bg-app-surface px-4 py-2 text-sm font-medium text-app-text transition hover:bg-app-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ringBrand dark:hover:bg-app-hover-strong"
                  >
                    {pipelineBreakdownOpen[msg.id]
                      ? "Hide pipeline breakdown"
                      : "Show pipeline breakdown"}
                  </button>

                  {pipelineBreakdownOpen[msg.id] ? (
                    <>
                  {msg.payload.report.overdueCount >= 7 ||
                  msg.payload.report.topToPursueTotal >= 7 ||
                  msg.payload.report.notGreatDealsTotal >= 7 ||
                  msg.payload.report.missingPhoneItemsTotal >= 7 ? (
                    <p className="mt-4 rounded-xl border border-app-border bg-app-hover/50 px-4 py-3 text-sm text-app-muted dark:bg-app-hover-strong/40">
                      Sample rows only for big lists — totals above are complete. Open{" "}
                      <Link
                        href="/pipeline"
                        className="font-medium text-brand-accent underline-offset-2 hover:underline"
                      >
                        Pipeline
                      </Link>{" "}
                      to filter and work the full set.
                    </p>
                  ) : null}

                  <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div className="surface-muted p-4">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-app-muted">
                        Active pipeline (60d)
                      </p>
                      <p className="mt-2 text-3xl font-semibold tabular-nums text-app-text">
                        {msg.payload.report.openPipelineCount}
                      </p>
                    </div>
                    <div className="surface-muted p-4">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-app-muted">
                        Onboarded (under contract)
                      </p>
                      <p className="mt-2 text-3xl font-semibold tabular-nums text-app-text">
                        {msg.payload.report.onboardedRecentCount}
                      </p>
                    </div>
                    <div className="surface-muted p-4">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-app-muted">
                        Overdue focus
                      </p>
                      <p className="mt-2 text-3xl font-semibold tabular-nums text-app-text">
                        {msg.payload.report.overdueCount}
                      </p>
                    </div>
                    <div className="surface-muted p-4">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-app-muted">
                        Top source
                      </p>
                      <p className="mt-2 text-lg font-semibold leading-snug text-app-text">
                        {msg.payload.report.sourceCounts[0]?.source || "—"}
                      </p>
                      <p className="mt-1 text-xs text-app-muted">
                        {msg.payload.report.sourceCounts[0]?.count != null
                          ? `${msg.payload.report.sourceCounts[0].count} deals`
                          : ""}
                      </p>
                      <p className="mt-3 text-xs text-app-muted">
                        Top stage:{" "}
                        <span className="font-medium text-app-text">
                          {msg.payload.report.stageCounts[0]?.stage || "—"}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="mt-10 space-y-10">
                    <DealCards
                      title="Overdue: To be contacted (72h+)"
                      items={msg.payload.report.staleToBeContacted}
                      totalCount={msg.payload.report.overdueCount}
                    />
                    <DealCards
                      title="Top deals to pursue"
                      items={msg.payload.report.topToPursue}
                      totalCount={msg.payload.report.topToPursueTotal}
                    />
                    <DealCards
                      title="Not-great / negotiation-heavy"
                      items={msg.payload.report.notGreatDeals}
                      totalCount={msg.payload.report.notGreatDealsTotal}
                    />
                    {msg.payload.report.missingPhoneActions.length ? (
                      <section className="space-y-4">
                        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-app-border pb-2">
                          <h3 className="text-base font-semibold text-app-text">
                            Missing phone contact
                          </h3>
                          <span className="text-xs font-medium tabular-nums text-app-muted">
                            {(() => {
                              const shown = msg.payload.report.missingPhoneActions.reduce(
                                (acc, a) => acc + a.items.length,
                                0,
                              );
                              const total =
                                msg.payload.report.missingPhoneItemsTotal;
                              return total > shown
                                ? `Showing ${shown} of ${total}`
                                : `${total} items`;
                            })()}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          {msg.payload.report.missingPhoneActions.map(
                            (group) => (
                              <div key={group.category} className="surface-elevated p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">
                                  {group.category}
                                </p>
                                <ul className="mt-3 space-y-4">
                                  {group.items.map((it) => (
                                    <li key={it.sheetRow} className="text-sm">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="font-semibold text-app-text">
                                            {it.building}
                                          </p>
                                          <p className="mt-0.5 text-xs text-app-muted">
                                            Row {it.sheetRow} · {it.configuration}{" "}
                                            · {it.stage}
                                          </p>
                                        </div>
                                        <Link
                                          href={openPipelineForDeal({
                                            owner: it.owner,
                                            stage: it.stage,
                                          })}
                                          className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                                        >
                                          Open
                                        </Link>
                                      </div>
                                      <p className="mt-2 text-sm leading-relaxed text-app-muted">
                                        {it.detail}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ),
                          )}
                        </div>
                      </section>
                    ) : null}
                  </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-app-text">
                  {msg.text}
                </p>
              )}
            </article>
          ))}
        </section>

        {error ? (
          <div
            className="mt-8 rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-100"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </main>

      <footer className="sticky bottom-0 z-10 border-t border-app-border bg-app-surface/95 py-4 backdrop-blur-md dark:bg-app-panel/95">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 sm:flex-row sm:items-end sm:px-6 lg:px-8">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Your question</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Summarize pipeline health, or which deals are overdue…"
              rows={2}
              className="w-full resize-y rounded-xl border border-app-border bg-app-input px-4 py-3 text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-ringBrand"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const text = input.trim();
                  if (!text) return;
                  setInput("");
                  void send(text);
                }
              }}
            />
          </label>
          <button
            type="button"
            disabled={sending || !input.trim()}
            onClick={() => {
              const text = input.trim();
              if (!text) return;
              setInput("");
              void send(text);
            }}
            className="btn-primary h-11 shrink-0 px-8"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </footer>
    </div>
  );
}
