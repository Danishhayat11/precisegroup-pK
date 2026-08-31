/**
 * Lightweight client-side diagnostics for the dashboard.
 *
 * - Always logs to the browser console with a stable `[dashboard]` prefix so
 *   entries are easy to grep in production reports.
 * - Emits a `CustomEvent("dashboard:diagnostic", { detail })` on `window` so
 *   external monitors (Datadog RUM, LogRocket, etc.) can subscribe without
 *   pulling in a hard dependency.
 * - If Sentry is present on `window` (loaded via a <script> tag or optional
 *   dependency), forwards to `Sentry.addBreadcrumb` and `Sentry.captureException`
 *   — but never imports `@sentry/browser` directly, so bundles stay lean.
 * - Every event and error is enriched with a snapshot of client + route
 *   context (URL, pathname, search, referrer, viewport, user agent,
 *   stable session id) so a single Sentry issue / log line contains
 *   everything needed to reproduce the failure.
 */

type Level = "info" | "warning" | "error";

type BreadcrumbPayload = {
  category: string;
  message: string;
  level?: Level;
  data?: Record<string, unknown>;
};

type SentryLike = {
  addBreadcrumb?: (b: BreadcrumbPayload) => void;
  captureException?: (
    err: unknown,
    ctx?: { extra?: Record<string, unknown>; tags?: Record<string, string> },
  ) => void;
  captureMessage?: (msg: string, level?: Level) => void;
  setContext?: (name: string, ctx: Record<string, unknown>) => void;
};

/**
 * Runtime toggle for Sentry breadcrumbs + captureException/captureMessage.
 *
 * Resolution order (highest priority wins):
 *   1. `setDashboardSentryEnabled(bool)` — imperative override for tests /
 *      admin UI toggles. Cleared with `setDashboardSentryEnabled(null)`.
 *   2. `window.localStorage["precise.dashboardSentry"]` — `"on"` / `"off"`,
 *      lets ops flip Sentry per-browser without a redeploy.
 *   3. `import.meta.env.VITE_DASHBOARD_SENTRY` — build-time default,
 *      `"off"` / `"false"` / `"0"` disables. Anything else (or unset)
 *      leaves Sentry ENABLED.
 *
 * When disabled, console + `CustomEvent` diagnostics still fire — only the
 * Sentry forwarding is short-circuited so cost / PII controls are respected.
 */
const SENTRY_LS_KEY = "precise.dashboardSentry";
let sentryRuntimeOverride: boolean | null = null;

function parseFlag(raw: string | undefined | null): boolean | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === "off" || v === "false" || v === "0" || v === "no") return false;
  if (v === "on" || v === "true" || v === "1" || v === "yes") return true;
  return null;
}

export function isDashboardSentryEnabled(): boolean {
  if (sentryRuntimeOverride !== null) return sentryRuntimeOverride;
  if (typeof window !== "undefined") {
    try {
      const stored = parseFlag(window.localStorage.getItem(SENTRY_LS_KEY));
      if (stored !== null) return stored;
    } catch {
      /* localStorage unavailable — fall through */
    }
  }
  const envFlag = parseFlag(
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_DASHBOARD_SENTRY,
  );
  if (envFlag !== null) return envFlag;
  return true;
}

/**
 * Programmatic override. Pass `true`/`false` to force, or `null` to fall
 * back to localStorage + env resolution. Persisted for the tab lifetime.
 */
export function setDashboardSentryEnabled(enabled: boolean | null) {
  sentryRuntimeOverride = enabled;
  if (typeof window !== "undefined") {
    try {
      if (enabled === null) window.localStorage.removeItem(SENTRY_LS_KEY);
      else window.localStorage.setItem(SENTRY_LS_KEY, enabled ? "on" : "off");
    } catch {
      /* ignore */
    }
  }
}

function getSentry(): SentryLike | undefined {
  if (typeof window === "undefined") return undefined;
  if (!isDashboardSentryEnabled()) return undefined;
  return (window as unknown as { Sentry?: SentryLike }).Sentry;
}

function emitEvent(detail: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("dashboard:diagnostic", { detail }));
  } catch {
    /* ignore — CustomEvent unsupported */
  }
}

function nowIso() {
  return new Date().toISOString();
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

/**
 * Per-tab session id — stable for the lifetime of the tab, so multiple
 * events from the same user session can be correlated in monitoring tools.
 */
const SESSION_STORAGE_KEY = "precise.dashboardSessionId";
function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return "unavailable";
  }
}

export type RouteContext = {
  href: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  referrer: string;
  userAgent: string;
  language: string;
  viewport: { w: number; h: number; dpr: number } | null;
  online: boolean | null;
  sessionId: string;
  timestamp: string;
};

/**
 * Snapshot the browser + route state at the moment of an event. Attached
 * to every log/error payload so monitors can pinpoint which URL and client
 * produced the failure without needing extra breadcrumbs.
 */
export function collectRouteContext(): RouteContext {
  const t = nowIso();
  if (typeof window === "undefined") {
    return {
      href: "",
      origin: "",
      pathname: "",
      search: "",
      hash: "",
      referrer: "",
      userAgent: "ssr",
      language: "",
      viewport: null,
      online: null,
      sessionId: "ssr",
      timestamp: t,
    };
  }
  const loc = window.location;
  return {
    href: loc.href,
    origin: loc.origin,
    pathname: loc.pathname,
    search: loc.search,
    hash: loc.hash,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
    online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
    sessionId: getSessionId(),
    timestamp: t,
  };
}

export function logDashboardEvent(
  event: string,
  data?: Record<string, unknown>,
  level: Level = "info",
) {
  const route = collectRouteContext();
  const payload = { event, level, at: route.timestamp, route, ...(data ?? {}) };
  const prefix = `[dashboard] ${event}`;

  const fn = level === "error" ? console.error : level === "warning" ? console.warn : console.info;
  fn(prefix, payload);

  emitEvent(payload);

  const sentry = getSentry();
  sentry?.addBreadcrumb?.({
    category: "dashboard",
    message: event,
    level,
    data: payload,
  });
}

export function reportDashboardError(event: string, err: unknown, extra?: Record<string, unknown>) {
  const serialized = serializeError(err);
  const route = collectRouteContext();
  const payload = {
    event,
    level: "error" as const,
    at: route.timestamp,
    route,
    ...serialized,
    ...(extra ?? {}),
  };

  console.error(`[dashboard] ${event}`, payload);

  emitEvent(payload);

  const sentry = getSentry();
  // Attach the route context as a named Sentry context so it shows as its own
  // panel on the issue page in addition to being in `extra`.
  sentry?.setContext?.("dashboard_route", route);
  if (sentry?.captureException) {
    sentry.captureException(err, {
      extra: payload,
      tags: {
        surface: "dashboard",
        event,
        pathname: route.pathname || "unknown",
      },
    });
  } else {
    sentry?.captureMessage?.(`[dashboard] ${event}: ${serialized.message ?? String(err)}`, "error");
  }
}

/**
 * Latency budget for the dashboard's `payments` fetch, in milliseconds.
 *
 * Chosen from p95 observations of `fetchAllRows("payments", ...)` on a full
 * seeded dataset over a warm connection. Anything above this points at a
 * regression (missing index, N+1, oversized select, cold cache) worth
 * paging on rather than silently degrading dashboard UX.
 *
 * Overridable per-environment via `VITE_DASHBOARD_PAYMENTS_LATENCY_BUDGET_MS`
 * so staging / low-spec CI can loosen the bar without a code change.
 */
export const DEFAULT_PAYMENTS_LATENCY_BUDGET_MS = 1500;

export function getPaymentsLatencyBudgetMs(): number {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_DASHBOARD_PAYMENTS_LATENCY_BUDGET_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PAYMENTS_LATENCY_BUDGET_MS;
}

export type PaymentsLatencyResult = {
  ok: boolean;
  ms: number;
  budgetMs: number;
  reason?: "missing" | "invalid" | "exceeded";
};

/**
 * Pure evaluator — takes a measured duration and returns whether it fits the
 * configured budget. Kept side-effect-free so tests can assert the boundary
 * without touching `window` / `console` / Sentry.
 */
export function evaluatePaymentsLatency(
  ms: number | null | undefined,
  budgetMs: number = getPaymentsLatencyBudgetMs(),
): PaymentsLatencyResult {
  if (ms == null) return { ok: false, ms: NaN, budgetMs, reason: "missing" };
  if (!Number.isFinite(ms) || ms < 0) {
    return { ok: false, ms: Number(ms), budgetMs, reason: "invalid" };
  }
  if (ms > budgetMs) return { ok: false, ms, budgetMs, reason: "exceeded" };
  return { ok: true, ms, budgetMs };
}

/**
 * Emits a `payments_slow` diagnostic when the measured payments-query
 * latency exceeds the configured budget. Returns the evaluation so callers
 * can branch (e.g. surface a toast to admins in dev).
 */
export function trackPaymentsLatency(
  ms: number | null | undefined,
  extra?: Record<string, unknown>,
): PaymentsLatencyResult {
  const result = evaluatePaymentsLatency(ms);
  if (!result.ok && result.reason === "exceeded") {
    logDashboardEvent(
      "payments_slow",
      { durationMs: result.ms, budgetMs: result.budgetMs, ...(extra ?? {}) },
      "warning",
    );
  }
  return result;
}
