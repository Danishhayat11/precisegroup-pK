/**
 * Global QueryClient error handler for PostgREST permission errors.
 *
 * When ANY React Query request (server or client) fails with a shape that
 * `isPostgrestPermissionError` recognises, we:
 *   1. Emit an event on `accessDeniedBus` so `<AccessDeniedBoundary>`
 *      subtrees on the current page can swap themselves for `<AccessDenied />`.
 *   2. Toast a single, friendly viewer-tone note (deduped per pathname so
 *      typing rapidly or refetching doesn't spam the user).
 *   3. Suppress the default "unhandled query error" console noise — it's
 *      not an error from the user's POV, it's expected access control.
 *
 * Opt-in for the zero-row RLS pattern:
 *   `useQuery({ queryKey, queryFn, meta: { piiSensitive: true } })`
 *   → `.single()` returning `PGRST116` is treated as denial. Without the
 *   flag, `PGRST116` stays a legitimate "no row yet".
 *
 * This module is imported by `src/router.tsx` and installs itself on the
 * QueryClient returned from `getRouter()`. It is a no-op on the server.
 */
import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { isPostgrestPermissionError, reportAccessDenied } from "./postgrest-access";
import { isRpcAuthorizationError, showRpcAuthorizationError } from "./rpc-error-toast";

/** Milliseconds within which we suppress duplicate toasts on the same path. */
const TOAST_DEDUPE_MS = 4000;
const lastToastByPath = new Map<string, number>();

function maybeToastOnce(pathname: string) {
  const now = Date.now();
  const last = lastToastByPath.get(pathname) ?? 0;
  if (now - last < TOAST_DEDUPE_MS) return;
  lastToastByPath.set(pathname, now);
  toast.message("Restricted view", {
    description: "Some data on this page is only visible to admin, manager, and staff roles.",
    duration: 4000,
  });
}

function queryKeyToString(key: readonly unknown[]): string {
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}

function handlePermissionError(
  error: unknown,
  sourceKey: string,
  opts: { treatZeroRowsAsDenied?: boolean },
): boolean {
  if (isRpcAuthorizationError(error)) {
    showRpcAuthorizationError(error);
    reportAccessDenied(sourceKey);
    return true;
  }
  if (!isPostgrestPermissionError(error, opts)) return false;
  reportAccessDenied(sourceKey);
  const pathname = typeof window !== "undefined" ? (window.location?.pathname ?? "") : "";
  maybeToastOnce(pathname);
  return true;
}

/**
 * Builds a QueryClient wired with PostgREST-permission-aware caches. Called
 * once per request in `getRouter()` so the handler is scoped to the router
 * lifecycle (fresh QueryClient per SSR request, single client per browser).
 */
export function createQueryClientWithAccessHandler(): QueryClient {
  const queryCache = new QueryCache({
    onError: (error: unknown, query) => {
      const treatZeroRowsAsDenied =
        (query.meta as { piiSensitive?: boolean } | undefined)?.piiSensitive === true;
      handlePermissionError(error, queryKeyToString(query.queryKey), {
        treatZeroRowsAsDenied,
      });
    },
  });

  const mutationCache = new MutationCache({
    onError: (error: unknown, _vars, _ctx, mutation) => {
      const key = mutation.options.mutationKey
        ? queryKeyToString(mutation.options.mutationKey)
        : "mutation";
      handlePermissionError(error, key, { treatZeroRowsAsDenied: false });
    },
  });

  return new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: {
      queries: {
        // Retrying a 403 is wasted work — the RLS answer isn't going to
        // change on the next attempt. Let the global handler classify and
        // let TanStack Query stop.
        retry: (failureCount, error) => {
          if (isRpcAuthorizationError(error)) return false;
          if (isPostgrestPermissionError(error)) return false;
          return failureCount < 2;
        },
      },
    },
  });
}
