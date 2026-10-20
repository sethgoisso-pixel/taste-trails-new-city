// Pure, browser-safe rules shared by the server and UI. Covered by src/test/taste-rules.test.ts.

export const MAX_FAVORITES = 5;
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

/** Group-level "why" line. Never says "you will love". */
export function whyLine(
  favorites: readonly string[],
  itemTags: readonly string[],
  tasteTags: readonly string[],
): string {
  const who = favorites.slice(0, 2).join(" and ") || "your favorites";
  const shared = sharedTags(itemTags, tasteTags);
  if (shared.length) return `People who like ${who} tend to enjoy this. Shared taste: ${shared.join(", ")}.`;
  const top = itemTags.slice(0, 2);
  return top.length
    ? `People who like ${who} tend to enjoy this. Known for: ${top.join(", ")}.`
    : `People who like ${who} tend to enjoy this.`;
}

/** Normalizes text for accent- and case-insensitive matching. */
export function normalizeCityString(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Generic geographic filter:
 * 1. Accepts a venue only if its address, locality, or geocode text contains the target city name.
 * 2. For Berlin: postal code must be between 10115 and 14199 (14467+ is Potsdam/Brandenburg, rejected).
 *    Postal code is never accepted alone: city name is mandatory.
 */
export function isPlaceInCity(
  targetCity: string,
  place: {
    address?: string | null;
    locality?: string | null;
    localities?: string[] | null;
    postalCode?: string | null;
  },
): boolean {
  const normTarget = normalizeCityString(targetCity);
  if (!normTarget) return false;

  const addr = place.address || "";
  const locality = place.locality || "";
  const locList = (place.localities || []).join(" ");
  const combined = normalizeCityString(`${addr} ${locality} ${locList}`);

  // Mandatory: target city name must appear in address or locality
  if (!combined.includes(normTarget)) {
    return false;
  }

  // Strict check for Berlin postal codes
  if (normTarget === "berlin") {
    const postalMatches = `${addr} ${place.postalCode || ""}`.match(/\b(\d{5})\b/g);
    if (postalMatches) {
      for (const m of postalMatches) {
        const code = parseInt(m, 10);
        // German postal code format (10000 - 19999 range)
        if (code >= 10000 && code < 20000) {
          if (code < 10115 || code > 14199) {
            return false; // Out of Berlin limits (e.g. 14467 Potsdam, 15366 Neuenhagen)
          }
        }
      }
    }
  }

  return true;
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

/** Calculates match badge based on Qloo affinity or shared tag count. No invented percentages. */
export function getMatchBadge(
  affinity: number | undefined,
  sharedTagCount: number,
): { label: "Strong match" | "Medium match"; tone: "strong" | "medium" } {
  if (typeof affinity === "number" && !Number.isNaN(affinity)) {
    const norm = affinity > 1 ? affinity / 100 : affinity;
    return norm >= 0.65
      ? { label: "Strong match", tone: "strong" }
      : { label: "Medium match", tone: "medium" };
  }
  return sharedTagCount >= 2
    ? { label: "Strong match", tone: "strong" }
    : { label: "Medium match", tone: "medium" };
}

/** Excludes crude, explicit, or internal metadata tags from public view. */
const BANNED_TAG_REGEX = /(drug|dealer|bathe|nude|sex|explicit|mask|check|credit_card|staff_wear|not_for_display)/i;

export function sanitizeTags(tags: readonly string[]): string[] {
  return tags.filter((t) => !BANNED_TAG_REGEX.test(t) && t.trim().length > 1);
}
  
