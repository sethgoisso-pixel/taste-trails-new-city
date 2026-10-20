import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { aiErrorMessage, generatePlainText } from "./ai.server";
import { qlooGet, QlooError } from "./qloo.server";
import { normalizeFavorites } from "./taste-rules";
import type { MediaKind, PlaceCategory, QlooCallLog, RecItem, ResolvedEntity, StepResult } from "./taste-types";

const city = z.string().trim().min(2).max(80);
const ids = z.array(z.string().min(8).max(64)).min(1).max(5);

function fail<T>(err: unknown, calls: QlooCallLog[]): StepResult<T> {
  if (err instanceof QlooError) return { ok: false, error: err.message, calls: [...calls, err.log] };
  console.error(err);
  return { ok: false, error: "Something went wrong while talking to Qloo.", calls };
}

interface RawEntity {
  entity_id: string;
  name: string;
  types?: string[];
  subtype?: string;
  tags?: { name?: string; type?: string }[];
  properties?: {
    image?: { url?: string };
    images?: { url?: string }[];
    address?: string;
    release_year?: number;
    publication_year?: number;
    website?: string;
  };
}

function toItem(e: RawEntity): RecItem {
  const p = e.properties ?? {};
  const year = p.release_year ?? p.publication_year;
  return {
    id: e.entity_id,
    name: e.name,
    tags: (e.tags ?? []).map((t) => t.name ?? "").filter(Boolean).slice(0, 8),
    image: p.image?.url ?? p.images?.[0]?.url,
    subtitle: p.address ?? (year ? String(year) : undefined),
    url: p.website ?? undefined,
  };
}

export const resolveFavorites = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ favorites: z.array(z.string()).min(1).max(10) }).parse(d))
  .handler(async ({ data }): Promise<StepResult<ResolvedEntity[]>> => {
    const favorites = normalizeFavorites(data.favorites);
    const calls: QlooCallLog[] = [];
    try {
      const results = await Promise.all(
        favorites.map((q) =>
          qlooGet("/search", { query: q, take: "1" }).then(({ data, log }) => {
            calls.push(log);
            const r = (data as { results?: RawEntity[] }).results?.[0];
            return r ? { query: q, id: r.entity_id, name: r.name, type: r.types?.[0] ?? "" } : null;
          }),
        ),
      );
      const value = results.filter((r): r is ResolvedEntity => r !== null);
      if (!value.length) return { ok: false, error: "None of the favorites were found in Qloo. Try other names.", calls };
      return { ok: true, value, calls };
    } catch (e) {
      return fail(e, calls);
    }
  });

export const getTasteTags = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ ids }).parse(d))
  .handler(async ({ data }): Promise<StepResult<string[]>> => {
    try {
      const { data: res, log } = await qlooGet("/v2/insights", {
        "filter.type": "urn:tag",
        "filter.tag.types": "urn:tag:genre:media,urn:tag:genre:place,urn:tag:keyword:media",
        "signal.interests.entities": data.ids.join(","),
        take: "15",
      });
      const tags = ((res as { results?: { tags?: { name: string }[] } }).results?.tags ?? []).map((t) => t.name);
      return { ok: true, value: [...new Set(tags)], calls: [log] };
    } catch (e) {
      return fail(e, []);
    }
  });

const PLACE_TAGS: Record<PlaceCategory, string> = {
  food: "urn:tag:genre:place:restaurant,urn:tag:genre:place:cafe",
  nightlife: "urn:tag:genre:place:bar,urn:tag:genre:place:nightclub,urn:tag:genre:place:lounge",
  culture: "urn:tag:genre:place:museum,urn:tag:genre:place:art_gallery,urn:tag:genre:place:theatre",
};

export const getPlaces = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ ids, city, category: z.enum(["food", "nightlife", "culture"]) }).parse(d))
  .handler(async ({ data }): Promise<StepResult<RecItem[]>> => {
    try {
      const { data: res, log } = await qlooGet("/v2/insights", {
        "filter.type": "urn:entity:place",
        "filter.tags": PLACE_TAGS[data.category],
        "filter.location.query": data.city,
        "signal.interests.entities": data.ids.join(","),
        take: "4",
      });
      const items = ((res as { results?: { entities?: RawEntity[] } }).results?.entities ?? []).map(toItem);
      return { ok: true, value: items, calls: [log] };
    } catch (e) {
      return fail(e, []);
    }
  });

export const getMedia = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ ids, city, kind: z.enum(["artist", "movie", "book"]) }).parse(d))
  .handler(async ({ data }): Promise<StepResult<RecItem[]>> => {
    const kind: MediaKind = data.kind;
    try {
      const { data: res, log } = await qlooGet("/v2/insights", {
        "filter.type": `urn:entity:${kind}`,
        "signal.location.query": data.city,
        "signal.interests.entities": data.ids.join(","),
        take: "4",
      });
      const items = ((res as { results?: { entities?: RawEntity[] } }).results?.entities ?? []).map(toItem);
      return { ok: true, value: items, calls: [log] };
    } catch (e) {
      return fail(e, []);
    }
  });

const PLAN_FORMAT =
  'Write exactly 4 lines, one per week, each starting with "Week 1:", "Week 2:", "Week 3:", "Week 4:". Each line is 1-2 sentences. Plain text, no markdown, no bullets.';

const planInput = z.object({
  homeCity: city,
  targetCity: city,
  favorites: z.array(z.string().max(80)).max(5),
  places: z.record(z.array(z.string().max(120)).max(6)),
  media: z.record(z.array(z.string().max(120)).max(6)),
  tasteTags: z.array(z.string().max(60)).max(20),
});

export const writePlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => planInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    try {
      const text = await generatePlainText(
        `You write a calm 30-day settling-in plan for someone who moved from ${data.homeCity} to ${data.targetCity}. Use ONLY the places, music, movies and books given in the data. Never invent venues or titles. The data describes what groups of people with similar taste tend to enjoy, so phrase it as "people who like X tend to enjoy Y", never "you will love". ${PLAN_FORMAT}`,
        JSON.stringify({ favorites: data.favorites, tasteTags: data.tasteTags, places: data.places, media: data.media }),
      );
      return { ok: true, text };
    } catch (e) {
      console.error(e);
      return { ok: false, error: aiErrorMessage(e) };
    }
  });

export const aiAlonePlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => planInput.pick({ homeCity: true, targetCity: true, favorites: true }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    try {
      const text = await generatePlainText(
        `Someone moved from ${data.homeCity} to ${data.targetCity}. Suggest places, music, movies and books for their first 30 days based on their favorites. ${PLAN_FORMAT}`,
        `Favorites: ${data.favorites.join(", ")}`,
      );
      return { ok: true, text };
    } catch (e) {
      console.error(e);
      return { ok: false, error: aiErrorMessage(e) };
    }
  });

export const getRequestOrigin = createServerFn({ method: "GET" }).handler(() => {
  const req = getRequest();
  const url = new URL(req.url);
  const sandboxHost = url.hostname === "localhost" ? req.headers.get("x-forwarded-host") : null;
  return sandboxHost ? `https://${sandboxHost}` : url.origin;
});
