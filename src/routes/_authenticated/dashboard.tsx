import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import Dashboard from "@/pages/Dashboard";
import { DashboardErrorBoundary } from "@/components/DashboardErrorBoundary";
import { logDashboardEvent, reportDashboardError } from "@/lib/dashboardDiagnostics";
import { SITE_BASE_URL, DEFAULT_OG_IMAGE } from "@/lib/site-seo";

/**
 * Retry action shared by the error boundary and the route-level error
 * component. Instead of a full page reload, it:
 *   1. Invalidates the "dashboard" query so the next mount refetches from
 *      Supabase (bookings, payments, ledger, adjustments, units, projects).
 *   2. Runs `refetchQueries` so any currently mounted subscriber (drill-downs,
 *      derived checks) re-runs immediately without waiting for a remount.
 *
 * Returning a Promise lets the boundary show a "Retrying…" state until the
 * refetch resolves, and lets the router error component await it before
 * re-running loaders via `router.invalidate()`.
 */
function useDashboardRetry() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.refetchQueries({
      queryKey: ["dashboard"],
      type: "active",
    });
  }, [queryClient]);
}

function DashboardRoute() {
  const retry = useDashboardRetry();
  return (
    <DashboardErrorBoundary onRetry={retry}>
      <Dashboard />
    </DashboardErrorBoundary>
  );
}

function DashboardRouteErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const retry = useDashboardRetry();
  const router = useRouter();

  // Route-level failure — fires when a loader throws or when the boundary
  // itself catches an error that bubbled past the in-tree boundary. Report
  // with full stack + route context so it lands in Sentry as a distinct
  // event separate from React render errors.
  useEffect(() => {
    reportDashboardError("route_error_boundary", error, {
      routeId: "/_authenticated/dashboard",
      boundary: "route",
    });
  }, [error]);

  const handleRetry = async () => {
    logDashboardEvent("route_error_retry", { routeId: "/_authenticated/dashboard" });
    await retry();
    await router.invalidate();
    reset();
  };
  const handleGoBack = () => {
    if (typeof window === "undefined") return;
    if (window.history.length > 1) window.history.back();
    else router.navigate({ to: "/dashboard" });
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mx-auto my-8 max-w-2xl rounded-xl border border-destructive/30 bg-destructive/5 p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-foreground">We couldn't open the dashboard</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The page failed to load, but your data is safe. Try again, head back to where you were, or
        return to the home screen.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          Show technical details
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 text-xs text-muted-foreground">
          {error?.message ?? "An unexpected error occurred."}
        </pre>
      </details>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={handleGoBack}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Go back
        </button>
        <button
          type="button"
          onClick={() => router.navigate({ to: "/dashboard" })}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Home
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardRoute,
  errorComponent: DashboardRouteErrorFallback,
  head: () => ({
    meta: [
      { title: "Dashboard — Precise ERP" },
      {
        name: "description",
        content:
          "Live overview of bookings, payments, adjustments, and overdue receivables across Precise Realtors & Builders projects.",
      },
      { property: "og:title", content: "Dashboard — Precise ERP" },
      {
        property: "og:description",
        content: "Operations dashboard for Precise Realtors & Builders.",
      },
      { property: "og:url", content: `${SITE_BASE_URL}/dashboard` },
      { property: "og:type", content: "website" },
      { property: "og:image", content: DEFAULT_OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Dashboard — Precise ERP" },
      {
        name: "twitter:description",
        content: "Operations dashboard for Precise Realtors & Builders.",
      },
      { name: "twitter:image", content: DEFAULT_OG_IMAGE },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: `${SITE_BASE_URL}/dashboard` }],
  }),
});
