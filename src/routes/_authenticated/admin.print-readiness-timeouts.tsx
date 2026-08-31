import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Timer, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

import {
  DEFAULT_READINESS_TIMEOUTS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  STAGE_KEYS,
  getPrintReadinessTimeouts,
  updatePrintReadinessTimeouts,
  type PrintReadinessTimeouts,
  type StageKey,
} from "@/lib/adminPrintReadinessTimeouts.functions";

const QUERY_KEY = ["admin", "print-readiness-timeouts"] as const;

const STAGE_META: Record<StageKey, { title: string; hint: string }> = {
  fonts: {
    title: "Fonts",
    hint: "Time allowed for @font-face loads before the fonts stage times out.",
  },
  images: {
    title: "Images",
    hint: "Time allowed for letterhead, logos, and inline images to finish decoding.",
  },
  layout: {
    title: "Layout",
    hint: "Time allowed for the final layout/settle pass after fonts + images resolve.",
  },
};

function Page() {
  const { isSuperAdmin, loading } = useAuth();

  if (loading) return null;
  if (!isSuperAdmin) {
    return (
      <div>
        <PageHeader title="Print Readiness Timeouts" description="Restricted to Super Admins." />
        <AdminRequiredMessage action="Managing print readiness timeouts" />
      </div>
    );
  }

  return <TimeoutsEditor />;
}

function TimeoutsEditor() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getPrintReadinessTimeouts);
  const updateFn = useServerFn(updatePrintReadinessTimeouts);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchFn(),
    staleTime: 30_000,
  });

  const [draft, setDraft] = useState<PrintReadinessTimeouts>(DEFAULT_READINESS_TIMEOUTS);

  // Sync the draft when the server value loads or changes.
  useEffect(() => {
    if (data?.timeouts) setDraft(data.timeouts);
  }, [data?.timeouts]);

  const mutation = useMutation({
    mutationFn: (payload: PrintReadinessTimeouts) => updateFn({ data: payload }),
    onSuccess: (result) => {
      qc.setQueryData(QUERY_KEY, result);
      toast.success("Print readiness timeouts saved");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    },
  });

  const dirty = !!data && STAGE_KEYS.some((k) => draft[k] !== data.timeouts[k]);

  const invalidStage = STAGE_KEYS.find(
    (k) => !Number.isFinite(draft[k]) || draft[k] < MIN_TIMEOUT_MS || draft[k] > MAX_TIMEOUT_MS,
  );

  const total = STAGE_KEYS.reduce((sum, k) => sum + (draft[k] || 0), 0);
  const updatedAtLabel = data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : "never";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Print Readiness Timeouts"
        description="Configure per-stage limits used by the print preview readiness engine. Changes apply to every user immediately."
      />

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>Could not load current settings</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Stage Timeouts (ms)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              {STAGE_KEYS.map((k) => (
                <Skeleton key={k} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">
                Current source:{" "}
                <span className="font-medium">
                  {data?.usingDefaults ? "Built-in defaults" : "Saved config"}
                </span>
                {" · Last updated: "}
                <span className="font-medium">{updatedAtLabel}</span>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {STAGE_KEYS.map((key) => {
                  const meta = STAGE_META[key];
                  const value = draft[key];
                  const badValue =
                    !Number.isFinite(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS;
                  return (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`stage-${key}`}>{meta.title}</Label>
                      <Input
                        id={`stage-${key}`}
                        type="number"
                        min={MIN_TIMEOUT_MS}
                        max={MAX_TIMEOUT_MS}
                        step={100}
                        value={Number.isFinite(value) ? value : ""}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [key]: Number(e.target.value),
                          }))
                        }
                        aria-invalid={badValue}
                      />
                      <p className="text-xs text-muted-foreground">{meta.hint}</p>
                      <p className="text-xs">
                        Default:{" "}
                        <button
                          type="button"
                          className="underline text-primary"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              [key]: DEFAULT_READINESS_TIMEOUTS[key],
                            }))
                          }
                        >
                          {DEFAULT_READINESS_TIMEOUTS[key]} ms
                        </button>
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="text-sm text-muted-foreground">
                Total worst-case wait if every stage times out sequentially:{" "}
                <span className="font-medium">{total.toLocaleString()} ms</span> (≈{" "}
                {(total / 1000).toFixed(1)}s). Allowed range per stage: {MIN_TIMEOUT_MS}–
                {MAX_TIMEOUT_MS} ms.
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  onClick={() => mutation.mutate(draft)}
                  disabled={!dirty || !!invalidStage || mutation.isPending}
                  className="min-h-11"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {mutation.isPending ? "Saving…" : "Save changes"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => data?.timeouts && setDraft(data.timeouts)}
                  disabled={!dirty || mutation.isPending}
                  className="min-h-11"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Discard changes
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setDraft({ ...DEFAULT_READINESS_TIMEOUTS })}
                  disabled={mutation.isPending}
                  className="min-h-11"
                >
                  Reset to defaults
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => refetch()}
                  disabled={mutation.isPending}
                  className="min-h-11"
                >
                  Reload from server
                </Button>
              </div>

              {invalidStage && (
                <Alert variant="destructive">
                  <AlertTitle>Invalid value</AlertTitle>
                  <AlertDescription>
                    Stage “{STAGE_META[invalidStage].title}” must be between {MIN_TIMEOUT_MS} and{" "}
                    {MAX_TIMEOUT_MS} ms.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About these settings</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            The print preview runs three readiness stages before rendering:
            <strong> Fonts</strong>, <strong>Images</strong>, and <strong>Layout</strong>. Each
            stage times out independently — a slow letterhead image doesn't drag the fonts limit up
            with it.
          </p>
          <p>
            Raise a stage's timeout if you see frequent <em>timed out</em> attempts on the Attempts
            Timeline for that stage. Lower it to fail fast on broken assets in development.
          </p>
          <p>
            Stages themselves (Fonts / Images / Layout) are fixed by the readiness engine and cannot
            be added or removed here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/admin/print-readiness-timeouts")({
  ssr: false,
  component: Page,
  errorComponent: makeRouteErrorComponent("Print Readiness Timeouts"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Print Readiness Timeouts",
    backTo: "/admin",
  }),
  head: () => ({
    meta: [
      { title: "Print Readiness Timeouts · Admin Controls" },
      {
        name: "description",
        content: "Configure per-stage timeout limits for the print preview readiness engine.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
