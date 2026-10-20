import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  Clapperboard,
  Database,
  Loader2,
  Music2,
  Sparkles,
  UtensilsCrossed,
  Wine,
  Landmark,
  X,
  Plus,
  Circle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  aiAlonePlan,
  getMedia,
  getPlaces,
  getRequestOrigin,
  getTasteTags,
  resolveFavorites,
  writePlan,
} from "@/lib/taste.functions";
import { DEMO_PRESET, MAX_FAVORITES, normalizeFavorites, whyLine } from "@/lib/taste-rules";
import type { MediaKind, PlaceCategory, PlanWeek, QlooCallLog, RecItem, StepResult } from "@/lib/taste-types";

const TITLE = "Taste Bridge — carry your taste to a new city";
const DESC =
  "Moving cities? Taste Bridge uses Qloo cultural taste data to show where people who share your favorites tend to eat, go out and explore in your new city.";

export const Route = createFileRoute("/")({
  loader: () => getRequestOrigin(),
  head: ({ loaderData }) => {
    const img = loaderData ? `${loaderData}/og-image.jpg` : undefined;
    return {
      meta: [
        { title: TITLE },
        { name: "description", content: DESC },
        { property: "og:title", content: TITLE },
        { property: "og:description", content: DESC },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: TITLE },
        { name: "twitter:description", content: DESC },
        ...(img
          ? [
              { property: "og:image", content: img },
              { name: "twitter:image", content: img },
            ]
          : []),
      ],
    };
  },
  component: Index,
});

type StepStatus = "pending" | "running" | "done" | "error";
interface TraceStep {
  id: string;
  label: string;
  status: StepStatus;
  calls: QlooCallLog[];
  note?: string;
}

const STEP_DEFS: { id: string; label: string }[] = [
  { id: "resolve", label: "Resolving favorites to Qloo entities" },
  { id: "tags", label: "Reading taste tags" },
  { id: "places", label: "Finding places in the target city" },
  { id: "media", label: "Finding music, movies and books" },
  { id: "plan", label: "Writing the 30-day plan" },
];

interface Result {
  favorites: string[];
  targetCity: string;
  tasteTags: string[];
  places: Record<PlaceCategory, RecItem[]>;
  media: Record<MediaKind, RecItem[]>;
  plan?: PlanWeek[];
  planError?: string;
}

function parsePlan(text: string): PlanWeek[] {
  const weeks = text
    .split(/\n+/)
    .map((l) => l.trim())
    .map((l) => l.match(/^\**\s*(Week\s*\d)\s*[:\-–]\**\s*(.+)$/i))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ title: m[1].replace(/\s+/, " "), text: m[2] }));
  return weeks.length ? weeks : [{ title: "Plan", text: text.trim() }];
}

function Index() {
  const [homeCity, setHomeCity] = useState("");
  const [targetCity, setTargetCity] = useState("");
  const [favorites, setFavorites] = useState<string[]>([""]);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [view, setView] = useState<"qloo" | "ai">("qloo");
  const [aiAlone, setAiAlone] = useState<{ loading: boolean; plan?: PlanWeek[]; error?: string }>({ loading: false });
  const [announce, setAnnounce] = useState("");
  const resultRef = useRef<HTMLHeadingElement>(null);

  const resolveFn = useServerFn(resolveFavorites);
  const tagsFn = useServerFn(getTasteTags);
  const placesFn = useServerFn(getPlaces);
  const mediaFn = useServerFn(getMedia);
  const planFn = useServerFn(writePlan);
  const aloneFn = useServerFn(aiAlonePlan);

  const update = (id: string, patch: Partial<TraceStep>) => {
    setSteps((s) => s.map((st) => (st.id === id ? { ...st, ...patch, calls: patch.calls ? [...st.calls, ...patch.calls] : st.calls } : st)));
    const def = STEP_DEFS.find((d) => d.id === id);
    if (def && patch.status) setAnnounce(`${def.label}: ${patch.status === "done" ? "done" : patch.status}`);
  };

  async function run(home: string, target: string, favs: string[]) {
    const cleaned = normalizeFavorites(favs);
    if (home.trim().length < 2 || target.trim().length < 2 || !cleaned.length) {
      setError("Please enter both cities and at least one favorite.");
      return;
    }
    setError(null);
    setResult(null);
    setView("qloo");
    setAiAlone({ loading: false });
    setRunning(true);
    setSteps(STEP_DEFS.map((d) => ({ ...d, status: "pending", calls: [] })));

    const stop = (id: string, r: { error: string; calls: QlooCallLog[] }) => {
      update(id, { status: "error", calls: r.calls, note: r.error });
      setError(r.error);
      setRunning(false);
    };

    try {
      update("resolve", { status: "running" });
      const res = await resolveFn({ data: { favorites: cleaned } });
      if (!res.ok) return stop("resolve", res);
      const missing = cleaned.filter((f) => !res.value.some((v) => v.query === f));
      update("resolve", {
        status: "done",
        calls: res.calls,
        note: `${res.value.length} of ${cleaned.length} resolved${missing.length ? ` (not found: ${missing.join(", ")})` : ""}`,
      });
      const ids = res.value.map((v) => v.id);
      const names = res.value.map((v) => v.name);

      update("tags", { status: "running" });
      update("places", { status: "running" });
      update("media", { status: "running" });
      const cats: PlaceCategory[] = ["food", "nightlife", "culture"];
      const kinds: MediaKind[] = ["artist", "movie", "book"];

      const tagsP = tagsFn({ data: { ids } }).then((r) => {
        update("tags", r.ok ? { status: "done", calls: r.calls, note: r.value.slice(0, 6).join(", ") } : { status: "error", calls: r.calls, note: r.error });
        return r;
      });
      const placesP = Promise.all(cats.map((category) => placesFn({ data: { ids, city: target.trim(), category } }))).then((rs) => {
        finish("places", rs);
        return rs;
      });
      const mediaP = Promise.all(kinds.map((kind) => mediaFn({ data: { ids, city: target.trim(), kind } }))).then((rs) => {
        finish("media", rs);
        return rs;
      });
      function finish(id: string, rs: StepResult<RecItem[]>[]) {
        const calls = rs.flatMap((r) => r.calls);
        const failed = rs.find((r): r is Extract<typeof r, { ok: false }> => !r.ok);
        const count = rs.reduce((n, r) => n + (r.ok ? r.value.length : 0), 0);
        update(id, failed && count === 0 ? { status: "error", calls, note: failed.error } : { status: "done", calls, note: `${count} found${failed ? " (some lookups failed)" : ""}` });
      }

      const [tags, placeRs, mediaRs] = await Promise.all([tagsP, placesP, mediaP]);
      const allFailed = [...placeRs, ...mediaRs].every((r) => !r.ok);
      if (allFailed) {
        const firstErr = [...placeRs, ...mediaRs].find((r): r is Extract<typeof r, { ok: false }> => !r.ok);
        setError(firstErr?.error ?? "Qloo returned no results.");
        update("plan", { status: "error", note: "Skipped: no data to plan with" });
        setRunning(false);
        return;
      }
      const tasteTags = tags.ok ? tags.value : [];
      const places = Object.fromEntries(cats.map((c, i) => [c, placeRs[i].ok ? placeRs[i].value : []])) as Record<PlaceCategory, RecItem[]>;
      const media = Object.fromEntries(kinds.map((k, i) => [k, mediaRs[i].ok ? mediaRs[i].value : []])) as Record<MediaKind, RecItem[]>;
      const base: Result = { favorites: names, targetCity: target.trim(), tasteTags, places, media };
      setResult(base);

      update("plan", { status: "running" });
      const pick = (rec: Record<string, RecItem[]>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.map((i) => i.name)]));
      const plan = await planFn({
        data: { homeCity: home.trim(), targetCity: target.trim(), favorites: names, tasteTags: tasteTags.slice(0, 15), places: pick(places), media: pick(media) },
      });
      if (plan.ok) {
        update("plan", { status: "done", note: "Written by Lovable AI from the Qloo data only" });
        setResult({ ...base, plan: parsePlan(plan.text) });
      } else {
        update("plan", { status: "error", note: plan.error });
        setResult({ ...base, planError: plan.error });
      }
      setTimeout(() => resultRef.current?.focus(), 50);
    } catch (e) {
      console.error(e);
      setError("The connection dropped. Please check your network and try again.");
    } finally {
      setRunning(false);
    }
  }

  async function showAiAlone() {
    setView("ai");
    if (aiAlone.plan || aiAlone.loading || !result) return;
    setAiAlone({ loading: true });
    const r = await aloneFn({ data: { homeCity: homeCity.trim(), targetCity: targetCity.trim(), favorites: result.favorites } }).catch(() => ({ ok: false as const, error: "The connection dropped." }));
    setAiAlone(r.ok ? { loading: false, plan: parsePlan(r.text) } : { loading: false, error: r.error });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run(homeCity, targetCity, favorites);
  }

  function tryDemo() {
    setHomeCity(DEMO_PRESET.homeCity);
    setTargetCity(DEMO_PRESET.targetCity);
    setFavorites([...DEMO_PRESET.favorites]);
    void run(DEMO_PRESET.homeCity, DEMO_PRESET.targetCity, [...DEMO_PRESET.favorites]);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <img src="/favicon.svg" alt="" width={28} height={28} className="rounded-md" />
          Taste Bridge
        </div>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Carry what you love to your new city.
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Tell us your favorite artists, movies, books or brands. An agent reads cultural taste data from Qloo and shows where
          people who share those tastes tend to go in the city you are moving to.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="step1" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <h2 id="step1" className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <StepBadge n={1} /> Your move and your favorites
          </h2>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="home" label="Home city" value={homeCity} onChange={setHomeCity} placeholder="e.g. Cotonou" />
              <Field id="target" label="Target city" value={targetCity} onChange={setTargetCity} placeholder="e.g. Berlin" />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">
                Favorites <span className="font-normal text-muted-foreground">(up to {MAX_FAVORITES}: artists, movies, books or brands)</span>
              </legend>
              {favorites.map((f, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    aria-label={`Favorite ${i + 1}`}
                    value={f}
                    maxLength={80}
                    placeholder={["Burna Boy", "Black Panther", "Americanah", "Nike", "Angélique Kidjo"][i]}
                    onChange={(e) => setFavorites((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                    className="h-11"
                  />
                  {favorites.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label={`Remove favorite ${i + 1}`}
                      onClick={() => setFavorites((all) => all.filter((_, j) => j !== i))}
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              {favorites.length < MAX_FAVORITES && (
                <Button type="button" variant="ghost" className="min-h-11 self-start" onClick={() => setFavorites((a) => [...a, ""])}>
                  <Plus aria-hidden /> Add a favorite
                </Button>
              )}
            </fieldset>
            <p className="text-xs text-muted-foreground">
              Only city names and favorite titles are sent to Qloo. No names, emails or personal data leave this page.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" size="lg" className="min-h-11" disabled={running}>
                {running ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
                {running ? "Agent is working…" : "Build my bridge"}
              </Button>
              <Button type="button" size="lg" variant="secondary" className="min-h-11" onClick={tryDemo} disabled={running}>
                <Sparkles aria-hidden /> Try the demo
              </Button>
            </div>
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <span>
                  <strong>Something went wrong.</strong> {error}
                </span>
              </div>
            )}
          </form>
        </section>

        <AgentTrace steps={steps} announce={announce} />
      </div>

      {result && (
        <section aria-labelledby="results" className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="results" ref={resultRef} tabIndex={-1} className="flex items-center gap-2 text-2xl font-semibold sm:text-3xl">
                <StepBadge n={3} /> Your first 30 days in {result.targetCity}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Based on what groups of people who like {result.favorites.join(", ")} tend to enjoy.
              </p>
            </div>
            <div role="tablist" aria-label="Compare answers" className="inline-flex rounded-xl border border-border bg-muted p-1">
              <TabBtn active={view === "qloo"} onClick={() => setView("qloo")} id="tab-qloo" controls="panel-view">
                <Database className="size-4" aria-hidden /> With Qloo
              </TabBtn>
              <TabBtn active={view === "ai"} onClick={() => void showAiAlone()} id="tab-ai" controls="panel-view">
                <Sparkles className="size-4" aria-hidden /> AI alone
              </TabBtn>
            </div>
          </div>

          <div id="panel-view" role="tabpanel" aria-labelledby={view === "qloo" ? "tab-qloo" : "tab-ai"}>
            {view === "qloo" ? <QlooResult r={result} /> : <AiAloneView state={aiAlone} />}
          </div>
        </section>
      )}

      <footer className="mt-auto border-t border-border pt-6 text-xs text-muted-foreground">
        Taste data by Qloo. Recommendations describe group tendencies, not personal predictions. Plan written by Lovable AI.
      </footer>
    </main>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
      {n}
    </span>
  );
}

function Field({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} maxLength={80} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-11" required />
    </div>
  );
}

function TabBtn({ active, onClick, children, id, controls }: { active: boolean; onClick: () => void; children: React.ReactNode; id: string; controls: string }) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors ${
        active ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      {active && <span className="sr-only">(selected)</span>}
    </button>
  );
}

const STATUS_TEXT: Record<StepStatus, string> = { pending: "Waiting", running: "Running", done: "Done", error: "Failed" };

function StatusIcon({ s }: { s: StepStatus }) {
  if (s === "running") return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
  if (s === "done") return <Check className="size-4 text-mint-foreground" aria-hidden />;
  if (s === "error") return <AlertTriangle className="size-4 text-destructive" aria-hidden />;
  return <Circle className="size-4 text-muted-foreground" aria-hidden />;
}

function AgentTrace({ steps, announce }: { steps: TraceStep[]; announce: string }) {
  return (
    <section aria-labelledby="trace" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 id="trace" className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <StepBadge n={2} /> Agent trace
      </h2>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announce}
      </div>
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">Each step and every Qloo call will appear here as the agent works.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.id} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <StatusIcon s={s.status} /> {s.label}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.status === "done"
                      ? "bg-mint text-mint-foreground"
                      : s.status === "error"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {STATUS_TEXT[s.status]}
                </span>
              </div>
              {s.note && <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>}
              {s.calls.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {s.calls.map((c, i) => (
                    <li key={i} className="overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
                      <span className="font-semibold">GET {c.endpoint}</span>{" "}
                      <span className="text-muted-foreground">
                        {Object.entries(c.params)
                          .map(([k, v]) => `${k}=${v.length > 60 ? `${v.slice(0, 57)}…` : v}`)
                          .join(" · ")}
                      </span>
                      <span className="block">
                        {c.error ? `✕ ${c.error}` : `${c.resultCount} results`} · {c.durationMs} ms{c.cached ? " · from cache" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const PLACE_META: Record<PlaceCategory, { label: string; Icon: typeof Wine }> = {
  food: { label: "Food", Icon: UtensilsCrossed },
  nightlife: { label: "Nightlife", Icon: Wine },
  culture: { label: "Culture", Icon: Landmark },
};
const MEDIA_META: Record<MediaKind, { label: string; Icon: typeof Wine }> = {
  artist: { label: "Music", Icon: Music2 },
  movie: { label: "Movies", Icon: Clapperboard },
  book: { label: "Books", Icon: BookOpen },
};

function QlooResult({ r }: { r: Result }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="mb-3 text-lg font-semibold">Places</h3>
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.keys(PLACE_META) as PlaceCategory[]).map((c) => (
            <ItemGroup key={c} {...PLACE_META[c]} items={r.places[c]} favorites={r.favorites} tasteTags={r.tasteTags} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-lg font-semibold">Music, movies and books</h3>
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.keys(MEDIA_META) as MediaKind[]).map((k) => (
            <ItemGroup key={k} {...MEDIA_META[k]} items={r.media[k]} favorites={r.favorites} tasteTags={r.tasteTags} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-lg font-semibold">Week by week</h3>
        {r.plan ? (
          <PlanList plan={r.plan} tone="mint" />
        ) : r.planError ? (
          <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="size-4 text-destructive" aria-hidden /> {r.planError} The places and media above are still valid.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Writing the plan…
          </p>
        )}
      </div>
    </div>
  );
}

function ItemGroup({ label, Icon, items, favorites, tasteTags }: { label: string; Icon: typeof Wine; items: RecItem[]; favorites: string[]; tasteTags: string[] }) {
  return (
    <div className="rounded-2xl border border-mint-border bg-mint p-4 text-mint-foreground">
      <h4 className="mb-3 flex items-center gap-2 font-semibold">
        <Icon className="size-4" aria-hidden /> {label}
      </h4>
      {items.length === 0 ? (
        <p className="text-sm">No strong matches found here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li key={it.id} className="rounded-xl bg-card p-3 text-card-foreground">
              <p className="font-semibold">{it.name}</p>
              {it.subtitle && <p className="text-xs text-muted-foreground">{it.subtitle}</p>}
              <p className="mt-1 text-sm">{whyLine(favorites, it.tags, tasteTags)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanList({ plan, tone }: { plan: PlanWeek[]; tone: "mint" | "muted" }) {
  return (
    <ol className="grid gap-3 md:grid-cols-2">
      {plan.map((w) => (
        <li
          key={w.title}
          className={`rounded-2xl border p-4 ${tone === "mint" ? "border-mint-border bg-mint text-mint-foreground" : "border-border bg-muted text-foreground"}`}
        >
          <p className="font-display font-semibold">{w.title}</p>
          <p className="mt-1 text-sm">{w.text}</p>
        </li>
      ))}
    </ol>
  );
}

function AiAloneView({ state }: { state: { loading: boolean; plan?: PlanWeek[]; error?: string } }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-xl border border-border bg-card p-3 text-sm">
        <strong>AI alone:</strong> the same AI, the same favorites, but no Qloo data. Places and titles may be generic,
        outdated or invented, and there is no shared-taste reasoning behind them.
      </p>
      {state.loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Asking the AI without data…
        </p>
      )}
      {state.error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="size-4 text-destructive" aria-hidden /> {state.error}
        </p>
      )}
      {state.plan && <PlanList plan={state.plan} tone="muted" />}
    </div>
  );
}
