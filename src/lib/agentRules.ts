import type { UnitParse } from "@/app/pipeline/helpers";
import {
  BUILDING_KEY,
  CONFIGURATION_KEY,
  DATE_ADDED_KEY,
  POC_NUMBER_KEY,
  SOURCE_KEY,
  STAGE_LAST_EDIT_KEY,
  STAGE_KEY,
  OWNER_KEY,
  RENT_KEY,
  effectiveUnitsForPerUnitRent,
  parseRent,
  parseSheetDate,
  parseUnitsFromConfiguration,
  stageConcept as deriveStageConcept,
  isOpenPipelineDeal,
  hoursSince,
} from "@/app/pipeline/helpers";
import {
  isNoBrokerSource,
  isMyGateMustPursueAsap,
  pursuitPriorityTier,
} from "@/lib/dealPrioritization";

/** Cap for “top to pursue” (agent) and AI picks (pipeline). */
const TOP_PURSUE_CAP = 30;

/** If Stage Last Edit is blank and this many *newer* open-pipeline leads exist → To be contacted ASAP. */
const UNTOUCHED_NEWER_LEADS_ASAP_THRESHOLD = 60;

export type PipelineDeal = Record<string, string | number> & {
  _sheetRow: number;
};

export type Recommendation = {
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
  /** Raw Society/Building Name column — used for society vs locality heuristics. */
  buildingNameRaw: string;
  /** Human-friendly next step for a rep. Kept deterministic + neutral. */
  nextStep: string;
  /** Blank Stage Last Edit + 61+ newer leads in open pipeline (see getAiPicksToBeContacted). */
  isToBeContactedAsap?: boolean;
};

export type MissingAction = {
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

export type AgentInsights = {
  assistantText: string;
  topToPursue: Recommendation[];
  staleToBeContacted: Recommendation[];
  notGreatDeals: Recommendation[];
  missingPhoneActions: MissingAction[];
};

function extractBuilding(deal: PipelineDeal): string {
  const a = String(deal["Society/Building Name"] ?? "").trim();
  const b = String(deal["Property Type"] ?? "").trim();
  if (a) return a;
  if (b) return b;
  return `Row ${deal._sheetRow}`;
}

function dealExpectedRentText(deal: PipelineDeal): string {
  return String(deal[RENT_KEY] ?? "").trim();
}

function perUnitPricing(deal: PipelineDeal): {
  perUnit: number | null;
  units: number | null;
  unknownBathrooms: boolean;
} {
  const unitParse: UnitParse = parseUnitsFromConfiguration(deal[CONFIGURATION_KEY]);
  const rent = parseRent(deal[RENT_KEY]);
  const units = effectiveUnitsForPerUnitRent(deal[CONFIGURATION_KEY]);
  if (rent == null) return { perUnit: null, units: unitParse.units, unknownBathrooms: unitParse.unknownBathrooms };
  if (units == null) return { perUnit: null, units: null, unknownBathrooms: unitParse.unknownBathrooms };
  const perUnit = rent / units;
  return { perUnit, units, unknownBathrooms: unitParse.unknownBathrooms };
}

function normalizeConfig(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** True if `a` is strictly newer than `b` by Date Added, then sheet row. */
function isOpenPipelineLeadNewerThan(a: PipelineDeal, b: PipelineDeal): boolean {
  const da = parseSheetDate(a[DATE_ADDED_KEY]);
  const db = parseSheetDate(b[DATE_ADDED_KEY]);
  if (da && db) {
    const cmp = da.getTime() - db.getTime();
    if (cmp !== 0) return cmp > 0;
    return a._sheetRow > b._sheetRow;
  }
  if (da && !db) return true;
  if (!da && db) return false;
  return a._sheetRow > b._sheetRow;
}

function countStrictlyNewerOpenLeads(
  deal: PipelineDeal,
  openPipeline: PipelineDeal[],
): number {
  let n = 0;
  for (const o of openPipeline) {
    if (o._sheetRow === deal._sheetRow) continue;
    if (isOpenPipelineLeadNewerThan(o, deal)) n++;
  }
  return n;
}

function buildRec(deal: PipelineDeal, extra?: Partial<Recommendation>): Recommendation {
  const owner = String(deal[OWNER_KEY] ?? "").trim() || "(unassigned)";
  const configuration = String(deal[CONFIGURATION_KEY] ?? "").trim() || "—";
  const stage = String(deal[STAGE_KEY] ?? "").trim() || "—";
  const stageLastEdit = String(deal[STAGE_LAST_EDIT_KEY] ?? "").trim();
  const source = String(deal[SOURCE_KEY] ?? "").trim();
  const expectedRent = dealExpectedRentText(deal);
  const pr = perUnitPricing(deal);
  const phoneMissing = String(deal[POC_NUMBER_KEY] ?? "").trim() === "";
  const stageConcept = deriveStageConcept(stage);
  const cfg = normalizeConfig(configuration);
  const buildingNameRaw = String(deal[BUILDING_KEY] ?? "").trim();

  const nextStep = (() => {
    const src = source.toLowerCase();
    const perUnitNotGreat = pr.perUnit != null && pr.perUnit > 45000;
    const cfgNotGreat = cfg === "3B2B";
    const notGreat = perUnitNotGreat || cfgNotGreat;

    if (
      isMyGateMustPursueAsap({
        source,
        phoneMissing,
        configurationNormalized: cfg,
        perUnit: pr.perUnit,
      })
    ) {
      return "Must pursue ASAP: MyGate with phone on file, not 3B2B, and per-unit under threshold — advance today.";
    }

    if (notGreat && stageConcept !== "to_be_contacted") {
      return "This looks negotiation-heavy; proceed only with strong fit signals, otherwise mark Disqualified to save rep time.";
    }

    if (stageConcept === "to_be_contacted") {
      if (phoneMissing) {
        if (src.includes("mygate")) {
          return "Phone not present: pull the listing to get the owner phone, message/call now, then move to In touch.";
        }
        return "Phone not present: extract phone using your paid credits, message/call now, then move to In touch.";
      }
      return "Contact owner now (call/WhatsApp), then advance to In touch and log the next action.";
    }

    if (stageConcept === "in_touch") {
      return "Follow up quickly: confirm landlord fit, propose next step, and aim to advance the stage within 24-48h.";
    }

    if (stageConcept === "landlord_interested" || stageConcept === "evaluation_in_progress") {
      return "Keep momentum: confirm evaluation timeline + gather required info, then advance to Qualified.";
    }

    if (stageConcept === "qualified") {
      return "Next: coordinate negotiations. Keep details crisp so the deal progresses to Offer Extended.";
    }

    if (stageConcept === "negotiations_started" || stageConcept === "offer_extended") {
      return "Stay tight on timelines and objections. Ensure everything needed for Under contract is ready.";
    }

    if (stageConcept === "under_contract") {
      return "Monitor until completion. Ensure no missing docs block closure.";
    }

    // Fallback neutral guidance.
    if (phoneMissing) return "Phone missing: enrich first, then contact and advance the stage.";
    return "Review and progress: contact/verify details, then advance to the next stage.";
  })();

  return {
    sheetRow: deal._sheetRow,
    owner,
    building: extractBuilding(deal),
    configuration,
    expectedRent,
    perUnit: pr.perUnit,
    stage,
    stageConcept,
    stageLastEdit,
    source,
    phoneMissing,
    buildingNameRaw,
    nextStep,
    ...extra,
  };
}

/**
 * Pipeline **AI picks** only: Deal Stage = **To be contacted** (excludes 3B2B / per-unit &gt; 45k).
 * **To be contacted ASAP:** Stage Last Edit blank (never touched) **and** strictly more than
 * {@link UNTOUCHED_NEWER_LEADS_ASAP_THRESHOLD} other open-pipeline leads are newer (Date Added, then row).
 * Rank: ASAP first, then MyGate/society/per-unit tiers, then lower per-unit.
 */
export function getAiPicksToBeContacted(deals: PipelineDeal[]): Recommendation[] {
  const openPipeline = deals.filter((d) => isOpenPipelineDeal(d));
  const withDerived = openPipeline.map((d) => buildRec(d));

  const notGreatRows = new Set(
    withDerived
      .filter((d) => {
        const cfg = normalizeConfig(d.configuration);
        if (cfg === "3B2B") return true;
        if (d.perUnit == null) return false;
        return d.perUnit > 45000;
      })
      .map((d) => d.sheetRow),
  );

  const candidates = withDerived.filter(
    (d) =>
      d.stageConcept === "to_be_contacted" &&
      !notGreatRows.has(d.sheetRow) &&
      !isNoBrokerSource(d.source),
  );

  const enriched = candidates.map((rec) => {
    const deal = openPipeline.find((d) => d._sheetRow === rec.sheetRow)!;
    const untouched = !String(deal[STAGE_LAST_EDIT_KEY] ?? "").trim();
    const newerCount = countStrictlyNewerOpenLeads(deal, openPipeline);
    const asap =
      untouched && newerCount > UNTOUCHED_NEWER_LEADS_ASAP_THRESHOLD;

    const mg = isMyGateMustPursueAsap({
      source: rec.source,
      phoneMissing: rec.phoneMissing,
      configurationNormalized: normalizeConfig(rec.configuration),
      perUnit: rec.perUnit,
    });

    let nextStep = rec.nextStep;
    if (asap && !mg) {
      nextStep =
        "To be contacted ASAP: Stage Last Edit is blank (never touched) and 61+ newer leads are ahead in the queue — contact now.";
    }

    return {
      ...rec,
      isToBeContactedAsap: asap,
      nextStep,
    };
  });

  return enriched
    .sort((a, b) => {
      if (Boolean(a.isToBeContactedAsap) !== Boolean(b.isToBeContactedAsap)) {
        return a.isToBeContactedAsap ? -1 : 1;
      }
      const ta = pursuitPriorityTier({
        source: a.source,
        buildingNameRaw: a.buildingNameRaw,
        perUnit: a.perUnit,
        configurationNormalized: normalizeConfig(a.configuration),
        phoneMissing: a.phoneMissing,
      });
      const tb = pursuitPriorityTier({
        source: b.source,
        buildingNameRaw: b.buildingNameRaw,
        perUnit: b.perUnit,
        configurationNormalized: normalizeConfig(b.configuration),
        phoneMissing: b.phoneMissing,
      });
      if (ta !== tb) return ta - tb;
      if (a.perUnit == null && b.perUnit != null) return 1;
      if (a.perUnit != null && b.perUnit == null) return -1;
      if (a.perUnit != null && b.perUnit != null && a.perUnit !== b.perUnit) {
        return a.perUnit - b.perUnit;
      }
      return a.sheetRow - b.sheetRow;
    })
    .slice(0, TOP_PURSUE_CAP);
}

/**
 * Rule engine grounded on your pipeline:
 * - show only open pipeline deals (Disqualified blank, last 60 days, excluding Under contract / onboarded)
 * - to_be_contacted stage must advance within 72h (based on Stage Last Edit)
 * - per-unit pricing = Expected Rent / min(beds, baths); unknown baths ⇒ assume baths = beds; > 45000 is not great
 * - pursue order: MyGate+phone+not 3B2B+per-unit &lt; 45k first; then society-style building names (non-MyGate);
 *   then non-society deals with per-unit in 17k–30k; then stage + per-unit
 * - missing phone => different recommended action depending on Source
 */
export function computeAgentInsights(deals: PipelineDeal[]): AgentInsights {
  const openPipeline = deals.filter((d) => isOpenPipelineDeal(d));

  const withDerived = openPipeline.map((d) => buildRec(d));

  const staleToBeContacted = withDerived
    .filter((d) => d.stageConcept === "to_be_contacted")
    .filter((d) => {
      const hours = hoursSince(d.stageLastEdit);
      // If Stage Last Edit is missing/invalid, play safe: treat as overdue.
      return hours == null || hours >= 72;
    })
    .sort((a, b) => a.sheetRow - b.sheetRow);

  const notGreatDeals = withDerived
    .filter((d) => {
      const cfg = normalizeConfig(d.configuration);
      if (cfg === "3B2B") return true;
      // If perUnit unknown => keep it out of "not great" to avoid false negatives.
      if (d.perUnit == null) return false;
      return d.perUnit > 45000;
    })
    .sort((a, b) => (b.perUnit ?? 0) - (a.perUnit ?? 0));

  // Top deals to pursue: not stale, not too expensive per-unit; warmer stages first; To be contacted last.
  const stageRank: Record<string, number> = {
    in_touch: 1,
    landlord_interested: 2,
    evaluation_in_progress: 3,
    qualified: 4,
    negotiations_started: 5,
    offer_extended: 6,
    under_contract: 7,
    to_be_contacted: 8,
    other: 50,
    unknown: 50,
  };

  const topToPursue = withDerived
    .filter((d) => {
      if (isNoBrokerSource(d.source)) return false;
      const stale = staleToBeContacted.some((s) => s.sheetRow === d.sheetRow);
      if (stale) {
        const keep =
          isMyGateMustPursueAsap({
            source: d.source,
            phoneMissing: d.phoneMissing,
            configurationNormalized: normalizeConfig(d.configuration),
            perUnit: d.perUnit,
          }) && !notGreatDeals.some((n) => n.sheetRow === d.sheetRow);
        return keep;
      }
      return !notGreatDeals.some((n) => n.sheetRow === d.sheetRow);
    })
    .sort((a, b) => {
      const ta = pursuitPriorityTier({
        source: a.source,
        buildingNameRaw: a.buildingNameRaw,
        perUnit: a.perUnit,
        configurationNormalized: normalizeConfig(a.configuration),
        phoneMissing: a.phoneMissing,
      });
      const tb = pursuitPriorityTier({
        source: b.source,
        buildingNameRaw: b.buildingNameRaw,
        perUnit: b.perUnit,
        configurationNormalized: normalizeConfig(b.configuration),
        phoneMissing: b.phoneMissing,
      });
      if (ta !== tb) return ta - tb;
      const ra = stageRank[a.stageConcept] ?? 50;
      const rb = stageRank[b.stageConcept] ?? 50;
      if (ra !== rb) return ra - rb;
      // Prefer deals where per-unit is known; then lower per-unit.
      if (a.perUnit == null && b.perUnit != null) return 1;
      if (a.perUnit != null && b.perUnit == null) return -1;
      if (a.perUnit != null && b.perUnit != null && a.perUnit !== b.perUnit) return a.perUnit - b.perUnit;
      return a.sheetRow - b.sheetRow;
    })
    .slice(0, TOP_PURSUE_CAP);

  const phoneMissing = openPipeline
    .filter((d) => String(d[POC_NUMBER_KEY] ?? "").trim() === "")
    .map((d) => buildRec(d));

  const missingPhoneActions: MissingAction[] = [];
  const mygateMissing = phoneMissing.filter((d) => d.source.toLowerCase().includes("mygate"));
  const otherMissing = phoneMissing.filter((d) => !d.source.toLowerCase().includes("mygate"));

  if (mygateMissing.length) {
    missingPhoneActions.push({
      category: "MyGate phone missing",
      items: mygateMissing.slice(0, 8).map((d) => ({
        sheetRow: d.sheetRow,
        owner: d.owner,
        building: d.building,
        configuration: d.configuration,
        stage: d.stage,
        source: d.source,
        detail: "Pull the listing to get the owner phone, then message/call and advance the stage.",
      })),
    });
  }

  if (otherMissing.length) {
    missingPhoneActions.push({
      category: "Listing platforms phone missing",
      items: otherMissing.slice(0, 8).map((d) => ({
        sheetRow: d.sheetRow,
        owner: d.owner,
        building: d.building,
        configuration: d.configuration,
        stage: d.stage,
        source: d.source,
        detail: "Extract phone using your paid credits, then message/call and advance the stage.",
      })),
    });
  }

  // Warm assistant text assembled from deterministic facts.
  const staleText =
    staleToBeContacted.length === 0
      ? "Nice—no deals are stuck in 'To be contacted' beyond 72 hours (based on Stage Last Edit)."
      : `We have ${staleToBeContacted.length} deal(s) stuck in 'To be contacted' for 72+ hours. Please either pick them up quickly or disqualify if they no longer fit.`;

  const topText = topToPursue.length
    ? `Here are the best deals to pursue right now (MyGate+phone first when economics fit, then society-style buildings on other sources, then 17k–30k non-society per-unit; tie-break: stage, then lower per-unit):`
    : "I couldn’t find strong deals matching your per-unit rules in the current open pipeline (60-day) window.";

  const notGreatText = notGreatDeals.length
    ? `Also, ${notGreatDeals.length} lead(s) look negotiation-heavy (3B2B and/or per-unit > 45,000). Handle only with a strong reason to proceed.`
    : "No obvious per-unit outliers found in this window.";

  const phoneText = missingPhoneActions.length
    ? `A few deals are missing phone numbers. Fixing phone contact usually boosts conversion speed.`
    : "Phone contact looks complete for the open pipeline set.";

  const assistantText =
    `Here’s a warm, grounded, action-first view of your pipeline.\\n\\n` +
    `${staleText}\\n` +
    (staleToBeContacted.length
      ? `\\nStuck list (top ${Math.min(8, staleToBeContacted.length)}):\\n` +
        staleToBeContacted
          .slice(0, 8)
          .map(
            (d, i) =>
              `${i + 1}. Row ${d.sheetRow} — ${d.building} — ${d.configuration} — Owner: ${d.owner} — Last edit: ${d.stageLastEdit || "—"} — Source: ${d.source || "—"}`,
          )
          .join("\\n") +
        `\\n→ Next step: pick up urgently, and if it no longer fits, mark disqualified so your reps stop spending time.`
      : "") +
    `\\n\\n${topText}\\n` +
    (topToPursue.length
      ? topToPursue
          .slice(0, 8)
          .map(
            (d, i) =>
              `${i + 1}. ${d.building} — ${d.configuration} — Expected Rent: ${d.expectedRent || "—"} — Stage: ${d.stage || "—"} — Owner: ${d.owner} — Source: ${d.source || "—"}${
                d.perUnit != null ? ` — Per unit: ${Math.round(d.perUnit)}` : ""
              } — (row ${d.sheetRow})`,
          )
          .join("\\n")
      : "No strong pursue-worthy deals in the current window (based on your per-unit and stage rules).") +
    `\\n\\n${notGreatText}\\n\\n${phoneText}\\n` +
    (missingPhoneActions.length
      ? `\\nWhat’s missing on phone contact:\\n` +
        missingPhoneActions
          .map((group) => {
            const topItems = group.items.slice(0, 4);
            return `- ${group.category}:\\n${topItems
              .map((it) => `  • Row ${it.sheetRow} — ${it.building} — ${it.detail}`)
              .join("\\n")}`;
          })
          .join("\\n")
      : "");

  return {
    assistantText,
    topToPursue,
    staleToBeContacted,
    notGreatDeals,
    missingPhoneActions,
  };
}

