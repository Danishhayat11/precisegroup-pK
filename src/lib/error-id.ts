import { generateErrorId, isValidErrorId } from "./error-page";

const STORAGE_KEY = "precise.lastErrorId";
const SSR_PICKUP_KEY = "precise.ssrErrorIdPickedUp";

// Stable map from a thrown Error instance to the ID we showed for it. Reuse on retry.
const errorIds = new WeakMap<object, string>();

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Read the x-error-id meta tag injected by the catastrophic-SSR fallback.
 * Returns the ID once, then marks it consumed so later client-side errors
 * don't keep reusing the SSR ID.
 */
function consumeSsrErrorId(): string | undefined {
  if (!isBrowser()) return undefined;
  try {
    if (window.sessionStorage.getItem(SSR_PICKUP_KEY) === "1") return undefined;
    const meta = document.querySelector('meta[name="x-error-id"]');
    const id = meta?.getAttribute("content")?.trim();
    if (!isValidErrorId(id)) return undefined;
    window.sessionStorage.setItem(SSR_PICKUP_KEY, "1");
    return id;
  } catch {
    return undefined;
  }
}

function persist(id: string): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage may be unavailable */
  }
}

/**
 * Returns a stable error reference ID for the given thrown value.
 *
 * - On the first client error after a catastrophic SSR fallback, reuses the
 *   server's `x-error-id` so the user can quote the same ref across reloads.
 * - On retries of the same Error instance, returns the same ID.
 * - On every fresh client-side error, mints a new ID and persists it so the
 *   user can reference it on later navigations.
 */
export function getOrCreateErrorId(error: unknown): string {
  const key: object | undefined =
    error && (typeof error === "object" || typeof error === "function")
      ? (error as object)
      : undefined;

  if (key) {
    const existing = errorIds.get(key);
    if (existing) return existing;
  }

  const id = consumeSsrErrorId() ?? generateErrorId();
  if (key) errorIds.set(key, id);
  persist(id);
  return id;
}

/** Most recent error ID surfaced to the user this session, if any. */
export function getLastErrorId(): string | undefined {
  if (!isBrowser()) return undefined;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return isValidErrorId(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}
