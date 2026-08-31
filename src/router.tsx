import { createQueryClientWithAccessHandler } from "./lib/query-error-handler";
import { createRouter, Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { routeTree } from "./routeTree.gen";
import { useAutoRetry } from "./lib/useAutoRetry";
import { getOrCreateErrorId } from "./lib/error-id";
import { ErrorRef } from "./components/ErrorRef";
import { PendingSurface } from "./components/motion/PendingSurface";
import { installHmrRecovery } from "./lib/dev-hmr-recovery";

// Dev-only: auto-reload once when a transient HMR module-load failure
// (typically `routeTree.gen.ts` mid-regeneration) leaves the browser
// with a 500. No-op in production. Idempotent across HMR re-runs.
installHmrRecovery();

// Minimal, provider-free fallbacks for routes that don't define their own
// errorComponent / notFoundComponent. The root route also defines branded
// versions; these run only as belt-and-braces when an error escapes a route
// that lacks its own boundary or fires before the root error boundary mounts.
function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  // Surface the raw Error (with .stack) so Server Logs capture it.
  console.error(error);
  const router = useRouter();
  const auto = useAutoRetry({
    onRetry: () => {
      router.invalidate();
      reset();
    },
    resetKey: error,
  });
  const errorId = getOrCreateErrorId(error);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred while loading this page.
        </p>
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
          {auto.exhausted
            ? `Couldn't recover after ${auto.attempt} attempts.`
            : auto.isRetrying
              ? `Retrying now (attempt ${auto.attempt + 1})…`
              : `Retrying automatically in ${auto.secondsUntilRetry}s (attempt ${auto.attempt + 1})…`}
        </p>
        <ErrorRef id={errorId} />
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={auto.retryNow}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function DefaultNotFoundComponent() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const shouldRedirectToLogin = pathname === "/superadmin";
  useEffect(() => {
    if (!shouldRedirectToLogin) return;
    void router.navigate({
      to: "/login" as never,
      search: { next: pathname } as never,
      replace: true,
    });
  }, [pathname, router, shouldRedirectToLogin]);

  // Some not-founds are transient (race with a just-created route, stale
  // route tree after a deploy). Retry the route once or twice quietly; if it
  // still doesn't match, the user sees the normal 404.
  const auto = useAutoRetry({
    onRetry: () => router.invalidate(),
    resetKey: pathname,
    maxAttempts: 2,
    baseMs: 1500,
  });

  if (shouldRedirectToLogin) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center bg-background px-4"
        role="status"
        aria-live="polite"
      >
        <div className="max-w-md text-center text-sm text-muted-foreground">
          Redirecting to sign in…
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-bold text-foreground">404</h1>
        <h2 className="mt-4 font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        {!auto.exhausted && (
          <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
            {auto.isRetrying ? "Checking again…" : `Re-checking in ${auto.secondsUntilRetry}s…`}
          </p>
        )}
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = createQueryClientWithAccessHandler();

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Prefetch a route's lazy chunk (and loader) on hover / focus / touchstart
    // of any <Link> pointing at it. This warms the DrillDowns bundle behind
    // every /reports/* route so navigation feels instant.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: DefaultNotFoundComponent,
    // Editorial noir-and-gold pending surface for every loader that pends
    // past `pendingMs`. Individual routes can still override.
    defaultPendingComponent: PendingSurface,
    defaultPendingMs: 250,
    defaultPendingMinMs: 500,
  });
};
