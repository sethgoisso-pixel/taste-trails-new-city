import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { cacheKey, isCacheFresh, isRetryable, MAX_RETRIES } from "./taste-rules";
import type { QlooCallLog } from "./taste-types";

const BASE_URL = "https://hackathon.api.qloo.com";

export class QlooError extends Error {
  constructor(
    message: string,
    public log: QlooCallLog,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(status: number): string {
  if (status === 429) return "The Qloo quota or rate limit was reached. Please try again in a few minutes.";
  if (status === 401 || status === 403) return "The Qloo API key was rejected. Check the QLOO_API_KEY secret.";
  if (status >= 500) return "Qloo is temporarily unavailable. Please try again shortly.";
  return `Qloo could not handle this request (status ${status}).`;
}

/** GET a Qloo endpoint with a 24h database cache and at most 2 retries. */
export async function qlooGet(path: string, params: Record<string, string>): Promise<{ data: unknown; log: QlooCallLog }> {
  const started = Date.now();
  const key = cacheKey(path, params);
  const baseLog = { endpoint: path, params, cached: false, resultCount: 0, durationMs: 0 };

  const { data: hit } = await supabaseAdmin.from("qloo_cache").select("response, created_at").eq("cache_key", key).maybeSingle();
  if (hit && isCacheFresh(hit.created_at)) {
    return { data: hit.response, log: { ...baseLog, cached: true, resultCount: countResults(hit.response), durationMs: Date.now() - started } };
  }

  const apiKey = process.env["QLOO_API_KEY"];
  if (!apiKey) throw new QlooError("The Qloo API key is not configured.", { ...baseLog, error: "missing key" });

  const url = `${BASE_URL}${path}?${new URLSearchParams(params).toString()}`;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "X-Api-Key": apiKey, accept: "application/json" } });
    } catch {
      lastStatus = 503;
      if (attempt < MAX_RETRIES) await sleep(400 * 2 ** attempt + Math.random() * 200);
      continue;
    }
    lastStatus = res.status;
    if (res.ok) {
      const data = (await res.json()) as unknown;
      await supabaseAdmin.from("qloo_cache").upsert({ cache_key: key, response: data as Json, created_at: new Date().toISOString() });
      return { data, log: { ...baseLog, resultCount: countResults(data), durationMs: Date.now() - started } };
    }
    if (!isRetryable(res.status) || attempt === MAX_RETRIES) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 400 * 2 ** attempt + Math.random() * 200);
  }
  console.error(`Qloo ${path} failed with status ${lastStatus}`);
  throw new QlooError(friendly(lastStatus), { ...baseLog, durationMs: Date.now() - started, error: `status ${lastStatus}` });
}

function countResults(data: unknown): number {
  const d = data as { results?: unknown };
  if (Array.isArray(d?.results)) return d.results.length;
  const r = d?.results as { entities?: unknown[]; tags?: unknown[] } | undefined;
  return r?.entities?.length ?? r?.tags?.length ?? 0;
}
