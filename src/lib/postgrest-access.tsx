/**
 * Global handler for PostgREST permission errors.
 *
 * The database is the source of truth for who can read what (RLS). When a
 * viewer session issues a request that RLS rejects, PostgREST returns one
 * of a small, well-known error shapes. We classify those here and expose:
 *
 *   • `isPostgrestPermissionError(err)` — a pure predicate used by both the
 *     global QueryCache handler (see `src/lib/query-error-handler.ts`) and
 *     by `usePIIGuardedQuery` (see `src/lib/access.tsx`).
 *
 *   • `accessDeniedBus` — a tiny EventTarget that the global handler fires
 *     when a permission error is observed. UI surfaces subscribe via
 *     `useAccessDeniedFlag()` and swap themselves for `<AccessDenied />`.
 *
 *   • `<AccessDeniedBoundary>` — page-level opt-in wrapper: renders its
 *     children until a permission error fires under the current pathname,
 *     then renders `<AccessDenied />` in place of the whole subtree.
 *
 * Design constraints:
 *   • Zero coupling to individual pages — one wrap or nothing at all
 *     (individual `usePIIGuardedQuery` sites already surface AccessDenied
 *     locally; this module adds the *global* net for direct `supabase.from()`
 *     calls that never went through the guard).
 *   • Pathname-scoped: navigating to a new page clears the flag so a
 *     one-off 403 on the previous route doesn't poison the next one.
 *   • Reduced-motion / a11y respected — `<AccessDenied />` already carries
 *     `role="status"` + `aria-live="polite"`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "@/lib/router-compat";
import { AccessDenied } from "@/lib/access";

/* ─── Error classification ─────────────────────────────────────────── */

/**
 * PostgREST-specific permission error codes we treat as "viewer hit RLS".
 *   • `42501`   — Postgres SQL "insufficient_privilege"
 *   • `PGRST301` — JWT expired / invalid (auth) → still a permission fail
 *   • `PGRST302` — anonymous role blocked from resource
 *   • `PGRST116` — "0 rows returned" for a `.single()` call, which is the
 *     canonical way RLS-filtered SELECTs look to the client (row is present
 *     in the table but the policy filtered it out). We treat this as a
 *     permission signal ONLY when the caller opts in via the query `meta`
 *     flag `piiSensitive: true` — a plain 0-row fetch on a non-PII table is
 *     legitimate "no data yet", not access denial.
 */
const PGRST_PERMISSION_CODES = new Set(["42501", "PGRST301", "PGRST302"]);
const PGRST_ZERO_ROW_CODE = "PGRST116";

type MaybePostgrestError = {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
  hint?: unknown;
};

/** Narrow, dependency-free check — works for `PostgrestError` instances,
 *  plain thrown objects from `supabase.from()`, and `Response`-shaped errors. */
export function isPostgrestPermissionError(
  err: unknown,
  opts: { treatZeroRowsAsDenied?: boolean } = {},
): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as MaybePostgrestError;

  const status = Number(e.status ?? e.statusCode);
  if (status === 401 || status === 403) return true;

  const code = typeof e.code === "string" ? e.code : "";
  if (PGRST_PERMISSION_CODES.has(code)) return true;

  if (opts.treatZeroRowsAsDenied && code === PGRST_ZERO_ROW_CODE) return true;

  // Some supabase-js versions surface the message without a code on JWT
  // failures. Match defensively but conservatively.
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (
    message.includes("permission denied") ||
    message.includes("row-level security") ||
    message.includes("row level security") ||
    message.includes("jwt expired") ||
    message.includes("jwt is invalid")
  ) {
    return true;
  }

  return false;
}

/* ─── Global bus ───────────────────────────────────────────────────── */

/** Payload emitted with every `access-denied` event. `pathname` scopes
 *  the flag so it clears on navigation; `sourceKey` is a stable string
 *  (query key, table name, or request URL) used only for de-duplication. */
export interface AccessDeniedEventDetail {
  pathname: string;
  sourceKey: string;
}

class AccessDeniedBus extends EventTarget {
  emit(detail: AccessDeniedEventDetail) {
    this.dispatchEvent(new CustomEvent("access-denied", { detail }));
  }
  subscribe(handler: (detail: AccessDeniedEventDetail) => void): () => void {
    const listener = (e: Event) => handler((e as CustomEvent<AccessDeniedEventDetail>).detail);
    this.addEventListener("access-denied", listener);
    return () => this.removeEventListener("access-denied", listener);
  }
}

/** Singleton — safe to import from non-React modules (QueryCache handler). */
export const accessDeniedBus = new AccessDeniedBus();

/** Report a permission error to the global bus. Safe on server (no-op if
 *  `window` is missing — the bus itself lives on the module singleton). */
export function reportAccessDenied(sourceKey: string) {
  const pathname = typeof window !== "undefined" ? (window.location?.pathname ?? "") : "";
  accessDeniedBus.emit({ pathname, sourceKey });
}

/* ─── React hook + boundary ────────────────────────────────────────── */

/**
 * Returns `true` once any PostgREST permission error has fired under the
 * current pathname. Automatically resets when the user navigates.
 */
export function useAccessDeniedFlag(): boolean {
  const location = useLocation();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    // New route — start clean.
    setDenied(false);
    const unsub = accessDeniedBus.subscribe((detail) => {
      if (detail.pathname === location.pathname) setDenied(true);
    });
    return unsub;
  }, [location.pathname]);

  return denied;
}

/**
 * Page-level opt-in wrapper: renders `children` normally, but swaps in
 * `<AccessDenied />` the instant a PostgREST permission error is observed
 * anywhere in the subtree (or in any direct `supabase.from()` call the
 * global QueryCache handler intercepts). One wrap covers the whole page.
 *
 * ```tsx
 * export default function BookingsPage() {
 *   return (
 *     <AccessDeniedBoundary>
 *       <BookingsList />
 *     </AccessDeniedBoundary>
 *   );
 * }
 * ```
 */
export function AccessDeniedBoundary({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const denied = useAccessDeniedFlag();
  if (denied) return <>{fallback ?? <AccessDenied />}</>;
  return <>{children}</>;
}
