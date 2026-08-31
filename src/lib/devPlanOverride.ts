/**
 * Dev-only plan override — `?forcePlan=starter|professional|builder`.
 *
 * Why this exists
 * ---------------
 * The subscription tier drives which routes render and which surfaces
 * show the upgrade modal (see `UpgradeGate`, `PlanGate`, and every
 * consumer of `useAuth().plan`). Manually flipping the tier in the
 * database to preview an upgrade prompt is slow, error-prone, and
 * pollutes real tenant data. This module lets a developer override
 * the current company's plan for the running preview session via a
 * URL query parameter:
 *
 *   ?forcePlan=starter        → treat the current user as Starter
 *   ?forcePlan=professional   → treat the current user as Professional
 *   ?forcePlan=builder        → treat the current user as Builder
 *   ?forcePlan=off            → clear the override (also: `clear`, empty)
 *
 * The override:
 *   • is stripped from production bundles (`import.meta.env.DEV` gate);
 *   • persists across in-app navigation via `sessionStorage`, so
 *     changing routes doesn't drop the preview;
 *   • surfaces reactively — updating the URL or clicking a Link
 *     immediately re-renders every consumer of `useAuth().plan`;
 *   • never touches the database — the real `companies.plan` value
 *     is unchanged.
 *
 * Consumer contract
 * -----------------
 * `AuthProvider` calls `useForcedPlan()` and, when it returns a value,
 * publishes that value on the auth context in place of the real plan.
 * Nothing else in the app needs to know the override exists — every
 * gate, badge, and modal that already reads `useAuth().plan`
 * transparently switches.
 */

import { useEffect, useState } from "react";
import type { Plan } from "@/lib/plans";
import { PLAN_ORDER } from "@/lib/plans";

const STORAGE_KEY = "dev.forcePlan";
const QUERY_KEY = "forcePlan";
const LOCATION_EVENT = "lovable:locationchange";

const VALID = PLAN_ORDER as readonly string[];

type UrlOutcome =
  | { kind: "none" }
  | { kind: "clear" }
  | { kind: "set"; plan: Plan }
  | { kind: "invalid"; value: string };

function readUrl(): UrlOutcome {
  if (typeof window === "undefined") return { kind: "none" };
  const params = new URLSearchParams(window.location.search);
  if (!params.has(QUERY_KEY)) return { kind: "none" };
  const raw = (params.get(QUERY_KEY) ?? "").trim().toLowerCase();
  if (raw === "" || raw === "off" || raw === "clear" || raw === "false") {
    return { kind: "clear" };
  }
  if (VALID.includes(raw)) return { kind: "set", plan: raw as Plan };
  return { kind: "invalid", value: raw };
}

function readStorage(): Plan | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return v && VALID.includes(v) ? (v as Plan) : null;
  } catch {
    return null;
  }
}

function writeStorage(plan: Plan | null) {
  try {
    if (plan) window.sessionStorage.setItem(STORAGE_KEY, plan);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private-mode / disabled storage; override is transient this session */
  }
}

/**
 * Resolve the currently active override, applying URL → storage
 * precedence. URL wins and updates storage so the override persists
 * after the developer clicks a `<Link>` that drops the query param.
 */
export function readForcedPlan(): Plan | null {
  if (!import.meta.env.DEV) return null;
  if (typeof window === "undefined") return null;

  const url = readUrl();
  if (url.kind === "clear") {
    writeStorage(null);
    return null;
  }
  if (url.kind === "set") {
    writeStorage(url.plan);
    return url.plan;
  }
  if (url.kind === "invalid") {
    console.warn(
      `[dev] ?${QUERY_KEY}=${url.value} is not a valid plan. Use one of: ${VALID.join(", ")}, or "off" to clear.`,
    );
  }
  return readStorage();
}

/**
 * Patch `history.pushState`/`replaceState` once so we can observe
 * client-side navigations (TanStack Router doesn't fire `popstate`
 * for pushState-driven route changes). Idempotent; safe to call from
 * multiple `useEffect` mounts.
 */
function installLocationListener() {
  const w = window as unknown as { __lovableLocationPatched?: boolean };
  if (w.__lovableLocationPatched) return;
  w.__lovableLocationPatched = true;

  const fire = () => window.dispatchEvent(new Event(LOCATION_EVENT));
  const wrap = <K extends "pushState" | "replaceState">(key: K) => {
    const original = history[key];
    history[key] = function patched(this: History, ...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ret = (original as any).apply(this, args as any);
      fire();
      return ret;
    } as (typeof history)[K];
  };
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", fire);
}

/**
 * Reactive read of the override. Re-runs on every client-side URL
 * change (Link click, `useNavigate()`, back/forward) and on tab
 * visibility change so a developer editing the URL in another tab
 * sees the update on return. Returns `null` in production builds.
 */
export function useForcedPlan(): Plan | null {
  const [forced, setForced] = useState<Plan | null>(() => readForcedPlan());

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    installLocationListener();

    const update = () => setForced(readForcedPlan());
    window.addEventListener(LOCATION_EVENT, update);
    window.addEventListener("popstate", update);
    document.addEventListener("visibilitychange", update);

    // Re-check on mount in case the URL changed between the initial
    // useState() and the effect committing.
    update();

    return () => {
      window.removeEventListener(LOCATION_EVENT, update);
      window.removeEventListener("popstate", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return forced;
}
