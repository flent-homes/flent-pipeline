/**
 * Flent ops rules for who to pursue first: MyGate + phone + economics,
 * society-style building names on non-MyGate sources, and per-unit bands on non-society homes.
 */

/** Strong signals that the building is a named society / project (not a bare locality or independent home). */
const SOCIETY_NAME_HINT =
  /\b(society|apartments?|enclave|towers?|residency|residences|heights|condominium|condo|county|meadows|greens|horizon|lakeview|phase|summit|riviera|nivas|heritage|skypark|parkview)\b/i;

/** Clearly not a gated society / apartment project name. */
const NON_SOCIETY_HINT =
  /\b(independent\s+house|independent|standalone|row\s*house|villa\b|plot\b|farmland)\b/i;

/** Bare area / locality strings often used when there is no society name (examples from ops). */
const LOCALITY_ONLY = new Set(
  [
    "koramangala",
    "kormangla",
    "indiranagar",
    "indira nagar",
    "hsr layout",
    "hsr",
    "whitefield",
    "marathahalli",
    "jayanagar",
    "jp nagar",
    "btm layout",
    "btm",
    "electronic city",
    "sarjapur",
    "bellandur",
    "mg road",
    "malleshwaram",
    "rajajinagar",
    "yelahanka",
    "hebbal",
    "banashankari",
    "basavanagudi",
    "ulsoor",
    "frazer town",
    "cooke town",
    "richmond town",
    "domlur",
    "mahadevapura",
    "varthur",
    "kadubeesanahalli",
  ].map((s) => s.toLowerCase()),
);

function normalizeBuildingLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]+$/g, "")
    .trim();
}

/**
 * True when the Society/Building Name field looks like a society / apartment project
 * (not independent house, bare locality, etc.).
 */
export function isLikelySocietyBuildingName(buildingNameRaw: string): boolean {
  const t = normalizeBuildingLabel(buildingNameRaw);
  if (!t) return false;
  if (NON_SOCIETY_HINT.test(t)) return false;
  if (LOCALITY_ONLY.has(t)) return false;
  if (SOCIETY_NAME_HINT.test(t)) return true;
  return false;
}

export function isMyGateSource(source: string): boolean {
  return source.toLowerCase().includes("mygate");
}

export function isNoBrokerSource(source: string): boolean {
  return source.toLowerCase().includes("nobroker");
}

export type MustPursueArgs = {
  source: string;
  phoneMissing: boolean;
  configurationNormalized: string;
  perUnit: number | null;
};

/**
 * MyGate + POC phone + not 3B2B + per-unit &lt; 45k ⇒ must pursue ASAP (highest tier).
 */
export function isMyGateMustPursueAsap(args: MustPursueArgs): boolean {
  if (!isMyGateSource(args.source)) return false;
  if (args.phoneMissing) return false;
  if (args.configurationNormalized === "3B2B") return false;
  if (args.perUnit == null) return false;
  if (args.perUnit >= 45000) return false;
  return true;
}

/** Non-society homes: per-unit room rent in this band is a “good deal” signal. */
export function isNonSocietyGoodPerUnitBand(perUnit: number | null): boolean {
  if (perUnit == null) return false;
  return perUnit >= 17000 && perUnit <= 30000;
}

/**
 * Lower number = pursue sooner. 0 = MyGate ASAP; 1 = society (non-MyGate); 2 = non-society good band; 3 = default.
 */
export function pursuitPriorityTier(args: {
  source: string;
  buildingNameRaw: string;
  perUnit: number | null;
  configurationNormalized: string;
  phoneMissing: boolean;
}): number {
  // NoBroker is always lower-priority by default.
  if (isNoBrokerSource(args.source)) return 9;
  if (
    isMyGateMustPursueAsap({
      source: args.source,
      phoneMissing: args.phoneMissing,
      configurationNormalized: args.configurationNormalized,
      perUnit: args.perUnit,
    })
  ) {
    return 0;
  }
  if (!isMyGateSource(args.source) && isLikelySocietyBuildingName(args.buildingNameRaw)) {
    return 1;
  }
  if (
    !isLikelySocietyBuildingName(args.buildingNameRaw) &&
    isNonSocietyGoodPerUnitBand(args.perUnit)
  ) {
    return 2;
  }
  return 3;
}
