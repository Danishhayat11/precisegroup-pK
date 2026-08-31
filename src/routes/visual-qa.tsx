import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

// Manifest is emitted by `node scripts/visual-regression.mjs` into
// public/visual-qa/manifest.json. Vite serves /public at the site root,
// so the dashboard fetches it at runtime.

type Finding = {
  rule: string;
  severity: "error" | "warn";
  message: string;
  detail?: unknown;
};

type DiffResult =
  | { ok: false; reason: string }
  | { ok: true; mismatchedPixels: number; totalPixels: number; pct: number };

type Run = {
  key: string;
  route: string;
  routeId: string;
  routeLabel: string;
  breakpoint: "375" | "768" | "1440";
  breakpointLabel: string;
  device: "mobile" | "tablet" | "desktop";
  url: string;
  status: "pass" | "warn" | "fail";
  errors: Finding[];
  warnings: Finding[];
  metrics: null | {
    viewport: { width: number; height: number };
    scroll: { width: number; height: number };
    bodyFontSize: number;
    h1FontSize: number | null;
  };
  diff: DiffResult | null;
  baselineExists: boolean;
};

type Manifest = {
  generatedAt: string;
  finishedAt: string;
  baseUrl: string;
  diffThresholdPct: number;
  breakpoints: Array<{ id: string; width: number; height: number; label: string; device: string }>;
  routes: Array<{ id: string; path: string; label: string }>;
  totals: { pass: number; fail: number; runs: number };
  runs: Run[];
};

export const Route = createFileRoute("/visual-qa")({
  head: () => ({
    meta: [
      { title: "Visual Regression — Fluid Typography QA" },
      {
        name: "description",
        content:
          "Automated visual-regression dashboard for fluid typography and spacing across 375px, 768px, and 1440px.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: VisualQADashboard,
});

function VisualQADashboard() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [previous, setPrevious] = useState<Manifest | null>(null);
  const [previousMissing, setPreviousMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "fail" | "warn" | "pass">("all");
  const [bpFilter, setBpFilter] = useState<"all" | "375" | "768" | "1440">("all");
  const [onlyNewFails, setOnlyNewFails] = useState(false);
  const [selected, setSelected] = useState<Run | null>(null);

  useMemo(() => {
    setLoading(true);
    const currentReq = fetch(`/visual-qa/manifest.json?ts=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m: Manifest) => {
        setManifest(m);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

    // Previous run is optional — the scripts/visual-regression.mjs runner
    // rotates the last manifest to /visual-qa/previous.json before writing
    // the new one. When it's missing (first ever run, or previous run
    // aborted) we surface that so the toggle can explain itself instead
    // of silently showing zero "new" failures.
    const previousReq = fetch(`/visual-qa/previous.json?ts=${Date.now()}`)
      .then((r) => {
        if (r.status === 404) {
          setPreviousMissing(true);
          setPrevious(null);
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json().then((m: Manifest) => {
          setPrevious(m);
          setPreviousMissing(false);
        });
      })
      .catch(() => {
        setPrevious(null);
        setPreviousMissing(true);
      });

    Promise.allSettled([currentReq, previousReq]).finally(() => setLoading(false));
  }, []);

  // Set of device×route keys that were failing in the previous run.
  // Key shape mirrors Run.key (routeId + breakpoint), so a route rename
  // or new breakpoint automatically counts as "new" — which is the
  // conservative signal we want on the dashboard.
  const previousFailKeys = useMemo(() => {
    const set = new Set<string>();
    if (!previous) return set;
    for (const r of previous.runs) if (r.status === "fail") set.add(r.key);
    return set;
  }, [previous]);

  const newFailCount = useMemo(() => {
    if (!manifest || !previous) return 0;
    return manifest.runs.filter((r) => r.status === "fail" && !previousFailKeys.has(r.key)).length;
  }, [manifest, previous, previousFailKeys]);

  // Disable the "new fails" toggle when there's nothing to compare against
  // so users don't wonder why the list is empty.
  const newFailsDisabled = !previous;

  const filtered = useMemo(() => {
    if (!manifest) return [] as Run[];
    return manifest.runs.filter((r) => {
      if (onlyNewFails) {
        if (r.status !== "fail") return false;
        if (previousFailKeys.has(r.key)) return false;
      }
      if (filter !== "all" && r.status !== filter) return false;
      if (bpFilter !== "all" && r.breakpoint !== bpFilter) return false;
      return true;
    });
  }, [manifest, filter, bpFilter, onlyNewFails, previousFailKeys]);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="container-fluid flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <p className="eyebrow">Visual Regression</p>
            <h1 className="truncate">Fluid Typography QA</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <SegBtn active={filter === "all"} onClick={() => setFilter("all")}>
              All
            </SegBtn>
            <SegBtn active={filter === "fail"} onClick={() => setFilter("fail")} tone="fail">
              Fail
            </SegBtn>
            <SegBtn active={filter === "warn"} onClick={() => setFilter("warn")} tone="warn">
              Warn
            </SegBtn>
            <SegBtn active={filter === "pass"} onClick={() => setFilter("pass")} tone="pass">
              Pass
            </SegBtn>
            <span className="mx-2 h-5 w-px bg-border" />
            {(["all", "375", "768", "1440"] as const).map((b) => (
              <SegBtn key={b} active={bpFilter === b} onClick={() => setBpFilter(b)}>
                {b === "all" ? "All widths" : `${b}px`}
              </SegBtn>
            ))}
            <span className="mx-2 h-5 w-px bg-border" />
            <button
              type="button"
              onClick={() => !newFailsDisabled && setOnlyNewFails((v) => !v)}
              disabled={newFailsDisabled}
              aria-pressed={onlyNewFails}
              title={
                newFailsDisabled
                  ? "No previous run to compare against — /visual-qa/previous.json is missing."
                  : "Show only device × route combinations that were passing/warning in the previous run and are failing now."
              }
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                newFailsDisabled
                  ? "cursor-not-allowed border-border bg-card text-muted-foreground opacity-60"
                  : onlyNewFails
                    ? "border-destructive bg-destructive text-destructive-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              New fails only
              {!newFailsDisabled && (
                <span className="ml-2 rounded-full bg-background/20 px-1.5 py-0.5 tabular-nums">
                  {newFailCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="container-fluid py-8">
        {loading && <p className="lead">Loading manifest…</p>}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
            <h2 className="text-lg text-destructive">Manifest not available</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Run the suite to generate <code>public/visual-qa/manifest.json</code>:
            </p>
            <pre className="mt-3">
              <code>node scripts/visual-regression.mjs</code>
            </pre>
            <p className="caption mt-3">Fetch error: {error}</p>
          </div>
        )}

        {manifest && (
          <>
            <section className="stack-base mb-8">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Total runs" value={manifest.totals.runs} />
                <StatCard label="Pass" value={manifest.totals.pass} tone="pass" />
                <StatCard label="Fail" value={manifest.totals.fail} tone="fail" />
                <StatCard
                  label="Diff budget"
                  value={`${manifest.diffThresholdPct}%`}
                  sub="per route"
                />
              </div>
              <p className="caption">
                Captured {new Date(manifest.finishedAt).toLocaleString()} against{" "}
                <code>{manifest.baseUrl}</code>
                {previous && (
                  <>
                    {" · "}Previous run {new Date(previous.finishedAt).toLocaleString()}
                  </>
                )}
                {previousMissing && (
                  <>
                    {" · "}No previous run on record — "New fails only" is unavailable until the
                    next run.
                  </>
                )}
              </p>
              {onlyNewFails && previous && (
                <p className="caption text-destructive">
                  Showing {newFailCount} device × route combination
                  {newFailCount === 1 ? "" : "s"} that started failing since the previous run.
                </p>
              )}
            </section>

            <section className="stack-loose">
              {groupBy(filtered, (r) => r.routeId).map((group) => (
                <RouteGroup
                  key={group.key}
                  runs={group.items}
                  onOpen={setSelected}
                  breakpoints={manifest.breakpoints}
                />
              ))}
              {filtered.length === 0 && (
                <p className="caption">No runs match the current filters.</p>
              )}
            </section>
          </>
        )}
      </main>

      {selected && <DiffModal run={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "pass" | "fail";
}) {
  const toneCls =
    tone === "pass" ? "text-primary" : tone === "fail" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="caption">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      {sub && <p className="caption mt-1">{sub}</p>}
    </div>
  );
}

function SegBtn({
  children,
  active,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tone?: "pass" | "fail" | "warn";
}) {
  const activeTone =
    tone === "fail"
      ? "bg-destructive text-destructive-foreground"
      : tone === "warn"
        ? "bg-warning text-warning-foreground"
        : tone === "pass"
          ? "bg-primary text-primary-foreground"
          : "bg-foreground text-background";
  return (
    <button
      onClick={onClick}
      className={`rounded-full border border-border px-3 py-1 text-xs font-medium transition ${
        active ? activeTone : "bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: Run["status"] }) {
  const map = {
    pass: "bg-primary/10 text-primary border-primary/30",
    warn: "bg-warning/10 text-warning-foreground border-warning/30",
    fail: "bg-destructive/10 text-destructive border-destructive/30",
  } as const;
  return <span className={`badge-pill border ${map[status]}`}>{status.toUpperCase()}</span>;
}

function RouteGroup({
  runs,
  onOpen,
  breakpoints,
}: {
  runs: Run[];
  onOpen: (r: Run) => void;
  breakpoints: Manifest["breakpoints"];
}) {
  const first = runs[0];
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate">{first.routeLabel}</h2>
          <p className="caption">
            <code>{first.route}</code>
          </p>
        </div>
        <div className="flex gap-1">
          {runs.map((r) => (
            <StatusBadge key={r.key} status={r.status} />
          ))}
        </div>
      </header>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {breakpoints.map((bp) => {
          const run = runs.find((r) => r.breakpoint === bp.id);
          if (!run) return null;
          return <ShotTile key={bp.id} run={run} onOpen={() => onOpen(run)} />;
        })}
      </div>
    </article>
  );
}

function ShotTile({ run, onOpen }: { run: Run; onOpen: () => void }) {
  const src = `/visual-qa/current/${run.key}.png?ts=${Date.now()}`;
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-background text-left transition hover:border-primary/50"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-muted">
        <img
          src={src}
          alt={`${run.routeLabel} at ${run.breakpointLabel}`}
          loading="lazy"
          className="h-full w-full object-cover object-top transition group-hover:scale-[1.01]"
        />
        <div className="absolute right-2 top-2">
          <StatusBadge status={run.status} />
        </div>
      </div>
      <div className="stack-tight p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{run.breakpointLabel}</span>
          {run.diff && run.diff.ok && (
            <span className="caption tabular-nums">Δ {run.diff.pct.toFixed(2)}%</span>
          )}
          {!run.baselineExists && <span className="caption">No baseline</span>}
        </div>
        {run.metrics && (
          <p className="caption">
            body {run.metrics.bodyFontSize.toFixed(1)}px
            {run.metrics.h1FontSize ? ` · h1 ${run.metrics.h1FontSize.toFixed(1)}px` : ""}
          </p>
        )}
        {(run.errors.length > 0 || run.warnings.length > 0) && (
          <p className="caption">
            {run.errors.length > 0 && (
              <span className="text-destructive">{run.errors.length} error</span>
            )}
            {run.errors.length > 0 && run.warnings.length > 0 && <span> · </span>}
            {run.warnings.length > 0 && (
              <span className="text-warning-foreground">{run.warnings.length} warn</span>
            )}
          </p>
        )}
      </div>
    </button>
  );
}

function DiffModal({ run, onClose }: { run: Run; onClose: () => void }) {
  const cur = `/visual-qa/current/${run.key}.png?ts=${Date.now()}`;
  const base = `/visual-qa/baseline/${run.key}.png?ts=${Date.now()}`;
  const diff = `/visual-qa/diff/${run.key}.png?ts=${Date.now()}`;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="max-h-[95svh] w-full max-w-6xl overflow-auto rounded-2xl border border-border bg-card p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Side-by-side · {run.breakpointLabel}</p>
            <h2 className="truncate">{run.routeLabel}</h2>
            <p className="caption">
              <code>{run.route}</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={run.status} />
            <button
              onClick={onClose}
              className="rounded-full border border-border px-3 py-1 text-sm"
            >
              Close
            </button>
          </div>
        </header>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <DiffPane
            title="Baseline"
            src={run.baselineExists ? base : null}
            empty="No baseline. Promote current to baseline once the look is approved."
          />
          <DiffPane title="Current" src={cur} />
          <DiffPane
            title="Pixel diff"
            src={run.baselineExists ? diff : null}
            empty="Diff appears once a baseline exists."
          />
        </div>

        {run.metrics && (
          <dl className="mt-5 grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-4">
            <Metric
              label="Viewport"
              value={`${run.metrics.viewport.width}×${run.metrics.viewport.height}`}
            />
            <Metric
              label="Scroll"
              value={`${run.metrics.scroll.width}×${run.metrics.scroll.height}`}
            />
            <Metric label="Body font" value={`${run.metrics.bodyFontSize.toFixed(2)}px`} />
            <Metric
              label="H1 font"
              value={run.metrics.h1FontSize ? `${run.metrics.h1FontSize.toFixed(2)}px` : "—"}
            />
          </dl>
        )}

        {(run.errors.length > 0 || run.warnings.length > 0) && (
          <section className="stack-tight mt-5">
            <h3 className="text-lg">Findings</h3>
            <ul className="stack-tight">
              {[...run.errors, ...run.warnings].map((f, i) => (
                <li
                  key={i}
                  className={`rounded-xl border p-3 text-sm ${
                    f.severity === "error"
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-warning/30 bg-warning/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-xs">{f.rule}</code>
                    <span className="caption uppercase">{f.severity}</span>
                  </div>
                  <p className="mt-1">{f.message}</p>
                  {f.detail != null && (
                    <pre className="mt-2 overflow-x-auto text-xs">
                      <code>{JSON.stringify(f.detail, null, 2)}</code>
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function DiffPane({ title, src, empty }: { title: string; src: string | null; empty?: string }) {
  return (
    <div className="stack-tight">
      <p className="caption uppercase">{title}</p>
      <div className="aspect-[4/5] overflow-hidden rounded-lg border border-border bg-muted">
        {src ? (
          <img src={src} alt={title} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center p-4 text-center">
            <p className="caption">{empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="caption">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function groupBy<T>(items: T[], key: (t: T) => string) {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = map.get(k) ?? [];
    arr.push(it);
    map.set(k, arr);
  }
  return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
}
