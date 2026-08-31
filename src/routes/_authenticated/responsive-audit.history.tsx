import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/EmptyState";
import { AlertTriangle, ArrowLeft, Check, GitCompare, RotateCcw } from "lucide-react";

/**
 * Responsive audit run history.
 *
 * Lists every archived run under `public/responsive-audit/history/` and
 * lets the user pin any prior run as the comparison baseline for the main
 * audit page. Selection is persisted in localStorage so the audit page
 * reads it and diffs the current run against the chosen manifest.
 */

export const BASELINE_STORAGE_KEY = "responsive-audit:baseline-run-id";

type HistoryEntry = {
  id: string;
  generatedAt: string;
  baseUrl: string;
  count: number;
  totals: { ok: number; overflow: number; skipped: number; error: number };
};
type HistoryIndex = { generatedAt: string; runs: HistoryEntry[] };

export const Route = createFileRoute("/_authenticated/responsive-audit/history")({
  ssr: false,
  component: ResponsiveAuditHistoryPage,
  head: () => ({
    meta: [
      { title: "Responsive Audit — Run History" },
      { name: "robots", content: "noindex,nofollow" },
      {
        name: "description",
        content:
          "Prior responsive audit runs — load any past manifest as the comparison baseline for the current run.",
      },
    ],
  }),
});

function ResponsiveAuditHistoryPage() {
  const { data, isLoading, isError, error } = useQuery<HistoryIndex>({
    queryKey: ["responsive-audit-history-index"],
    queryFn: async () => {
      const res = await fetch(`/responsive-audit/history/index.json?ts=${Date.now()}`);
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "No run history yet. Run `node scripts/run-responsive-audit.mjs` at least once to record a run."
            : `Failed to load history (${res.status})`,
        );
      }
      return (await res.json()) as HistoryIndex;
    },
    retry: false,
    staleTime: 30_000,
  });

  const [baselineId, setBaselineId] = useState<string | null>(null);
  useEffect(() => {
    setBaselineId(window.localStorage.getItem(BASELINE_STORAGE_KEY));
  }, []);

  const setBaseline = (id: string | null) => {
    if (id) window.localStorage.setItem(BASELINE_STORAGE_KEY, id);
    else window.localStorage.removeItem(BASELINE_STORAGE_KEY);
    setBaselineId(id);
    // Notify the audit page (same-tab listeners) that the baseline changed.
    window.dispatchEvent(new StorageEvent("storage", { key: BASELINE_STORAGE_KEY, newValue: id }));
  };

  const runs = data?.runs ?? [];
  const currentRunId = runs[0]?.id ?? null;

  return (
    <div className="container mx-auto px-4 py-8">
      <PageHeader
        title="Run History"
        description="Every archived responsive-audit run. Load any past manifest as the comparison baseline for the current run."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/responsive-audit">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to audit
              </Link>
            </Button>
            {baselineId && (
              <Button variant="ghost" size="sm" onClick={() => setBaseline(null)}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset baseline
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-muted-foreground">Loading run history…</p>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>History unavailable</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Unknown error."}
          </AlertDescription>
        </Alert>
      ) : runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Run `node scripts/run-responsive-audit.mjs` to record the first run."
        />
      ) : (
        <div className="grid gap-3">
          {runs.map((run, idx) => {
            const isBaseline = run.id === baselineId;
            const isCurrent = run.id === currentRunId;
            return (
              <Card
                key={run.id}
                className={isBaseline ? "border-primary/60 ring-1 ring-primary/30" : ""}
              >
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <span>{new Date(run.generatedAt).toLocaleString()}</span>
                      {isCurrent && (
                        <Badge variant="secondary" className="text-[10px]">
                          Latest
                        </Badge>
                      )}
                      {isBaseline && (
                        <Badge className="gap-1 text-[10px]">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          Baseline
                        </Badge>
                      )}
                      {idx === 1 && !baselineId && (
                        <Badge variant="outline" className="text-[10px]">
                          Default previous
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      <span className="font-mono">{run.id}</span> · {run.baseUrl} · {run.count} row
                      {run.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {run.totals.overflow > 0 && (
                      <Badge variant="destructive" className="text-[11px]">
                        {run.totals.overflow} overflow
                      </Badge>
                    )}
                    {run.totals.error > 0 && (
                      <Badge variant="destructive" className="text-[11px]">
                        {run.totals.error} error
                      </Badge>
                    )}
                    {run.totals.skipped > 0 && (
                      <Badge variant="outline" className="text-[11px]">
                        {run.totals.skipped} skipped
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[11px]">
                      {run.totals.ok} ok
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-end gap-2 pt-0">
                  {isBaseline ? (
                    <Button size="sm" variant="outline" onClick={() => setBaseline(null)}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Clear baseline
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => setBaseline(run.id)}
                      disabled={isCurrent}
                      title={
                        isCurrent
                          ? "This is the current run — pick an earlier run to compare against."
                          : "Use this run as the comparison baseline"
                      }
                    >
                      <GitCompare className="mr-2 h-4 w-4" />
                      Load as baseline
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
