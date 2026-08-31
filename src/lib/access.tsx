/**
 * Role-based UI/API access guards.
 *
 * Complements the RLS policies enforced in the database (is_writer on
 * clients / payments / installment_ledger / bookings / adjustments /
 * payment_comments / payment_allocations / dealers / app_settings /
 * audit_reviewed_issues). The database is the source of truth — these
 * guards exist so viewers:
 *   1. Never issue requests that will fail with 401/403 (saves round-trips
 *      + prevents scary error toasts on happy paths).
 *   2. See a friendly Access Denied state in place of PII surfaces.
 */
import type { ReactNode } from "react";
import { useQuery, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isPostgrestPermissionError } from "@/lib/postgrest-access";

/** Roles allowed to read/write PII-bearing tables. Mirrors the SQL
    `is_writer(uid)` security definer used by every restricted policy. */
export const WRITER_ROLES = ["admin", "manager", "staff"] as const;

/** `true` when the current session holds a role permitted to read
    client PII / financial rows. Wraps the existing `canWrite` flag so
    call sites read semantically (`canReadClientPII`) — the SQL policies
    happen to gate SELECT on the same predicate. */
export function useCanReadClientPII(): boolean {
  const { canWrite, loading } = useAuth();
  return !loading && canWrite;
}

/**
 * Wrapper around `useQuery` that automatically disables the fetch when
 * the current user lacks writer role. Prevents viewer sessions from
 * ever issuing a request that will be filtered/rejected by RLS. Returns
 * `data: undefined` with an `accessDenied: true` flag so components can
 * render a friendly empty state instead of a stale/loading spinner.
 *
 * Also flips `accessDenied: true` when the underlying query DOES fire
 * (writer role) but the response comes back as a PostgREST permission
 * error — e.g. a table with stricter row-level policies than the
 * catch-all writer predicate. That way the local UI matches the global
 * `<AccessDeniedBoundary>` in `src/lib/postgrest-access.tsx` and users
 * never see a raw error toast for an expected RLS refusal.
 */
export function usePIIGuardedQuery<TData, TError = Error>(
  options: UseQueryOptions<TData, TError>,
): UseQueryResult<TData, TError> & { accessDenied: boolean } {
  const canRead = useCanReadClientPII();
  const query = useQuery<TData, TError>({
    ...options,
    enabled: (options.enabled ?? true) && canRead,
    meta: { ...(options.meta ?? {}), piiSensitive: true },
  });
  const deniedByError = isPostgrestPermissionError(query.error, {
    treatZeroRowsAsDenied: true,
  });
  return { ...query, accessDenied: !canRead || deniedByError };
}

/**
 * Access denied surface. Shown in place of any PII panel/list when the
 * current session isn't allowed to read client PII. Consistent tone with
 * the rest of the iOS-themed dashboard: card surface, muted copy,
 * lock icon, no scary red — access control isn't an error, it's expected.
 */
export function AccessDenied({
  title = "Restricted view",
  description = "Client PII and financial records are only visible to admin, manager, and staff roles. Ask an administrator if you need access.",
  className,
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="access-denied"
      className={
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center " +
        (className ?? "")
      }
    >
      <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Lock className="h-5 w-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/**
 * Route/section guard. Renders `children` only when the session has
 * writer role; otherwise renders `<AccessDenied />` (or the supplied
 * fallback). Use around any panel, page section, or route subtree that
 * reads or displays PII.
 *
 * ```tsx
 * <RequireWriter>
 *   <ClientsTable />
 * </RequireWriter>
 * ```
 */
export function RequireWriter({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { canWrite, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs text-muted-foreground animate-pulse">Checking permissions…</span>
      </div>
    );
  }
  if (!canWrite) return <>{fallback ?? <AccessDenied />}</>;
  return <>{children}</>;
}
