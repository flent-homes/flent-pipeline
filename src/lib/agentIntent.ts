/**
 * When to load SupplyDump: default **yes** for any substantive message.
 * Keyword lists are not used to block — interpretation belongs in the model + FLENT_INTERPRETATION_CONTEXT.
 */

/**
 * Short greetings / acks — do not load the sheet.
 */
export function isConversationalOnlyMessage(message: string): boolean {
  const t = message
    .trim()
    .toLowerCase()
    .replace(/[!.?…]+$/u, "")
    .trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 10) return false;

  const joined = words.join(" ");

  if (words.length === 1) {
    return /^(hi|hello|hey|yo|sup|hiya|howdy|ola|hallo|thanks?|thx|ty|ok|okay|kk|bye|goodbye|cheers|nice|cool|yep|nope|yes|no)$/u.test(
      joined,
    );
  }

  const phrases = [
    /^good (morning|afternoon|evening)$/,
    /^hi there$/,
    /^hello there$/,
    /^hey there$/,
    /^what'?s up$/,
    /^how are you$/,
    /^how'?s it going$/,
    /^how is it going$/,
    /^thank you$/,
    /^thanks$/,
    /^ok thanks$/,
    /^thanks a lot$/,
    /^nice to meet you$/,
  ];
  return words.length <= 5 && phrases.some((re) => re.test(joined));
}

/**
 * Bare thanks / ok — no need to refetch the sheet (saves quota).
 */
export function isPureAcknowledgment(message: string): boolean {
  const t = message
    .trim()
    .toLowerCase()
    .replace(/[!.?…]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;
  if (t.length > 56) return false;
  return /^(thank you|thanks|thx|ty|ok|okay|k|kk|got it|cool|nice|great|yep|yes|no|perfect|sounds good|cheers|👍|🙏)(\s+(thank you|thanks|ok|cool|you|nice|great|👍|🙏))*$/u.test(
    t,
  );
}

/**
 * Load SupplyDump unless the user sent only a greeting or a standalone acknowledgment.
 */
export function shouldLoadSupplyDump(message: string): boolean {
  if (isConversationalOnlyMessage(message)) return false;
  if (isPureAcknowledgment(message)) return false;
  return true;
}

/**
 * “How’s Shubh doing?” / “how are X and Y doing?” — leadership asking about **reps** (Deal Owners),
 * not generic chit-chat. Load the sheet and answer from pipeline data.
 */
export function asksAboutTeamRepPerformance(message: string): boolean {
  const t = message.toLowerCase();
  if (!/\b(how'?s|hows|how is|how are)\b/.test(t)) return false;
  // Product / pipeline phrasing — not a people check-in
  if (
    /\b(deal|deals|pipeline|lead|leads|supply|supplydump|sheet|metric|report|sla|overview|stage|source)\b/.test(
      t,
    )
  ) {
    return false;
  }
  if (/\b(doing|performing|going|on track)\b/.test(t)) return true;
  // “shubh and raghav” style without repeating “doing”
  if (/\b\w+\s+and\s+\w+\b/.test(t)) return true;
  return false;
}

/** Match Deal Owner names that appear as substrings in the user message (case-insensitive). */
export function matchOwnersNamedInMessage(
  message: string,
  ownerNames: string[],
): string[] {
  const lower = message.toLowerCase();
  return ownerNames.filter((name) => {
    const n = String(name ?? "").trim();
    if (!n || n === "(unassigned)") return false;
    return lower.includes(n.toLowerCase());
  });
}

/** Show every deal as a card only when total &lt; 7; otherwise a small preview (3) + total. */
export function sliceDealListForReport<T>(items: T[]): { shown: T[]; total: number } {
  const total = items.length;
  if (total < 7) {
    return { shown: [...items], total };
  }
  return { shown: items.slice(0, 3), total };
}

type PhoneGroup<T> = { category: string; items: T[] };

/** Same rule as deal lists: &lt; 7 items total → show all; otherwise cap at 3 across categories in order. */
export function truncateMissingPhoneForReport<T>(
  groups: PhoneGroup<T>[],
): { groups: PhoneGroup<T>[]; totalItems: number } {
  const totalItems = groups.reduce((a, g) => a + g.items.length, 0);
  if (totalItems < 7) {
    return {
      groups: groups.map((g) => ({ ...g, items: [...g.items] })),
      totalItems,
    };
  }
  let remaining = 3;
  const out: PhoneGroup<T>[] = [];
  for (const g of groups) {
    if (remaining <= 0) break;
    const slice = g.items.slice(0, remaining);
    remaining -= slice.length;
    if (slice.length) {
      out.push({ ...g, items: slice });
    }
  }
  return { groups: out, totalItems };
}
