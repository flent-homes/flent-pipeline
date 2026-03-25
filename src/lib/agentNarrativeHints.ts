import type { Recommendation } from "./agentRules";

export type OwnerCount = { owner: string; count: number };

function topOwners(items: Array<{ owner: string }>, limit: number): OwnerCount[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const o = String(it.owner ?? "").trim() || "(unassigned)";
    m.set(o, (m.get(o) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([owner, count]) => ({ owner, count }));
}

/**
 * Aggregates and reading instructions so the model summarizes **patterns**, not every row.
 * Grounded only on full recommendation lists (before UI truncation).
 */
export type FocusedOwnerPulse = {
  owner: string;
  openPipelineCount: number;
  overdueStuckCount: number;
};

export type NarrativeContextHints = {
  /** How to behave on this turn (intent + what’s large vs small). */
  readingGuide: string;
  /** Ranked owners for overdue / stale deals. */
  overdueTopOwners: OwnerCount[];
  /** Ranked owners for “top pursue” set. */
  topPursueTopOwners: OwnerCount[];
  /** Ranked owners for high per-unit / not-great set. */
  notGreatTopOwners: OwnerCount[];
  /** Heaviest pipeline owners (open pipeline). */
  pipelineVolumeTopOwners: OwnerCount[];
  topStages: Array<{ stage: string; count: number }>;
  topSources: Array<{ source: string; count: number }>;
  /** When the user asked how specific reps are doing (names matched Deal Owner). */
  focusedOwners?: FocusedOwnerPulse[];
};

function buildFocusedOwnerPulse(
  names: string[],
  ownerCounts: Array<{ owner: string; count: number }>,
  staleDeals: Recommendation[],
): FocusedOwnerPulse[] {
  return names.map((name) => {
    const oc = ownerCounts.find((o) => o.owner.toLowerCase() === name.toLowerCase());
    const openPipelineCount = oc?.count ?? 0;
    const overdueStuckCount = staleDeals.filter(
      (s) => s.owner.toLowerCase() === name.toLowerCase(),
    ).length;
    return { owner: name, openPipelineCount, overdueStuckCount };
  });
}

export function buildNarrativeContextHints(args: {
  intent: string;
  openPipelineCount: number;
  overdueTotal: number;
  staleDeals: Recommendation[];
  topDeals: Recommendation[];
  notGreatDeals: Recommendation[];
  stageCounts: Array<{ stage: string; count: number }>;
  sourceCounts: Array<{ source: string; count: number }>;
  ownerCounts: Array<{ owner: string; count: number }>;
  missingPhoneTotal: number;
  anyListTruncated: boolean;
  /** Deal Owner names detected in the user message (matched to sheet). */
  focusedOwnerNames?: string[];
}): NarrativeContextHints {
  const overdueTopOwners = topOwners(args.staleDeals, 5);
  const topPursueTopOwners = topOwners(args.topDeals, 4);
  const notGreatTopOwners = topOwners(args.notGreatDeals, 4);
  const pipelineVolumeTopOwners = args.ownerCounts.slice(0, 5).map(({ owner, count }) => ({
    owner,
    count,
  }));
  const topStages = args.stageCounts.slice(0, 4);
  const topSources = args.sourceCounts.slice(0, 4);

  const parts: string[] = [];
  parts.push(`Detected intent: ${args.intent}.`);
  parts.push(`Open pipeline (60d, excl. onboarded): ${args.openPipelineCount} deals.`);
  if (args.overdueTotal > 0) {
    parts.push(`Overdue (To be contacted 72h+): ${args.overdueTotal} deals.`);
  }
  if (args.missingPhoneTotal > 0) {
    parts.push(`Missing phone rows: ${args.missingPhoneTotal}.`);
  }
  if (args.anyListTruncated) {
    parts.push(
      "UI shows at most 3 sample deal cards per large category — do not narrate every sample row; use patterns below and headline counts.",
    );
  } else {
    parts.push("Lists are small enough to reference specific examples briefly if useful.");
  }

  let focusedOwners: FocusedOwnerPulse[] | undefined;
  if (args.focusedOwnerNames?.length) {
    focusedOwners = buildFocusedOwnerPulse(
      args.focusedOwnerNames,
      args.ownerCounts,
      args.staleDeals,
    );
  }
  if (focusedOwners?.length) {
    parts.push(
      `User asked how these reps are doing — prioritize focusedOwners (open load + overdue in To be contacted 72h+): ${focusedOwners.map((f) => `${f.owner} (${f.openPipelineCount} open, ${f.overdueStuckCount} overdue stuck)`).join("; ")}.`,
    );
  }

  return {
    readingGuide: parts.join(" "),
    overdueTopOwners,
    topPursueTopOwners,
    notGreatTopOwners,
    pipelineVolumeTopOwners,
    topStages,
    topSources,
    ...(focusedOwners?.length ? { focusedOwners } : {}),
  };
}
