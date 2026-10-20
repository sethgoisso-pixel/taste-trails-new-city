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
