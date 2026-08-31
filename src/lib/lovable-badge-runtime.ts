/**
 * Runtime override for the Lovable branding-badge attribute.
 *
 * `VITE_HIDE_LOVABLE_BADGE` is baked in at build time and drives the SSR
 * value of `<html data-hide-lovable-badge>`. This module layers a live,
 * per-browser override on top so admins can flip behavior without a
 * redeploy:
 *
 *   - localStorage key `lovable-badge-hide-override` = "true" | "false"
 *     wins over the env default.
 *   - Absent / unrecognized value = fall back to env.
 *   - `applyLovableBadgeAttribute()` writes the resolved value onto
 *     `<html>` and dispatches `lovable-badge:changed` so the admin UI can
 *     re-render.
 *   - Changing the value in another tab (native `storage` event) also
 *     propagates.
 *
 * The purge script (src/lib/lovable-badge-purge.ts) re-reads the html
 * attribute on every mutation, so flipping the override to "true" at
 * runtime immediately re-arms badge removal for future injections.
 * Nodes already removed do not come back when flipping to "false" — a
 * page reload is required to see the badge again (documented in the UI).
 */

export const ENV_DEFAULT_HIDE_BADGE =
  (import.meta.env.VITE_HIDE_LOVABLE_BADGE ?? "true").toString().toLowerCase() !== "false";

const STORAGE_KEY = "lovable-badge-hide-override";
const CHANGE_EVENT = "lovable-badge:changed";

export type BadgeOverride = "true" | "false" | null;

export function readBadgeOverride(): BadgeOverride {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "true" || raw === "false") return raw;
    return null;
  } catch {
    return null;
  }
}

export function resolveHideBadge(override: BadgeOverride = readBadgeOverride()): boolean {
  if (override === "true") return true;
  if (override === "false") return false;
  return ENV_DEFAULT_HIDE_BADGE;
}

/**
 * Write the resolved value to `<html data-hide-lovable-badge>` and notify
 * listeners in this tab. Safe to call from useEffect on every mount — it's
 * idempotent and only touches the DOM when the attribute actually changes.
 */
export function applyLovableBadgeAttribute(): boolean {
  if (typeof document === "undefined") return ENV_DEFAULT_HIDE_BADGE;
  const hide = resolveHideBadge();
  const next = hide ? "true" : "false";
  const el = document.documentElement;
  const changed = el.getAttribute("data-hide-lovable-badge") !== next;
  if (changed) {
    el.setAttribute("data-hide-lovable-badge", next);
    try {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { hide } }));
    } catch {
      /* ignore */
    }
  }
  // When hiding (either newly or re-asserted), trigger an immediate sweep so
  // any already-rendered badge is purged without waiting for a mutation or
  // a page reload. The purge script exposes this hook on `window`.
  if (hide && typeof window !== "undefined") {
    try {
      const sweep = (window as unknown as { __lovableBadgeSweep?: () => void }).__lovableBadgeSweep;
      if (typeof sweep === "function") sweep();
    } catch {
      /* never break the page over a badge */
    }
  }
  return hide;
}

export function setBadgeOverride(next: BadgeOverride): void {
  if (typeof window === "undefined") return;
  try {
    if (next === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    /* localStorage may be unavailable in private mode; fall through */
  }
  applyLovableBadgeAttribute();
}

/**
 * Subscribe to override changes (same-tab custom event + cross-tab storage
 * event). Returns an unsubscribe function.
 */
export function subscribeLovableBadge(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      applyLovableBadgeAttribute();
      listener();
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
