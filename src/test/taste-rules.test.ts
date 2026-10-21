import { describe, expect, it } from "vitest";
import {
  cacheKey,
  formatResolutionNote,
  getMatchBadge,
  isCacheFresh,
  isPlaceInCity,
  isRetryable,
  MAX_RETRIES,
  normalizeFavorites,
} from "@/lib/taste-rules";

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
});

  it("filters places by city and validates Berlin postal code range", () => {
    // Berlin valid postal code
    expect(
      isPlaceInCity("Berlin", {
        address: "Bötzowstraße 31 10407 Berlin Germany",
      }),
    ).toBe(true);

    // Rejects Potsdam (14467)
    expect(
      isPlaceInCity("Berlin", {
        address: "Friedrich-Ebert-Str. 14467 Potsdam Berlin-Brandenburg",
      }),
    ).toBe(false);

    // Rejects Neuenhagen (15366)
    expect(
      isPlaceInCity("Berlin", {
        address: "Am Mühlenfließ 15366 Neuenhagen Berlin-Brandenburg",
      }),
    ).toBe(false);

    // Generic match for other cities
    expect(
      isPlaceInCity("Cotonou", {
        address: "Boulevard de la Marina, Cotonou, Bénin",
      }),
    ).toBe(true);

    expect(
      isPlaceInCity("Paris", {
        address: "Rue de Rivoli, Lyon, France",
      }),
    ).toBe(false);
  });

  it("formats resolution note dynamically", () => {
    expect(formatResolutionNote(["Burna Boy", "Nike"], ["Burna Boy", "Nike"])).toBe("2 of 2 resolved");
    expect(formatResolutionNote(["Burna Boy"], ["Burna Boy", "UnknownBand"])).toBe(
      "1 of 2 resolved (missing: UnknownBand)",
    );
  });

  it("calculates match badges based on real criteria without invented percentages", () => {
    expect(getMatchBadge(0.85, 0).label).toBe("Strong match");
    expect(getMatchBadge(0.4, 0).label).toBe("Medium match");
    expect(getMatchBadge(undefined, 3).label).toBe("Strong match");
    expect(getMatchBadge(undefined, 1).label).toBe("Medium match");
  });
