export interface QlooCallLog {
  endpoint: string;
  params: Record<string, string>;
  resultCount: number;
  durationMs: number;
  cached: boolean;
  error?: string;
}

export interface ResolvedEntity {
  query: string;
  id: string;
  name: string;
  type: string;
}

export interface RecItem {
  id: string;
  name: string;
  tags: string[];
  image?: string;
  subtitle?: string;
  url?: string;
}

export type PlaceCategory = "food" | "nightlife" | "culture";
export type MediaKind = "artist" | "movie" | "book";

export type StepResult<T> = { ok: true; value: T; calls: QlooCallLog[] } | { ok: false; error: string; calls: QlooCallLog[] };

export interface PlanWeek {
  title: string;
  text: string;
}
