/** Column header keys as they appear in SupplyDump (after unique-key normalization). */
export const STAGE_KEY = "Deal Stage";
export const RENT_KEY = "Expected Rent";
export const OWNER_KEY = "Deal Owner";
export const SOURCE_KEY = "Source";
export const CLUSTER_KEY = "Cluster";
export const DATE_ADDED_KEY = "Date Added";
export const CONFIGURATION_KEY = "Configuration";
export const STAGE_LAST_EDIT_KEY = "Stage Last Edit";
export const BUILDING_KEY = "Society/Building Name";
export const LISTING_LINK_KEY = "Slack / listing Link";
export const DISQ_KEY = "Disqualified";
export const POC_NUMBER_KEY = "POC Number";
export const POC_TYPE_KEY = "POC Type";
export const ACTIVE_DAYS_WINDOW = 60;

/** Hidden from pipeline table + detail panel; data still loads/saves via the sheet. */
export const PIPELINE_HIDDEN_COLUMN_KEYS = new Set([
  "Property Type",
  "Added by",
  "POC Email",
  "Google Drive Link (Media)",
  "After Sep 1",
  "DisqFlag",
  "AI_Score",
  "AI_Tier",
  "AI_Reason",
  "AI_Run_At",
]);

/**
 * Preset order for stage dropdowns and UI lists — forward pipeline order (queue → closed).
 */
export const STAGE_ORDER = [
  "To be contacted (POC)",
  "To be contacted",
  "In touch",
  "Landlord interested",
  "Evaluation in progress",
  "Qualified",
  "Negotiations started",
  "Offer Extended",
  "Under contract",
  /** Terminal — moved out of active pipeline (lost / closed-lost). */
  "Lost",
] as const;

/** Sheet value for the lost pipeline when marking a deal lost from the UI. */
export const LOST_PIPELINE_STAGE = "Lost";

export function parseRent(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = String(value).replace(/[₹,\s]/g, "").replace(/[^\d.]/g, "");
  const x = parseFloat(n);
  return Number.isFinite(x) ? x : null;
}

/**
 * Semantic pipeline progression (warm funnel, SLA rules).
 * Not the same as screen sort order — see STAGE_DISPLAY_RANK.
 */
const STAGE_SEMANTIC_RANK: Record<string, number> = {
  to_be_contacted: 0,
  in_touch: 1,
  landlord_interested: 2,
  evaluation_in_progress: 3,
  qualified: 4,
  negotiations_started: 5,
  offer_extended: 6,
  under_contract: 7,
};

/** True when stage is Evaluation in progress or any later funnel stage (Qualified → Under contract). */
export function isEvaluationInProgressOrLater(
  stage: string | number | undefined,
): boolean {
  const concept = stageConcept(stage);
  const r = STAGE_SEMANTIC_RANK[concept];
  if (r === undefined) return false;
  return r >= STAGE_SEMANTIC_RANK.evaluation_in_progress;
}

/** UI sort: same as funnel order — To be contacted → … → Under contract; ad-hoc stages last. */
const STAGE_DISPLAY_RANK: Record<string, number> = {
  to_be_contacted_poc: -1,
  to_be_contacted: 0,
  in_touch: 1,
  landlord_interested: 2,
  evaluation_in_progress: 3,
  qualified: 4,
  negotiations_started: 5,
  offer_extended: 6,
  under_contract: 7,
};

export function stageSortIndex(stage: string): number {
  const normalized = normalizeStage(stage);
  const exactRank: Record<string, number> = {
    "to be contacted (poc)": STAGE_DISPLAY_RANK.to_be_contacted_poc,
  };
  if (normalized in exactRank) {
    return exactRank[normalized]!;
  }
  const concept = stageConcept(stage);
  const rank: Record<string, number> = {
    ...STAGE_DISPLAY_RANK,
    other: 50,
    unknown: 50,
  };
  return rank[concept] ?? 50;
}

/** True when stage is Landlord interested or any later funnel stage (excludes unknown/other). */
export function isLandlordInterestedOrLaterStage(
  stage: string | number | undefined,
): boolean {
  const concept = stageConcept(stage);
  const r = STAGE_SEMANTIC_RANK[concept];
  return r !== undefined && r >= STAGE_SEMANTIC_RANK.landlord_interested;
}

/** Stage pill backgrounds/borders. Label color comes from `.stage-badge` in globals.css. */
export function stageBadgeClass(stage: string): string {
  const concept = stageConcept(stage);
  if (!concept || concept === "unknown") {
    return "bg-zinc-500/15 dark:bg-zinc-600/30 border-zinc-400/45 dark:border-zinc-600/50";
  }

  switch (concept) {
    case "to_be_contacted":
      return "bg-flentNight/20 dark:bg-flentNight/35 border-flentNight/40 dark:border-flentNight/50";
    case "in_touch":
      return "bg-flentCyan/25 border-flentCyan/40";
    case "landlord_interested":
      return "bg-flentOrange/25 border-flentOrange/40";
    case "evaluation_in_progress":
      return "bg-flentNight/20 dark:bg-flentNight/30 border-flentNight/40 dark:border-flentNight/45";
    case "qualified":
      return "bg-flentGreen/25 dark:bg-flentGreen/30 border-flentGreen/45";
    case "negotiations_started":
      return "bg-flentBrick/25 dark:bg-flentBrick/30 border-flentBrick/45";
    case "offer_extended":
      return "bg-flentYellow/30 dark:bg-flentYellow/20 border-flentYellow/45";
    case "under_contract":
      return "bg-flentGreen/25 dark:bg-flentGreen/35 border-flentGreen/45 dark:border-flentGreen/50";
    default:
      return "bg-zinc-500/20 dark:bg-zinc-600/35 border-zinc-400/45 dark:border-zinc-500/40";
  }
}

export function countByStage(
  deals: Array<Record<string, string | number>>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of deals) {
    const s = String(d[STAGE_KEY] ?? "").trim();
    if (!s) continue;
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return m;
}

export function parseSheetDate(value: string | number | undefined): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  // Supports dd/mm/yyyy from sheet and ISO-ish fallbacks.
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3]);
    const d = new Date(year, month, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isWithinLastDays(
  value: string | number | undefined,
  days: number,
): boolean {
  const d = parseSheetDate(value);
  if (!d) return true;
  const now = new Date();
  const ms = now.getTime() - d.getTime();
  return ms <= days * 24 * 60 * 60 * 1000;
}

export function isActiveDeal(deal: Record<string, string | number>): boolean {
  return String(deal[DISQ_KEY] ?? "").trim() === "";
}

/** Deal stage is Under contract (onboarded / closed-won in the CRM sense). */
export function isUnderContractDeal(
  deal: Record<string, string | number>,
): boolean {
  return stageConcept(deal[STAGE_KEY]) === "under_contract";
}

/**
 * In-motion pipeline: not disqualified, in the date window, and not yet onboarded.
 * Under contract deals are tracked separately — they are no longer "active" work items.
 */
export function isOpenPipelineDeal(deal: Record<string, string | number>): boolean {
  return (
    isActiveDeal(deal) &&
    !isUnderContractDeal(deal) &&
    isWithinLastDays(deal[DATE_ADDED_KEY], ACTIVE_DAYS_WINDOW)
  );
}

/** Landlord interested → Offer extended (excludes Under contract = onboarded). */
export function isWarmPipelineStage(stage: string | number | undefined): boolean {
  return (
    isLandlordInterestedOrLaterStage(stage) &&
    stageConcept(stage) !== "under_contract"
  );
}

export type UnitParse = {
  units: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  unknownBathrooms: boolean;
};

/**
 * "3B2B" => units=2, bedrooms=3, bathrooms=2
 * "4BXB" => units=null (unknown bathrooms)
 * "3B4B" => units=3
 */
export function parseUnitsFromConfiguration(
  configuration: string | number | undefined,
): UnitParse {
  const raw = String(configuration ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!raw) {
    return { units: null, bedrooms: null, bathrooms: null, unknownBathrooms: false };
  }
  const mKnown = raw.match(/^(\d+)B(\d+)B$/i);
  if (mKnown) {
    const bedrooms = Number(mKnown[1]);
    const bathrooms = Number(mKnown[2]);
    const units = Math.min(bedrooms, bathrooms);
    return { units, bedrooms, bathrooms, unknownBathrooms: false };
  }
  const mUnknownBath = raw.match(/^(\d+)B[Xx]B$/);
  if (mUnknownBath) {
    return {
      units: null,
      bedrooms: Number(mUnknownBath[1]),
      bathrooms: null,
      unknownBathrooms: true,
    };
  }
  // Some sheets may use variants; fall back to null.
  return { units: null, bedrooms: null, bathrooms: null, unknownBathrooms: true };
}

/**
 * Expected rent per “unit” for prioritization: rent / min(beds, baths).
 * If bathroom count is unknown (e.g. `4BXB`), assume bathrooms = bedrooms so units = bedrooms.
 */
export function effectiveUnitsForPerUnitRent(
  configuration: string | number | undefined,
): number | null {
  const p = parseUnitsFromConfiguration(configuration);
  if (p.units != null) return p.units;
  if (p.bedrooms != null && p.unknownBathrooms) {
    return p.bedrooms;
  }
  return null;
}

export function hoursSince(value: string | number | undefined): number | null {
  const d = parseSheetDate(value);
  if (!d) return null;
  const ms = Date.now() - d.getTime();
  return ms / (1000 * 60 * 60);
}

export function normalizeStage(stage: string | number | undefined): string {
  return String(stage ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function stageConcept(stage: string | number | undefined): string {
  const s = normalizeStage(stage);
  if (!s) return "unknown";
  if (s.includes("to be contacted")) return "to_be_contacted";
  if (s.includes("in touch")) return "in_touch";
  if (s.includes("landlord interested")) return "landlord_interested";
  if (s.includes("evaluation in progress") || (s.includes("evaluation") && s.includes("progress"))) {
    return "evaluation_in_progress";
  }
  // Plain "Evaluation" sorts after Landlord interested (same concept as evaluation in progress).
  if (s.includes("evaluation")) return "evaluation_in_progress";
  if (s.includes("qualified")) return "qualified";
  if (s.includes("negotiations started") || s.includes("negotiations")) return "negotiations_started";
  if (s.includes("offer extended")) return "offer_extended";
  if (s.includes("under contract")) return "under_contract";
  return "other";
}

export function groupDealsByStage<
  T extends Record<string, string | number> & { _sheetRow: number },
>(deals: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const d of deals) {
    const s = String(d[STAGE_KEY] ?? "").trim();
    if (!map.has(s)) map.set(s, []);
    map.get(s)!.push(d);
  }
  const orderedStages = Array.from(map.keys()).sort((a, b) => {
    const emptyA = !a;
    const emptyB = !b;
    if (emptyA && !emptyB) return 1;
    if (!emptyA && emptyB) return -1;
    const ia = stageSortIndex(a);
    const ib = stageSortIndex(b);
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
  const out = new Map<string, T[]>();
  for (const s of orderedStages) {
    const list = map.get(s)!;
    list.sort((x, y) => {
      const rx = parseRent(x[RENT_KEY]);
      const ry = parseRent(y[RENT_KEY]);
      if (rx != null && ry != null && rx !== ry) return ry - rx;
      return x._sheetRow - y._sheetRow;
    });
    out.set(s, list);
  }
  return out;
}
