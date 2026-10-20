import { describe, expect, it } from "vitest";
import { cacheKey, isCacheFresh, isRetryable, MAX_RETRIES, normalizeFavorites, whyLine } from "@/lib/taste-rules";

describe("taste rules", () => {
  it("keeps at most 5 favorites", () => {
    expect(normalizeFavorites(["a", "b", "c", "d", "e", "f", "g"])).toHaveLength(5);
  });
  it("drops duplicate and empty favorites", () => {
    expect(normalizeFavorites(["Nike", " nike ", "", "Kidjo"])).toEqual(["Nike", "Kidjo"]);
  });
  it("treats a cache entry as fresh under 24 hours", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    expect(isCacheFresh("2026-01-01T01:00:00Z", now)).toBe(true);
  });
  it("treats a cache entry as stale after 24 hours", () => {
    const now = Date.parse("2026-01-02T00:00:01Z");
    expect(isCacheFresh("2026-01-01T00:00:00Z", now)).toBe(false);
  });
  it("retries at most 2 times", () => {
    expect(MAX_RETRIES).toBe(2);
  });
  it("only retries rate limits and server errors", () => {
    expect([429, 500, 503].every(isRetryable)).toBe(true);
    expect([400, 401, 403, 404].some(isRetryable)).toBe(false);
  });
  it("builds the same cache key regardless of param order", () => {
    expect(cacheKey("/x", { b: "2", a: "1" })).toBe(cacheKey("/x", { a: "1", b: "2" }));
  });
  it("describes groups, never promises", () => {
    const line = whyLine(["Burna Boy"], ["African"], ["Africa"]);
    expect(line.startsWith("People who like Burna Boy tend to enjoy")).toBe(true);
    expect(line.toLowerCase()).not.toContain("you will love");
  });
});
