import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { aiErrorMessage, generatePlainText } from "./ai.server";
import { qlooGet, QlooError } from "./qloo.server";
import {
  filterTags,
  isTrustedMatch,
  lodgingReason,
  MAX_FAVORITES,
  MIN_FAVORITES,
  MIN_FAVORITES_MESSAGE,
  normalizeFavorites,
  placeCityReason,
  sharedTags,
  verifyPlan,
  type RawTag,
} from "./taste-rules";
import type {
  Exclusion,
  MediaKind,
  PlaceCategory,
  QlooCallLog,
  RecItem,
  ResolveResult,
  StepResult,
} from "./taste-types";

const city = z.string().trim().min(2).max(80);
const ids = z.array(z.string().min(8).max(64)).min(1).max(5);
const tagList = z.array(z.string().max(60)).max(30);

/** Places below this Qloo affinity are dropped: better 3 good results than 4 weak ones. */
const MIN_PLACE_AFFINITY = 0.6;

function fail<T>(err: unknown, calls: QlooCallLog[]): StepResult<T> {
  if (err instanceof QlooError) return { ok: false, error: err.message, calls: [...calls, err.log] };
  console.error(err);
  return { ok: false, error: "Something went wrong while talking to Qloo.", calls };
}

interface RawEntity {
  entity_id: string;
  name: string;
  types?: string[];
  query?: { affinity?: number };
  tags?: { name?: string; type?: string; tag_id?: string; id?: string }[];
  properties?: {
    image?: { url?: string };
    images?: { url?: string }[];
    address?: string;
    postal_code?: string;
    release_year?: number;
    publication_year?: number;
    website?: string;
    hotel_class?: unknown;
    number_of_rooms?: unknown;
    primary_genre?: { id?: string } | null;
    locality?: { city?: { name?: string } | string | null } | null;
    localities?: { name?: string }[];
  };
}

function toItem(e: RawEntity): { item: RecItem; keptTags: RawTag[] } {
  const p = e.properties ?? {};
  const year = p.release_year ?? p.publication_year;
  const raw: RawTag[] = (e.tags ?? []).map((t) => ({ name: t.name ?? "", type: t.type ?? "" }));
  const { kept } = filterTags(raw);
  const affinity = e.query?.affinity;
  return {
    keptTags: kept,
    item: {
      id: e.entity_id,
      name: e.name,
      tags: kept.slice(0, 8).map((t) => t.name),
      image: p.image?.url ?? p.images?.[0]?.url,
      subtitle: p.address ?? (year ? String(year) : undefined),
      url: p.website ?? undefined,
      affinity: typeof affinity === "number" ? affinity : undefined,
    },
  };
}

export const resolveFavorites = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ favorites: z.array(z.string()).min(1).max(10) }).parse(d))
  .handler(async ({ data }): Promise<StepResult<ResolveResult>> => {
    const favorites = normalizeFavorites(data.favorites);
    if (favorites.length < MIN_FAVORITES) return { ok: false, error: MIN_FAVORITES_MESSAGE, calls: [] };
    const calls: QlooCallLog[] = [];
    try {
      const results = await Promise.all(
        favorites.map((q) =>
          qlooGet("/search", { query: q, take: "1" }).then(({ data, log }) => {
            calls.push(log);
            const r = (data as { results?: RawEntity[] }).results?.[0];
            return { q, r };
          }),
        ),
      );
      const out: ResolveResult = { value: [], suggestions: [], missing: [] };
      for (const { q, r } of results) {
        if (!r) out.missing.push(q);
        else if (!isTrustedMatch(q, r.name)) out.suggestions.push({ query: q, name: r.name });
        else out.value.push({ query: q, id: r.entity_id, name: r.name, type: r.types?.[0] ?? "" });
      }
      return { ok: true, value: out, calls };
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
        "filter.tag.types": "urn:tag:genre:media,urn:tag:genre:place",
        "signal.interests.entities": data.ids.join(","),
        take: "25",
      });
      const raw = ((res as { results?: { tags?: { name?: string; subtype?: string; type?: string }[] } }).results?.tags ?? []).map(
        (t) => ({ name: t.name ?? "", type: t.subtype ?? t.type ?? "" }),
      );
      const { kept, dropped } = filterTags(raw);
      return {
        ok: true,
        value: kept.map((t) => t.name),
        calls: [log],
        meta: { rawCount: raw.length, excluded: dropped.map((d) => ({ name: d.name, reason: d.reason })), keptTags: kept },
      };
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
        take: "15",
      });
      const raw = (res as { results?: { entities?: RawEntity[] } }).results?.entities ?? [];
      const excluded: Exclusion[] = [];
      const kept: RecItem[] = [];
      const keptTags: RawTag[] = [];
      for (const e of raw) {
        const p = e.properties ?? {};
        const lodging = lodgingReason({
          name: e.name,
          primaryGenre: p.primary_genre?.id,
          tagIds: (e.tags ?? []).map((t) => t.tag_id ?? t.id ?? t.type ?? ""),
          hotelClass: p.hotel_class,
          numberOfRooms: p.number_of_rooms,
        });
        const loc = p.locality?.city;
        const where = placeCityReason(data.city, {
          address: p.address,
          locality: typeof loc === "string" ? loc : loc?.name,
          localities: (p.localities ?? []).map((l) => l.name ?? ""),
          postalCode: p.postal_code,
        });
        const aff = e.query?.affinity;
        const reason =
          lodging ?? where ?? (typeof aff === "number" && aff < MIN_PLACE_AFFINITY ? `low affinity (${aff.toFixed(2)})` : null);
        if (reason) excluded.push({ name: e.name, reason });
        else if (kept.length < 4) {
          const t = toItem(e);
          kept.push(t.item);
          keptTags.push(...t.keptTags);
        }
      }
      if (excluded.length) console.log(`[places:${data.category}:${data.city}] excluded`, JSON.stringify(excluded));
      return { ok: true, value: kept, calls: [log], meta: { rawCount: raw.length, excluded, keptTags } };
    } catch (e) {
      return fail(e, []);
    }
  });

export const getMedia = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ ids, city, kind: z.enum(["artist", "movie", "book"]), tasteTags: tagList }).parse(d),
  )
  .handler(async ({ data }): Promise<StepResult<RecItem[]>> => {
    const kind: MediaKind = data.kind;
    try {
      const { data: res, log } = await qlooGet("/v2/insights", {
        "filter.type": `urn:entity:${kind}`,
        "signal.location.query": data.city,
        "signal.interests.entities": data.ids.join(","),
        take: "8",
      });
      const raw = (res as { results?: { entities?: RawEntity[] } }).results?.entities ?? [];
      const excluded: Exclusion[] = [];
      const kept: RecItem[] = [];
      const keptTags: RawTag[] = [];
      for (const e of raw) {
        const t = toItem(e);
        // Low signal: an item sharing no genre with the taste profile is off-topic (e.g. political memoirs for Afrobeats).
        if (sharedTags(t.item.tags, data.tasteTags).length === 0) excluded.push({ name: e.name, reason: "no shared taste tag" });
        else if (kept.length < 4) {
          kept.push(t.item);
          keptTags.push(...t.keptTags);
        }
      }
      return { ok: true, value: kept, calls: [log], meta: { rawCount: raw.length, excluded, keptTags, lowSignal: kept.length === 0 } };
    } catch (e) {
      return fail(e, []);
    }
  });

const PLAN_FORMAT =
  'Write exactly 4 lines, one per week, each starting with "Week 1:", "Week 2:", "Week 3:", "Week 4:". Plain text, no markdown, no bullets.';

const planInput = z.object({
  homeCity: city,
  targetCity: city,
  favorites: z.array(z.string().max(120)).max(MAX_FAVORITES),
  places: z.record(z.array(z.string().max(120)).max(6)),
  media: z.record(z.array(z.string().max(120)).max(6)),
  tasteTags: tagList,
  rejected: z.array(z.string().max(160)).max(10).default([]),
});

function planPrompt(d: z.infer<typeof planInput>, allowed: string[]): string {
  return [
    `You help someone who just moved from ${d.homeCity} to ${d.targetCity} settle in over 30 days. Warm, friendly, practical.`,
    `Each week must contain: one place AND one song/artist, movie or book, plus one concrete action (for example: Visit "Makenene Lounge" on a weekday evening, then put on "Jorja Smith" on the way home).`,
    `You may ONLY name places, artists, movies and books from this list, and you MUST wrap every such name in double quotes exactly as written: ${allowed.map((a) => `"${a}"`).join(", ")}.`,
    `Never name any other venue, title, artist, street or event. Never use vague filler like "quiet time" or "optional meal".`,
    `You may add at most 1 or 2 general tips per week; each must start with "General tip (not from Qloo):" and must not name any venue or title.`,
    `Do not say "you will love"; describe group tendencies if needed.`,
    PLAN_FORMAT,
  ].join(" ");
}

export const writePlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => planInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; text: string; removed: string[] } | { ok: false; error: string }> => {
    try {
      const allowed = [...Object.values(data.places).flat(), ...Object.values(data.media).flat()];
      const forbidden = data.rejected;
      const ctx = JSON.stringify({ places: data.places, media: data.media, tasteTags: data.tasteTags });
      let best = verifyPlan(await generatePlainText(planPrompt(data, allowed), ctx), allowed, forbidden);
      if (best.removed.length || best.weeksWithoutEntity > 0) {
        // One regeneration; keep whichever version needed fewer removals.
        const retry = verifyPlan(await generatePlainText(planPrompt(data, allowed), ctx), allowed, forbidden);
        if (retry.removed.length + retry.weeksWithoutEntity < best.removed.length + best.weeksWithoutEntity) best = retry;
      }
      if (best.removed.length) console.log("[plan] removed unverified mentions", JSON.stringify(best.removed));
      return { ok: true, text: best.text, removed: best.removed };
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
