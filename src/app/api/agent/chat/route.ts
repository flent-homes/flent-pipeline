import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv, sheetsConfigured } from "@/lib/env";
import { resolveServiceAccountJson } from "@/lib/google-credentials";
import { fetchSheetValues, rowsToDealRecords } from "@/lib/sheets";
import { computeAgentInsights } from "@/lib/agentRules";
import { matchDealsByOwnerScope } from "@/lib/owner-scope";
import {
  FLENT_INTERPRETATION_CONTEXT,
  FLENT_INTERPRETATION_HINTS,
} from "@/lib/flentAgentInterpretationContext";
import {
  FLENT_EXECUTIVE_HINTS,
  FLENT_EXECUTIVE_SYSTEM_CONTEXT,
} from "@/lib/flentBusinessContext";
import {
  buildNarrativeContextHints,
  type NarrativeContextHints,
} from "@/lib/agentNarrativeHints";
import {
  asksAboutTeamRepPerformance,
  isConversationalOnlyMessage,
  isPureAcknowledgment,
  matchOwnersNamedInMessage,
  sliceDealListForReport,
  truncateMissingPhoneForReport,
} from "@/lib/agentIntent";
import {
  countByStage,
  DATE_ADDED_KEY,
  OWNER_KEY,
  SOURCE_KEY,
  isActiveDeal,
  isOpenPipelineDeal,
  isUnderContractDeal,
  isWithinLastDays,
} from "@/app/pipeline/helpers";

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  ownerScope: z.string().min(1).optional(),
  /** Framing for the answer; sent separately so keywords like "overdue" in presets do not force intent. */
  insightFocus: z.enum(["balanced", "sla", "economics", "contact"]).optional(),
});

type InsightFocus = "balanced" | "sla" | "economics" | "contact";

const FOCUS_PREFIX: Record<InsightFocus, string> = {
  balanced: "",
  sla: "Emphasize SLA risk, deals stuck in early stages, and overdue follow-ups. ",
  economics:
    "Emphasize per-unit rent, negotiation-heavy deals, and commercial quality. ",
  contact: "Emphasize missing phone numbers, POC contact gaps, and what to fix first. ",
};

type NarrativeReport = {
  openPipelineCount: number;
  onboardedRecentCount: number;
  overdueCount?: number;
  stageCounts: Array<{ stage: string; count: number }>;
  sourceCounts: Array<{ source: string; count: number }>;
  ownerCounts: Array<{ owner: string; count: number }>;
  staleToBeContacted?: Array<{
    sheetRow: number;
    building: string;
    owner: string;
    nextStep: string;
  }>;
  topToPursue: Array<{ sheetRow: number; building: string; owner: string; nextStep: string }>;
  notGreatDeals: Array<{ sheetRow: number; building: string; owner: string; nextStep: string }>;
  missingPhoneActions: Array<{
    category: string;
    items: Array<{ sheetRow: number; building: string; owner: string; detail: string }>;
  }>;
};

async function writeNarrativeWithOpenAI(args: {
  apiKey: string;
  model: string;
  message: string;
  ownerScope?: string;
  intent: string;
  /** When false, overdue/stale fields are omitted so the model does not lead with SLA every time. */
  includeStaleInNarrative: boolean;
  /** Some deal lists are capped at 3 rows when 7+ exist — use totals + contextHints. */
  anyListTruncated: boolean;
  contextHints: NarrativeContextHints;
  report: NarrativeReport;
}): Promise<string> {
  const system = `${FLENT_INTERPRETATION_CONTEXT}

${FLENT_EXECUTIVE_SYSTEM_CONTEXT}

You are a strong operations copilot for Flent’s landlord supply pipeline — behave like a good assistant humans actually want to read.

How good assistants act:
- Respect attention: default to short, scannable answers. No walls of text, no enumerating long lists row-by-row.
- Situation-aware: match depth to intent. Overview = headline metrics + patterns (stages, sources, where load sits). Overdue/SLA = time risk + who is overloaded, not a catalog of buildings.
- Progressive disclosure: lead with the insight that helps a rep decide the next hour — not every field from every sample row.
- When counts are large, summarize patterns (see contextHints: owner/stage/source breakdown). Treat sample rows in "report" as illustrations only — never read them out as if they were the full dataset.
- Never blame individuals; focus on process and next steps.
- Ground every factual claim in "report" or "contextHints" only — do not invent numbers.

Output JSON with key: narrative (string).

Narrative format (keep tight):
1) One-line headline
2) 2-4 bullets (not 5 unless truly needed), each one insight-dense — prefer patterns over repetition
3) "Immediate next 3 actions" as a numbered list${
    args.includeStaleInNarrative
      ? ""
      : `

Turn constraint: The report does NOT include overdue / stuck "To be contacted" (72h SLA) rows for this turn. Do not mention overdue SLA or stuck early-stage lists. Use only fields present in the report.`
  }${
    args.anyListTruncated
      ? `

Turn constraint: Deal rows in "report" are a small UI sample when a category has 7+ items. Use overdueCount, stageCounts, ownerCounts, and contextHints for totals and who carries load — never imply the pipeline only has three deals.`
      : ""
  }`;

  const user = JSON.stringify(
    {
      query: args.message,
      intent: args.intent,
      ownerScope: args.ownerScope ?? null,
      interpretation: FLENT_INTERPRETATION_HINTS,
      flentBusiness: FLENT_EXECUTIVE_HINTS,
      contextHints: args.contextHints,
      report: args.report,
    },
    null,
    2,
  );

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "agent_narrative",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              narrative: { type: "string" },
            },
            required: ["narrative"],
          },
        },
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI narrative ${res.status}: ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI narrative returned empty output.");
  const parsed = JSON.parse(text) as { narrative?: string };
  return parsed.narrative?.trim() || "";
}

export async function POST(request: Request) {
  const env = getServerEnv();
  const credentials = resolveServiceAccountJson(env);
  if (!sheetsConfigured(env) || !credentials) {
    return NextResponse.json(
      {
        error: "missing_config",
        message:
          "Set GOOGLE_SPREADSHEET_ID and service account key path for Sheets access.",
      },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { ownerScope, message, insightFocus: focusRaw } = parsed.data;
  const insightFocus: InsightFocus = focusRaw ?? "balanced";

  if (isConversationalOnlyMessage(message)) {
    return NextResponse.json({
      assistantText:
        "Hi — I’m your pipeline copilot. Ask in plain language (or use a quick prompt): overdue deals, who’s loaded, sources, economics, missing phones — I’ll pull SupplyDump to answer.",
      intent: "chat",
    });
  }

  if (isPureAcknowledgment(message)) {
    return NextResponse.json({
      assistantText: "Got it — ask anytime you want a pipeline read.",
      intent: "ack",
    });
  }

  const composedQuery = `${FOCUS_PREFIX[insightFocus]}${message}`;

  // The agent is deterministic for now (grounded on your pipeline rules),
  // so we treat the user message as intent rather than a prompt to hallucinate.
  try {
    const rows = await fetchSheetValues(
      env.GOOGLE_SPREADSHEET_ID!,
      env.GOOGLE_SHEET_RANGE,
      credentials,
    );
    const { deals } = rowsToDealRecords(rows);

    let {
      deals: scopedDeals,
      resolved: ownerResolved,
      matchMode: ownerMatchMode,
    } = matchDealsByOwnerScope(deals, OWNER_KEY, ownerScope);

    /** Names on the full open pipeline — used to match “how’s Ashish doing?” before scoping. */
    const ownerNamesForMatching = [
      ...new Set(
        deals
          .filter((d) => isOpenPipelineDeal(d))
          .map((d) => String(d[OWNER_KEY] ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const mentionedOwners = matchOwnersNamedInMessage(message, ownerNamesForMatching);

    // Rep check-ins (“how’s X doing?”) must scope the report to X — not the whole team.
    if (
      !ownerScope?.trim() &&
      asksAboutTeamRepPerformance(message) &&
      mentionedOwners.length > 0
    ) {
      const allow = new Set(mentionedOwners.map((n) => n.toLowerCase()));
      scopedDeals = deals.filter((d) =>
        allow.has(String(d[OWNER_KEY] ?? "").trim().toLowerCase()),
      );
      ownerResolved =
        mentionedOwners.length === 1 ? mentionedOwners[0]! : mentionedOwners.join(" & ");
      ownerMatchMode = "exact";
    }

    const insights = computeAgentInsights(scopedDeals);
    const missingPhoneItemCount = insights.missingPhoneActions.reduce(
      (a, g) => a + g.items.length,
      0,
    );

    // Open pipeline = in-motion work; onboarded (under contract) is counted separately.
    const openPipelineDeals = scopedDeals.filter((d) => isOpenPipelineDeal(d));
    const onboardedRecentCount = scopedDeals.filter(
      (d) =>
        isActiveDeal(d) &&
        isWithinLastDays(d[DATE_ADDED_KEY], 60) &&
        isUnderContractDeal(d),
    ).length;

    const stageMap = countByStage(openPipelineDeals);
    const stageCounts = Array.from(stageMap.entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count);

    const sourceCounts = (() => {
      const m = new Map<string, number>();
      for (const d of openPipelineDeals) {
        const src = String(d[SOURCE_KEY] ?? "").trim() || "(no source)";
        m.set(src, (m.get(src) ?? 0) + 1);
      }
      return Array.from(m.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count);
    })();

    const ownerCounts = (() => {
      const m = new Map<string, number>();
      for (const d of openPipelineDeals) {
        const owner = String(d[OWNER_KEY] ?? "").trim() || "(unassigned)";
        m.set(owner, (m.get(owner) ?? 0) + 1);
      }
      return Array.from(m.entries())
        .map(([owner, count]) => ({ owner, count }))
        .sort((a, b) => b.count - a.count);
    })();

    const staleSlice = sliceDealListForReport(insights.staleToBeContacted);
    const topSlice = sliceDealListForReport(insights.topToPursue);
    const notGreatSlice = sliceDealListForReport(insights.notGreatDeals);
    const missingSlice = truncateMissingPhoneForReport(insights.missingPhoneActions);

    const overdueCount = staleSlice.total;

    const anyListTruncated =
      staleSlice.total >= 7 ||
      topSlice.total >= 7 ||
      notGreatSlice.total >= 7 ||
      missingSlice.totalItems >= 7;

    // If the user asks something specific, we can lightly adapt the text.
    // Use the raw user message only — focus presets used to be prepended to `message`, which
    // made every "Speed & SLAs" request match "overdue" and force the stuck intent.
    const lower = message.toLowerCase();
    let assistantText = insights.assistantText;
    let intent:
      | "overview"
      | "stuck"
      | "missingPhone"
      | "topDeals"
      | "notGreat"
      | "ownerPulse" = "overview";

    if (asksAboutTeamRepPerformance(message)) {
      intent = "ownerPulse";
      assistantText = mentionedOwners.length
        ? `Here’s how ${mentionedOwners.join(" and ")} look in the open pipeline (last 60 days, excluding onboarded).`
        : `I couldn’t match those names to “Deal Owner” in SupplyDump — check spelling, or open Pipeline and filter by owner.`;
    } else if (
      insightFocus === "sla" ||
      lower.includes("72") ||
      lower.includes("stuck") ||
      lower.includes("overdue")
    ) {
      intent = "stuck";
      assistantText = insights.staleToBeContacted.length
        ? `Overdue focus: ${insights.staleToBeContacted.length} deal(s) are stuck in "To be contacted" for 72+ hours.`
        : "Overdue focus: none of the open pipeline deals appear overdue in the 72+ hour window.";
    } else if (lower.includes("missing") && lower.includes("phone")) {
      intent = "missingPhone";
      assistantText = insights.missingPhoneActions.length
        ? "Phone gaps: a few deals are missing POC phone contact—fixing this usually unlocks faster conversion."
        : "Phone gaps: phone contact looks complete for the current open pipeline set.";
    } else if (lower.includes("missing") && (lower.includes("poc") || lower.includes("contact"))) {
      intent = "missingPhone";
      assistantText = insights.missingPhoneActions.length
        ? "Phone gaps: some deals need phone enrichment before you can push them forward confidently."
        : "Phone gaps: nothing obvious is missing right now.";
    } else if (lower.includes("not great") || lower.includes("expensive") || lower.includes("45000")) {
      intent = "notGreat";
      assistantText = insights.notGreatDeals.length
        ? `Not-great set: ${insights.notGreatDeals.length} deal(s) look negotiation-heavy based on per-unit/config rules.`
        : "Not-great set: no obvious per-unit outliers detected in the current window.";
    } else if (
      lower.includes("top") ||
      lower.includes("pursue") ||
      lower.includes("best") ||
      lower.includes("priority")
    ) {
      intent = "topDeals";
      assistantText = insights.topToPursue.length
        ? "Top pursue: here are the best next deals to focus on, balanced by stage + per-unit rules."
        : "Top pursue: nothing strongly stands out in the current open pipeline window.";
    } else {
      assistantText = `Here’s a clean, actionable view of your open pipeline (last 60 days), excluding Under contract (onboarded).`;
    }

    if (ownerMatchMode === "no_results" && ownerScope?.trim()) {
      assistantText = `No deals match owner “${ownerScope.trim()}”. Try the dropdown suggestions, a shorter partial name, or clear the field for the full team view.`;
    } else if (ownerResolved && ownerScope?.trim()) {
      const scopeLine =
        ownerMatchMode === "partial"
          ? `Showing ${openPipelineDeals.length} open pipeline deal(s) matching “${ownerScope.trim()}” (${ownerResolved}).`
          : `Scoped to ${ownerResolved} (${openPipelineDeals.length} open pipeline in last 60 days, ${onboardedRecentCount} onboarded).`;
      assistantText = `${scopeLine}\n\n${assistantText}`;
    }

    const report = {
      openPipelineCount: openPipelineDeals.length,
      onboardedRecentCount,
      overdueCount,
      stageCounts,
      sourceCounts,
      ownerCounts,
      staleToBeContacted: staleSlice.shown,
      topToPursue: topSlice.shown,
      topToPursueTotal: topSlice.total,
      notGreatDeals: notGreatSlice.shown,
      notGreatDealsTotal: notGreatSlice.total,
      missingPhoneActions: missingSlice.groups,
      missingPhoneItemsTotal: missingSlice.totalItems,
    };

    /** Stuck/SLA rows: include for SLA intent or when answering “how’s [rep] doing?”. */
    const includeStaleInNarrative = intent === "stuck" || intent === "ownerPulse";

    const contextHints = buildNarrativeContextHints({
      intent,
      openPipelineCount: openPipelineDeals.length,
      overdueTotal: insights.staleToBeContacted.length,
      staleDeals: insights.staleToBeContacted,
      topDeals: insights.topToPursue,
      notGreatDeals: insights.notGreatDeals,
      stageCounts,
      sourceCounts,
      ownerCounts,
      missingPhoneTotal: missingPhoneItemCount,
      anyListTruncated,
      focusedOwnerNames: mentionedOwners.length ? mentionedOwners : undefined,
    });

    const narrativeReport: NarrativeReport = {
      openPipelineCount: report.openPipelineCount,
      onboardedRecentCount: report.onboardedRecentCount,
      stageCounts: report.stageCounts,
      sourceCounts: report.sourceCounts,
      ownerCounts: report.ownerCounts,
      topToPursue: report.topToPursue.map((d) => ({
        sheetRow: d.sheetRow,
        building: d.building,
        owner: d.owner,
        nextStep: d.nextStep,
      })),
      notGreatDeals: report.notGreatDeals.map((d) => ({
        sheetRow: d.sheetRow,
        building: d.building,
        owner: d.owner,
        nextStep: d.nextStep,
      })),
      missingPhoneActions: report.missingPhoneActions.map((g) => ({
        category: g.category,
        items: g.items.map((it) => ({
          sheetRow: it.sheetRow,
          building: it.building,
          owner: it.owner,
          detail: it.detail,
        })),
      })),
      ...(includeStaleInNarrative
        ? {
            overdueCount: report.overdueCount,
            staleToBeContacted: report.staleToBeContacted.map((d) => ({
              sheetRow: d.sheetRow,
              building: d.building,
              owner: d.owner,
              nextStep: d.nextStep,
            })),
          }
        : {}),
    };

    // Optional model rewrite for better readability; remains fully grounded in deterministic report data.
    let finalAssistantText = assistantText;
    if (
      env.OPENAI_API_KEY?.trim() &&
      ownerMatchMode !== "no_results"
    ) {
      try {
        const rewritten = await writeNarrativeWithOpenAI({
          apiKey: env.OPENAI_API_KEY,
          model: env.OPENAI_MODEL,
          message: composedQuery,
          ownerScope,
          intent,
          includeStaleInNarrative,
          anyListTruncated,
          contextHints,
          report: narrativeReport,
        });
        if (rewritten) finalAssistantText = rewritten;
      } catch {
        // Fall back silently to deterministic text if model rewrite fails.
      }
    }

    return NextResponse.json({
      assistantText: finalAssistantText,
      intent,
      report,
      meta: {
        ownerScope: ownerScope?.trim() || null,
        ownerResolved,
        ownerMatchMode,
        scopedRowCount: scopedDeals.length,
        scopedOpenPipelineCount: openPipelineDeals.length,
        scopedOnboardedRecentCount: onboardedRecentCount,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "agent_failed", message: msg }, { status: 502 });
  }
}

