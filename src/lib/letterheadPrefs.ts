/**
 * Centralized letterhead preference resolver.
 *
 * Fallback chain (consistent across the app):
 *   1. Per-client stored value (keyed by client_ref, then booking_id)
 *   2. Last-used global value (most recent letterhead the user picked anywhere)
 *   3. Hard default — "B" (Transactional)
 *
 * Use `resolveLetterhead(clientKey)` everywhere a letterhead is needed for
 * printing. Use `persistLetterhead(clientKey, style)` whenever the user
 * picks one — it always updates BOTH the per-client map AND the global
 * last-used value, so a future client with no stored preference inherits
 * the most recent choice.
 */
import type { LetterheadStyle } from "@/lib/letterhead";

export const LETTERHEAD_GLOBAL_KEY = "precise.paymentHistory.letterhead";
export const LETTERHEAD_BY_CLIENT_KEY = "precise.paymentHistory.letterhead.byClient";
export const LETTERHEAD_HARD_DEFAULT: LetterheadStyle = "B";

export const isLetterheadStyle = (v: unknown): v is LetterheadStyle => v === "A" || v === "B";

const readClientMap = (): Record<string, LetterheadStyle> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LETTERHEAD_BY_CLIENT_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
};

const writeClientMap = (map: Record<string, LetterheadStyle>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LETTERHEAD_BY_CLIENT_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
};

export const readGlobalLetterhead = (): LetterheadStyle => {
  if (typeof window === "undefined") return LETTERHEAD_HARD_DEFAULT;
  const v = window.localStorage.getItem(LETTERHEAD_GLOBAL_KEY);
  return isLetterheadStyle(v) ? v : LETTERHEAD_HARD_DEFAULT;
};

export const writeGlobalLetterhead = (style: LetterheadStyle) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LETTERHEAD_GLOBAL_KEY, style);
  } catch {
    /* ignore */
  }
};

/** Read per-client stored value only (no fallback). */
export const readClientLetterhead = (
  clientKey: string | null | undefined,
): LetterheadStyle | null => {
  if (!clientKey) return null;
  const v = readClientMap()[clientKey];
  return isLetterheadStyle(v) ? v : null;
};

/**
 * Apply the fallback chain and return the effective letterhead +
 * the source it came from. Use `source` to show UI hints like
 * "Using last-used letterhead" when no per-client preference exists.
 */
export const resolveLetterhead = (
  clientKey: string | null | undefined,
): { style: LetterheadStyle; source: "client" | "global" | "default" } => {
  const perClient = readClientLetterhead(clientKey);
  if (perClient) return { style: perClient, source: "client" };

  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(LETTERHEAD_GLOBAL_KEY);
    if (isLetterheadStyle(raw)) return { style: raw, source: "global" };
  }
  return { style: LETTERHEAD_HARD_DEFAULT, source: "default" };
};

/**
 * Persist a user choice. Always updates the global last-used value so
 * other clients with no stored preference inherit this pick on the next
 * resolve. Also stores per-client when `clientKey` is provided.
 */
export const persistLetterhead = (clientKey: string | null | undefined, style: LetterheadStyle) => {
  writeGlobalLetterhead(style);
  if (!clientKey) return;
  const map = readClientMap();
  map[clientKey] = style;
  writeClientMap(map);
};

/**
 * Clear a client's stored letterhead so the next `resolveLetterhead` falls
 * back to the global last-used value (or the hard default "B").
 * Does NOT touch the global last-used value.
 */
export const clearClientLetterhead = (clientKey: string | null | undefined) => {
  if (!clientKey) return;
  const map = readClientMap();
  if (!(clientKey in map)) return;
  delete map[clientKey];
  writeClientMap(map);
};
