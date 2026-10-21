// Pure, browser-safe rules shared by the server and UI. Covered by src/test/taste-rules.test.ts.

export const MAX_FAVORITES = 5;
export const MIN_FAVORITES = 2;
export const MIN_FAVORITES_MESSAGE = "Add at least 2 favorites to start (3 or more gives better results).";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_RETRIES = 2;

export const DEMO_PRESET = {
  homeCity: "Cotonou",
  targetCity: "Berlin",
  favorites: ["Burna Boy", "Angélique Kidjo", "Black Panther", "Nike", "Americanah"],
} as const;

/** Trim, drop empties and duplicates, keep at most MAX_FAVORITES. */
export function normalizeFavorites(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const v = raw.trim().slice(0, 80);
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length === MAX_FAVORITES) break;
  }
  return out;
}

export function isCacheFresh(createdAt: string | Date, now: number = Date.now()): boolean {
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t < CACHE_TTL_MS;
}

/** Only 429 and 5xx are worth retrying. */
export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Stable cache key: path + sorted params. */
export function cacheKey(path: string, params: Record<string, string>): string {
  const q = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `${path}?${q}`;
}

const stem = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5);

/** Tags a recommended item shares with the taste profile (loose stem match). */
export function sharedTags(itemTags: readonly string[], tasteTags: readonly string[]): string[] {
  const taste = new Set(tasteTags.map(stem).filter((s) => s.length >= 4));
  const out: string[] = [];
  for (const t of itemTags) {
    if (taste.has(stem(t)) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 3);
}

/** Normalizes text for accent- and case-insensitive matching. */
export function normalizeCityString(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Formats dynamic note: "X of Y resolved", listing missing items if any. */
export function formatResolutionNote(
  resolvedQueries: string[],
  requestedFavorites: string[],
): string {
  const resolvedNorm = new Set(resolvedQueries.map(normalizeCityString));
  const missing = requestedFavorites.filter((f) => !resolvedNorm.has(normalizeCityString(f)));
  const count = resolvedQueries.length;
  const total = requestedFavorites.length;

  if (missing.length === 0) {
    return `${count} of ${total} resolved`;
  }
  return `${count} of ${total} resolved (missing: ${missing.join(", ")})`;
}

/**
 * Verifies that every venue or media title in the plan text exists in Qloo results.
 * Strips unverified specific mentions while preserving general tips.
 */
export function verifyAndSanitizePlanText(
  planText: string,
  allowedEntityNames: string[],
): string {
  const allowedNorm = allowedEntityNames.map(normalizeCityString);
  const lines = planText.split("\n");

  const sanitized = lines.map((line) => {
    if (!line.trim() || line.toLowerCase().includes("general tip")) return line;

    // Check quoted entities
    return line.replace(/["“'«]([^"”'»]{3,50})["”'»]/g, (match, entity) => {
      const norm = normalizeCityString(entity);
      const isKnown = allowedNorm.some((a) => a.includes(norm) || norm.includes(a));
      return isKnown ? match : "";
    }).replace(/\s\s+/g, " ");
  });

  return sanitized.join("\n");
}

// ---------- T1: resolution similarity ----------

const tokens = (s: string) =>
  normalizeCityString(s)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

function bigrams(s: string): string[] {
  const t = normalizeCityString(s).replace(/[^a-z0-9]/g, "");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Dice coefficient on letter pairs, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.length || !y.length) return 0;
  const pool = [...y];
  let hit = 0;
  for (const g of x) {
    const k = pool.indexOf(g);
    if (k >= 0) {
      hit++;
      pool.splice(k, 1);
    }
  }
  return (2 * hit) / (x.length + y.length);
}

/**
 * A resolved entity is trusted only if every word the user typed appears as a whole word in the
 * resolved name, or the two names are near-identical (typo tolerance, Dice >= 0.8).
 * "Vani baby" -> "Ice Ice Baby - Vanilla Ice" fails ("vani" is not a word of the result).
 */
export function isTrustedMatch(query: string, resolvedName: string): boolean {
  const q = tokens(query);
  const n = new Set(tokens(resolvedName));
  if (q.length && q.every((t) => n.has(t))) return true;
  return nameSimilarity(query, resolvedName) >= 0.8;
}

// ---------- T3: lodging exclusion ----------

const LODGING_RE =
  /\b(hotel|hôtel|hostel|motel|lodging|lodge|campanile|ibis|novotel|mercure|hilton|marriott|sheraton|radisson|holiday inn|résidence|residence|aparthotel|apart-hotel|guest ?house|bed and breakfast|b&b|inn|resort|suites?|convention cent(er|re)|congress cent(er|re)|kongress|estrel)\b/i;

export interface PlaceFacts {
  name: string;
  primaryGenre?: string | null | undefined;
  tagIds?: readonly string[] | undefined;
  hotelClass?: unknown;
  numberOfRooms?: unknown;
}

/** Returns an exclusion reason if the place is lodging or a convention venue, else null. */
export function lodgingReason(p: PlaceFacts): string | null {
  const nm = normalizeCityString(p.name);
  if (LODGING_RE.test(p.name) || LODGING_RE.test(nm)) return "lodging (name)";
  const g = p.primaryGenre ?? "";
  if (/:(hotel|lodging|hostel|motel|resort|convention_center|bed_and_breakfast|guest_house)/.test(g)) return "lodging (primary genre)";
  if (p.hotelClass != null || p.numberOfRooms != null) return "lodging (hotel class / rooms)";
  if ((p.tagIds ?? []).some((t) => /room_type|check_in|:hotel$|:lodging/.test(t))) return "lodging (room tags)";
  return null;
}

// ---------- T4: generic city filter ----------

/** Postal-code ranges per city. A postal code is never accepted alone: the city name must also match. */
const CITY_POSTAL: Record<string, (code: number, raw: string) => boolean> = {
  berlin: (c) => c >= 10115 && c <= 14199,
  paris: (c) => (c >= 75001 && c <= 75020) || c === 75116,
};

export function isPlaceInCity(
  targetCity: string,
  place: { address?: string | null; locality?: string | null; localities?: string[] | null; postalCode?: string | null },
): boolean {
  return placeCityReason(targetCity, place) === null;
}

/** null when the place is inside the target city, otherwise the exclusion reason. */
export function placeCityReason(
  targetCity: string,
  place: { address?: string | null; locality?: string | null; localities?: string[] | null; postalCode?: string | null },
): string | null {
  const target = normalizeCityString(targetCity);
  if (!target) return "no target city";
  const addr = place.address ?? "";
  const combined = normalizeCityString(`${addr} ${place.locality ?? ""} ${(place.localities ?? []).join(" ")}`);
  const re = new RegExp(`(^|[^a-z])${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
  if (!re.test(normalizeCityString(addr))) return `address does not name ${targetCity}`;
  if (!re.test(combined)) return `not in ${targetCity}`;
  const rule = CITY_POSTAL[target];
  if (rule) {
    const codes = `${addr} ${place.postalCode ?? ""}`.match(/\b\d{5}\b/g) ?? [];
    for (const m of codes) if (!rule(parseInt(m, 10), m)) return `postal code ${m} outside ${targetCity}`;
  }
  return null;
}

// ---------- T5: tag whitelist ----------

export interface RawTag {
  name: string;
  type: string;
}

/** Only genre, cuisine, ambience and audience tag types may be shown. */
const TAG_TYPE_ALLOW = [
  /^urn:tag:genre:/,
  /^urn:tag:cuisine/,
  /^urn:tag:culinary_style:/,
  /^urn:tag:ambience:/,
  /^urn:tag:customer_identity:/,
  /^urn:tag:audience:/,
];

const SENSITIVE_RE =
  /(drug|dealer|cocaine|heroin|weed|cannabis|marijuana|tobacco|smok|hookah|shisha|alcohol|violen|murder|kill|gun|rape|abuse|sex|nude|nudity|erotic|porn|polyamor|bdsm|fetish|strip|crime|criminal|prison|gang|terror|suicide|bath|debit|credit|card|cash|payment|nfc|elevator|wifi|wi-fi|parking|restroom|toilet|wheelchair|seminar|business|luggage|bathtub|balcony|tv|hair dryer|discover|place$|tourist attraction|^hotel$)/i;

/** Splits tags into kept (whitelisted, readable) and dropped (with reason). */
export function filterTags(tags: readonly RawTag[]): { kept: RawTag[]; dropped: (RawTag & { reason: string })[] } {
  const kept: RawTag[] = [];
  const dropped: (RawTag & { reason: string })[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const name = (t.name ?? "").trim();
    if (!name) continue;
    if (!TAG_TYPE_ALLOW.some((r) => r.test(t.type ?? ""))) dropped.push({ ...t, reason: "type not whitelisted" });
    else if (SENSITIVE_RE.test(name)) dropped.push({ ...t, reason: "sensitive or amenity term" });
    else if (name.length < 3 || /\d/.test(name)) dropped.push({ ...t, reason: "not readable" });
    else if (seen.has(name.toLowerCase())) continue;
    else {
      seen.add(name.toLowerCase());
      kept.push({ name, type: t.type });
    }
  }
  return { kept, dropped };
}

export const MAX_TAGS_PER_CARD = 2;

// ---------- T6: match badge ----------

export const STRONG_FLOOR = 0.6;

/**
 * Badge rule. With a Qloo affinity score: "Strong" only if the score is >= 0.6 AND in the top half
 * of its own list (>= the median of that list), so the split always varies. Without a score:
 * "Strong" only with 2+ tags shared with the taste profile. Never a percentage.
 */
export function getMatchBadge(
  affinity: number | undefined,
  sharedTagCount: number,
  listAffinities: readonly number[] = [],
): { label: "Strong match" | "Medium match"; tone: "strong" | "medium" } {
  const strong = { label: "Strong match", tone: "strong" } as const;
  const medium = { label: "Medium match", tone: "medium" } as const;
  if (typeof affinity === "number" && Number.isFinite(affinity)) {
    if (affinity < STRONG_FLOOR) return medium;
    const xs = listAffinities.filter((n) => Number.isFinite(n)).sort((a, b) => b - a);
    if (xs.length < 2) return strong;
    const half = xs[Math.floor((xs.length - 1) / 2)] ?? 0;
    const lowest = xs[xs.length - 1] ?? 0;
    return affinity > lowest && affinity >= half ? strong : medium;
  }
  return sharedTagCount >= 2 ? strong : medium;
}

// ---------- T7: unique explanations ----------

export interface ExplainInput {
  id: string;
  name: string;
  tags: readonly string[];
  group: string;
}

/** One distinct, tag-based explanation per card. No two cards share the same text. */
export function buildExplanations(items: readonly ExplainInput[], tasteTags: readonly string[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  const rank: Record<string, number> = {};
  for (const it of items) {
    rank[it.group] = (rank[it.group] ?? 0) + 1;
    const shared = sharedTags(it.tags, tasteTags).slice(0, 2);
    const own = it.tags.filter((t) => !shared.includes(t)).slice(0, 2);
    const candidates: string[] = [];
    if (shared.length) candidates.push(`Matches your taste for ${shared.join(" and ")}.`);
    if (shared.length && own.length) candidates.push(`Matches your taste for ${shared[0]}, known for ${own[0]}.`);
    if (own.length) candidates.push(`Known for ${own.join(" and ")}.`);
    if (it.tags.length) candidates.push(`Known for ${it.tags.slice(0, 2).join(" and ")} (${it.group.toLowerCase()}).`);
    candidates.push(`#${rank[it.group]} in ${it.group} by Qloo taste signal.`);
    let line = candidates.find((c) => !used.has(c));
    if (!line) line = `${it.name}: #${rank[it.group]} in ${it.group} by Qloo taste signal.`;
    used.add(line);
    out[it.id] = line;
  }
  return out;
}

// ---------- T8: step status ----------

export type TraceStatus = "done" | "warning";
/** A step that returns zero results is a visible warning, never "Done". */
export function stepStatusFor(count: number): TraceStatus {
  return count > 0 ? "done" : "warning";
}

// ---------- T9: plan verification ----------

/**
 * Keeps only plan text whose quoted mentions all exist in the allowed list and that never names a
 * rejected (untrusted) entity. Returns the cleaned text and the mentions that were removed.
 */
export function verifyPlan(
  planText: string,
  allowed: readonly string[],
  forbidden: readonly string[] = [],
): { text: string; removed: string[]; weeksWithoutEntity: number } {
  const allowedN = allowed.map(normalizeCityString).filter(Boolean);
  const forbiddenN = forbidden.map(normalizeCityString).filter((f) => f.length >= 3);
  const removed: string[] = [];
  let weeksWithoutEntity = 0;
  const lines = planText.split("\n").map((line) => {
    if (!line.trim()) return line;
    let hasEntity = false;
    let out = line.replace(/["“«]([^"”»]{2,80})["”»]/g, (m, ent: string) => {
      const n = normalizeCityString(ent);
      if (allowedN.includes(n)) {
        hasEntity = true;
        return m;
      }
      removed.push(ent);
      return "a local spot";
    });
    for (const f of forbiddenN) {
      if (normalizeCityString(out).includes(f)) {
        removed.push(f);
        out = out.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "");
      }
    }
    if (/^\W*week\s*\d/i.test(out) && !hasEntity) weeksWithoutEntity++;
    return out.replace(/\s{2,}/g, " ");
  });
  return { text: lines.join("\n"), removed, weeksWithoutEntity };
}
