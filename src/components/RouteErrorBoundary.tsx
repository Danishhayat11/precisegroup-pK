import { useEffect } from "react";
import { useRouter, Link } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, Home, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { getOrCreateErrorId } from "@/lib/error-id";
import { ErrorRef } from "@/components/ErrorRef";

interface RouteErrorProps {
  error: Error;
  reset: () => void;
  /** Human-friendly route label, e.g. "Payments". */
  routeLabel?: string;
  /** Boundary tag for lovable-error-reporting. */
  boundary?: string;
}

/**
 * Standard error UI for authenticated data-driven routes.
 *
 * Uses router.invalidate() + reset() (per TanStack guidance) so retry
 * re-runs the loader / re-fetches queries instead of just clearing the
 * boundary. Also reports the error to Lovable so it surfaces in the
 * error dashboard.
 */
export function RouteErrorBoundary({
  error,
  reset,
  routeLabel,
  boundary = "route_error_component",
}: RouteErrorProps) {
  const router = useRouter();
  const errorId = getOrCreateErrorId(error);

  useEffect(() => {
    console.error(`[${boundary}]`, error);
    reportLovableError(error, { boundary, routeLabel });
  }, [error, boundary, routeLabel]);

  // If the error is Unauthorized, we should redirect to login.
  // TanStack Router might not handle this automatically if the loader didn't redirect.
  useEffect(() => {
    if (error.message === "Unauthorized") {
      void router.navigate({
        to: "/login" as any,
        search: { next: window.location.pathname } as any,
      });
    }
  }, [error, router]);

  const retry = () => {
    router.invalidate();
    reset();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-destructive/15 p-3 text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground">
              {routeLabel ? `${routeLabel} couldn't load` : "This page couldn't load"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Something went wrong while fetching data. You can retry, or head back to the
              dashboard.
            </p>
            {error?.message && (
              <p
                className="mt-3 rounded-md border border-destructive/30 bg-background/50 px-3 py-2 font-mono text-xs text-destructive break-words"
                aria-live="polite"
              >
                {error.message}
              </p>
            )}
            <ErrorRef id={errorId} />
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={retry} size="sm" className="gap-2">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try again
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-2">
                <Link to="/">
                  <Home className="h-4 w-4" aria-hidden="true" />
                  Back to Dashboard
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RouteNotFoundProps {
  /** Human-friendly resource label, e.g. "Booking". */
  resourceLabel?: string;
  /** Optional identifier (id / slug) to include in the message. */
  identifier?: string;
  /** Path to a sensible "back to list" destination. */
  backTo?: string;
  backLabel?: string;
}

/**
 * Standard not-found UI for authenticated resource routes.
 */
export function RouteNotFound({
  resourceLabel = "Resource",
  identifier,
  backTo = "/",
  backLabel = "Back to Dashboard",
}: RouteNotFoundProps) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-muted p-3 text-muted-foreground">
            <FileQuestion className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">{resourceLabel} not found</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {identifier ? (
                <>
                  We couldn't find <span className="font-mono text-foreground">{identifier}</span>.
                  It may have been deleted or you may not have access.
                </>
              ) : (
                "We couldn't find what you were looking for."
              )}
            </p>
            <div className="mt-5">
              <Button asChild variant="outline" size="sm" className="gap-2">
                <Link to={backTo as any}>
                  <Home className="h-4 w-4" aria-hidden="true" />
                  {backLabel}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Factory: build a bound error component so route configs stay one-line.
 *
 *   errorComponent: makeRouteErrorComponent("Payments")
 */
export function makeRouteErrorComponent(routeLabel: string, boundary?: string) {
  return function BoundRouteError(props: { error: Error; reset: () => void }) {
    return (
      <RouteErrorBoundary
        {...props}
        routeLabel={routeLabel}
        boundary={boundary ?? `route:${routeLabel.toLowerCase().replace(/\s+/g, "-")}`}
      />
    );
  };
}

/**
 * Factory: build a bound not-found component.
 */
export function makeRouteNotFoundComponent(opts: RouteNotFoundProps) {
  return function BoundRouteNotFound() {
    return <RouteNotFound {...opts} />;
  };
}
