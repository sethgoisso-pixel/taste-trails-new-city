import { describe, expect, it } from "vitest";
import {
  buildExplanations,
  cacheKey,
  categoryReason,
  isGenericTag,
  filterTags,
  formatResolutionNote,
  getMatchBadge,
  isCacheFresh,
  isPlaceInCity,
  isRetryable,
  isTrustedMatch,
  categoryMismatchReason,
  lodgingReason,
  meaningfulTasteTags,
  MAX_RETRIES,
  MIN_FAVORITES,
  normalizeFavorites,
  placeCityReason,
  sharedTags,
  stepStatusFor,
  verifyPlan,
} from "@/lib/taste-rules";

describe("base rules", () => {
  it("keeps at most 5 favorites", () => {
    expect(normalizeFavorites(["a", "b", "c", "d", "e", "f", "g"])).toHaveLength(5);
  });
  it("drops duplicate and empty favorites", () => {
    expect(normalizeFavorites(["Nike", " nike ", "", "Kidjo"])).toEqual(["Nike", "Kidjo"]);
  });
  it("treats a cache entry as fresh under 24 hours and stale after", () => {
    expect(isCacheFresh("2026-01-01T01:00:00Z", Date.parse("2026-01-02T00:00:00Z"))).toBe(true);
    expect(isCacheFresh("2026-01-01T00:00:00Z", Date.parse("2026-01-02T00:00:01Z"))).toBe(false);
  });
  it("retries at most 2 times, only for rate limits and server errors", () => {
    expect(MAX_RETRIES).toBe(2);
    expect([429, 500, 503].every(isRetryable)).toBe(true);
    expect([400, 401, 403, 404].some(isRetryable)).toBe(false);
  });
  it("builds the same cache key regardless of param order", () => {
    expect(cacheKey("/x", { b: "2", a: "1" })).toBe(cacheKey("/x", { a: "1", b: "2" }));
  });
});

describe("T1 resolution is verified", () => {
  it("rejects Vani baby -> Ice Ice Baby", () => {
    expect(isTrustedMatch("Vani baby", "Ice Ice Baby - Vanilla Ice - Hip Hop's First Global #1")).toBe(false);
  });
  it("accepts exact and near-exact names", () => {
    expect(isTrustedMatch("Burna Boy", "Burna Boy")).toBe(true);
    expect(isTrustedMatch("burna boy", "Burna Boy")).toBe(true);
    expect(isTrustedMatch("Angelique Kidjo", "Angélique Kidjo")).toBe(true);
    expect(isTrustedMatch("Black Panther", "Black Panther")).toBe(true);
    expect(isTrustedMatch("Burna boi", "Burna Boy")).toBe(true);
  });
  it("accepts a query contained as whole words in a longer title", () => {
    expect(isTrustedMatch("Americanah", "Americanah")).toBe(true);
    expect(isTrustedMatch("Nike", "Nike")).toBe(true);
  });
});

describe("T2 at least 2 favorites", () => {
  it("requires 2", () => {
    expect(MIN_FAVORITES).toBe(2);
  });
});

describe("T3 no lodging in any list", () => {
  it("excludes hotels by name", () => {
    expect(lodgingReason({ name: "Hôtel Villa Saxe Eiffel" })).not.toBeNull();
    expect(lodgingReason({ name: "La Villa Haussmann Hôtel Paris" })).not.toBeNull();
    expect(lodgingReason({ name: "Campanile Prime - Paris - Porte De Bagnolet" })).not.toBeNull();
    expect(lodgingReason({ name: "Estrel Berlin" })).not.toBeNull();
  });
  it("excludes hotel facts", () => {
    expect(lodgingReason({ name: "X", hotelClass: 4 })).not.toBeNull();
    expect(lodgingReason({ name: "X", numberOfRooms: 120 })).not.toBeNull();
  });
  it("keeps normal venues", () => {
    expect(lodgingReason({ name: "Café de Flore" })).toBeNull();
    expect(lodgingReason({ name: "Musée d'Orsay" })).toBeNull();
    expect(lodgingReason({ name: "Makenene Lounge" })).toBeNull();
    expect(lodgingReason({ name: "Solera Paris : Bar à Cocktail" })).toBeNull();
  });
});

describe("T4 generic city filter", () => {
  it("Paris accepts arrondissements and rejects the suburbs", () => {
    expect(isPlaceInCity("Paris", { address: "172 Bd Saint-Germain 75006 Paris France" })).toBe(true);
    expect(isPlaceInCity("Paris", { address: "Place Georges-Pompidou 75004 Paris France" })).toBe(true);
    expect(isPlaceInCity("Paris", { address: "28 Av. du Général de Gaulle 93170 Bagnolet France" })).toBe(false);
    expect(isPlaceInCity("Paris", { address: "1 Rue X 92100 Boulogne-Billancourt Paris France" })).toBe(false);
  });
  it("Paris rejects a place whose address names another city", () => {
    expect(isPlaceInCity("Paris", { address: "Rue de Rivoli, Lyon, France" })).toBe(false);
  });
  it("Berlin accepts 10115-14199 and rejects Potsdam and Neuenhagen", () => {
    expect(isPlaceInCity("Berlin", { address: "Schillerstraße 20 10625 Berlin Germany" })).toBe(true);
    expect(isPlaceInCity("Berlin", { address: "Weinbergsweg 1A 10119 Berlin Germany" })).toBe(true);
    expect(isPlaceInCity("Berlin", { address: "Friedrich-Ebert-Str. 14467 Potsdam Berlin-Brandenburg" })).toBe(false);
    expect(isPlaceInCity("Berlin", { address: "Carl-Schmäcke-Straße 33 15366 Neuenhagen Germany" })).toBe(false);
  });
  it("a postal code alone is never enough", () => {
    expect(placeCityReason("Berlin", { address: "Some street 10115" })).not.toBeNull();
  });
  it("works accent- and case-insensitively", () => {
    expect(isPlaceInCity("sao paulo", { address: "Av. Paulista 1000 São Paulo Brazil" })).toBe(true);
  });
});

describe("T5 tags are clean", () => {
  const raw = [
    { name: "Afrobeats", type: "urn:tag:genre:media" },
    { name: "West African", type: "urn:tag:cuisine:qloo" },
    { name: "Lively", type: "urn:tag:ambience:qloo" },
    { name: "Young professionals", type: "urn:tag:customer_identity:qloo" },
    { name: "Drug dealer", type: "urn:tag:keyword:media" },
    { name: "Woman bathes a man", type: "urn:tag:keyword:media" },
    { name: "Orko suppe", type: "urn:tag:menu_highlight:qloo" },
    { name: "Debit cards", type: "urn:tag:amenity:qloo" },
    { name: "Elevator", type: "urn:tag:amenity:qloo" },
    { name: "Polyamory", type: "urn:tag:keyword:media" },
    { name: "Hookah culture", type: "urn:tag:ambience:qloo" },
  ];
  const { kept } = filterTags(raw);
  it("keeps genre, cuisine, ambience and audience tags", () => {
    expect(kept.map((t) => t.name)).toEqual(["Afrobeats", "West African", "Lively", "Young professionals"]);
  });
  it("drops keywords, menu items, amenities and sensitive terms", () => {
    const names = kept.map((t) => t.name);
    for (const bad of ["Drug dealer", "Woman bathes a man", "Orko suppe", "Debit cards", "Elevator", "Polyamory", "Hookah culture"]) {
      expect(names.includes(bad)).toBe(false);
    }
  });
});

describe("T6 match badge varies", () => {
  it("only the upper half of a list is strong", () => {
    const list = [0.95, 0.9, 0.8, 0.7, 0.62, 0.61];
    const labels = list.map((a) => getMatchBadge(a, 0, list).tone);
    expect(labels.includes("strong")).toBe(true);
    expect(labels.includes("medium")).toBe(true);
  });
  it("low affinity is always medium", () => {
    expect(getMatchBadge(0.4, 5, [0.4, 0.3]).tone).toBe("medium");
  });
  it("without a score, needs 2 shared tags", () => {
    expect(getMatchBadge(undefined, 2).tone).toBe("strong");
    expect(getMatchBadge(undefined, 1).tone).toBe("medium");
  });
});

describe("T7 explanations are distinct", () => {
  it("never repeats the same sentence", () => {
    const items = [
      { id: "1", name: "A", tags: ["West African", "Lively"], group: "Food" },
      { id: "2", name: "B", tags: ["West African", "Lively"], group: "Food" },
      { id: "3", name: "C", tags: ["Lively"], group: "Food" },
      { id: "4", name: "D", tags: [], group: "Culture" },
      { id: "5", name: "E", tags: [], group: "Culture" },
    ];
    const out = buildExplanations(items, ["West African", "Afrobeats"]);
    const texts = Object.values(out);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.some((t) => t.includes("People who like"))).toBe(false);
  });
  it("shares tags between item and taste profile", () => {
    expect(sharedTags(["Afrobeats", "Calm"], ["Afrobeats", "Jazz"])).toEqual(["Afrobeats"]);
  });
});

describe("T8 empty steps are warnings", () => {
  it("0 results is a warning, never done", () => {
    expect(stepStatusFor(0)).toBe("warning");
    expect(stepStatusFor(3)).toBe("done");
  });
});

describe("T9 the plan names only verified entities", () => {
  const allowed = ["Makenene Lounge", "Koffee", "Fighting with My Family"];
  it("keeps verified mentions", () => {
    const r = verifyPlan('Week 1: Visit "Makenene Lounge" and play "Koffee".', allowed);
    expect(r.removed).toHaveLength(0);
  });
  it("removes invented places", () => {
    const r = verifyPlan('Week 1: Visit "Club Invented" and play "Koffee".', allowed);
    expect(r.removed).toEqual(["Club Invented"]);
  });
  it("never names a rejected entity", () => {
    const r = verifyPlan('Week 1: Play "Koffee" like Ice Ice Baby.', allowed, ["Ice Ice Baby"]);
    expect(r.text.toLowerCase().includes("ice ice baby")).toBe(false);
  });
  it("flags weeks without any verified entity", () => {
    const r = verifyPlan("Week 1: Take a walk.\nWeek 2: Visit \"Koffee\".", allowed);
    expect(r.weeksWithoutEntity).toBe(1);
  });
});

describe("resolution note", () => {
  it("is computed, not hard-coded", () => {
    expect(formatResolutionNote(["Burna Boy", "Nike"], ["Burna Boy", "Nike"])).toBe("2 of 2 resolved");
    expect(formatResolutionNote(["Burna Boy"], ["Burna Boy", "UnknownBand"])).toBe("1 of 2 resolved (missing: UnknownBand)");
  });
});

describe("generic tags are not tastes", () => {
  it("recognizes venue and format tags", () => {
    for (const t of ["Restaurant", "Bar", "Ski resort", "Audiobook", "Fiction"]) expect(isGenericTag(t)).toBe(true);
    expect(isGenericTag("African")).toBe(false);
  });
  it("never counts them as shared taste", () => {
    expect(sharedTags(["Restaurant", "African"], ["Restaurant", "African", "Ski resort"])).toEqual(["African"]);
    expect(sharedTags(["Audiobook"], ["Audiobook"])).toEqual([]);
  });
  it("never explains a card with 'taste for Restaurant'", () => {
    const out = buildExplanations(
      [{ id: "1", name: "A", tags: ["Restaurant", "Contemporary"], group: "Food" }],
      ["Restaurant", "African"],
    );
    expect(Object.values(out)[0]?.includes("taste for Restaurant")).toBe(false);
  });
});

describe("place category check", () => {
  it("keeps places whose primary genre fits", () => {
    expect(categoryReason("food", "urn:tag:genre:place:restaurant")).toBeNull();
    expect(categoryReason("nightlife", "urn:tag:genre:place:wine_bar")).toBeNull();
    expect(categoryReason("culture", "urn:tag:genre:place:museum")).toBeNull();
    expect(categoryReason("culture", "urn:tag:genre:place:art_gallery")).toBeNull();
  });
  it("rejects a restaurant listed as culture", () => {
    expect(categoryReason("culture", "urn:tag:genre:place:restaurant")).not.toBeNull();
  });
  it("cannot judge without a primary genre", () => {
    expect(categoryReason("culture", undefined)).toBeNull();
  });
});

describe("generic tags are not taste", () => {
  it("drops place categories and formats from the taste profile", () => {
    expect(meaningfulTasteTags(["Restaurant", "Bar", "African", "Fiction", "Caribbean", "Ski resort", "Audiobook", "Contemporary R&B"])).toEqual([
      "African",
      "Caribbean",
      "Contemporary R&B",
    ]);
  });
  it("an Obama memoir no longer matches an Afrobeats profile through 'Audiobook'", () => {
    const taste = meaningfulTasteTags(["Audiobook", "Fiction", "African", "Contemporary R&B"]);
    expect(sharedTags(["Audiobook", "Nonfiction", "Politics"], taste)).toEqual([]);
  });
});

describe("place category matches the primary genre", () => {
  it("rejects a restaurant listed under Culture or Nightlife", () => {
    expect(categoryMismatchReason("culture", "urn:tag:genre:place:restaurant")).not.toBeNull();
    expect(categoryMismatchReason("nightlife", "urn:tag:genre:place:restaurant")).not.toBeNull();
    expect(categoryMismatchReason("nightlife", "urn:tag:genre:place:japanese_restaurant")).not.toBeNull();
  });
  it("accepts real museums, galleries, bars and clubs", () => {
    expect(categoryMismatchReason("culture", "urn:tag:genre:place:art_museum")).toBeNull();
    expect(categoryMismatchReason("culture", "urn:tag:genre:place:art_gallery")).toBeNull();
    expect(categoryMismatchReason("nightlife", "urn:tag:genre:place:cocktail_bar")).toBeNull();
    expect(categoryMismatchReason("nightlife", "urn:tag:genre:place:nightclub")).toBeNull();
  });
  it("does not judge unknown formats, missing genres or the food category", () => {
    expect(categoryMismatchReason("culture", "something-else")).toBeNull();
    expect(categoryMismatchReason("culture", undefined)).toBeNull();
    expect(categoryMismatchReason("food", "urn:tag:genre:place:bar")).toBeNull();
  });
});

describe("more generic tags seen in real runs", () => {
  it("drops 'Resort hotel', 'Park', 'Shopping mall' and 'Roman'", () => {
    expect(meaningfulTasteTags(["African", "Caribbean", "Resort hotel", "Roman", "Park", "Shopping mall"])).toEqual(["African", "Caribbean"]);
  });
});
