/**
 * Pure loader + serializer for the Issues table's persisted column visibility.
 *
 * ## Storage schema (versioned)
 *
 * Payload written by `serializeIssueVisibleCols` is a JSON envelope:
 *
 *   { "v": <positive int>, "cols": ["severity", "booking", ...] }
 *
 * The version is bumped whenever the shape of `cols` (or its semantics)
 * changes so we can migrate old data instead of throwing it away. Add a new
 * entry to `MIGRATIONS` keyed by the source version; each migration returns
 * the next-version payload. The loader chains migrations until it reaches
 * `CURRENT_VERSION`.
 *
 * ## Legacy shape
 *
 * The very first release stored a bare array (`["severity", "booking"]`)
 * with no envelope. That shape is treated as version 0 and migrated in-place
 * to v1, so users who upgrade never lose their picker preferences.
 *
 * ## Fallback reasons
 *
 * The loader NEVER throws. Anything it cannot understand is reported via
 * `reason` and the caller renders defaults. The React component uses `reason`
 * to surface a toast so the user knows their saved value was reset.
 */

export type IssueColsFallbackReason =
  | "corrupted" // JSON.parse failed
  | "invalid" // parsed value has the wrong shape at any layer
  | "empty" // valid shape but no usable keys remain
  | "unsupported"; // stored version is newer than we understand or cannot migrate

export type LoadIssueColsResult = {
  cols: Set<string>;
  /** null when a valid saved value was loaded (or the key was absent). */
  reason: IssueColsFallbackReason | null;
};

export const ISSUE_VIS_KEY = "datahealth.issuesVisibleCols";
export const CURRENT_VERSION = 1;

type EnvelopeV1 = { v: 1; cols: string[] };
type AnyEnvelope = { v: number; cols: unknown };

/**
 * Map from source-version -> migrator producing the NEXT version's envelope.
 * Extend when bumping CURRENT_VERSION. Each step is best-effort; return null
 * to signal the payload can't be recovered and the caller should fall back.
 */
const MIGRATIONS: Record<number, (payload: unknown) => AnyEnvelope | null> = {
  // v0 = pre-envelope legacy: a bare string array. Wrap into the v1 envelope.
  0: (payload) => {
    if (!Array.isArray(payload)) return null;
    return { v: 1, cols: payload.filter((k): k is string => typeof k === "string") };
  },
};

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/**
 * Normalize whatever came out of localStorage into a v0-or-later envelope.
 * Returns null when the shape is fundamentally broken (not JSON-array and
 * not an object with a numeric `v`).
 */
function toEnvelope(parsed: unknown): AnyEnvelope | null {
  if (Array.isArray(parsed)) return { v: 0, cols: parsed }; // legacy
  if (parsed && typeof parsed === "object") {
    const rec = parsed as Record<string, unknown>;
    if (isPositiveInt(rec.v)) return { v: rec.v, cols: rec.cols };
  }
  return null;
}

export function loadIssueVisibleCols(
  allKeys: readonly string[],
  storage: Pick<Storage, "getItem" | "removeItem"> | null | undefined,
): LoadIssueColsResult {
  const fallback = new Set(allKeys);
  const reset = (reason: IssueColsFallbackReason): LoadIssueColsResult => {
    try {
      storage?.removeItem(ISSUE_VIS_KEY);
    } catch {
      /* ignore */
    }
    return { cols: fallback, reason };
  };

  if (!storage) return { cols: fallback, reason: null };

  let raw: string | null = null;
  try {
    raw = storage.getItem(ISSUE_VIS_KEY);
  } catch {
    return { cols: fallback, reason: null };
  }
  if (raw == null) return { cols: fallback, reason: null }; // first visit

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reset("corrupted");
  }

  let envelope: AnyEnvelope | null = toEnvelope(parsed);
  if (!envelope) return reset("invalid");

  // Chain migrations up to CURRENT_VERSION.
  while (envelope && envelope.v < CURRENT_VERSION) {
    const step: ((p: unknown) => AnyEnvelope | null) | undefined = MIGRATIONS[envelope.v];
    if (!step) return reset("unsupported");
    const next: AnyEnvelope | null = step(envelope.cols);
    if (!next) return reset("invalid");
    envelope = next;
  }
  if (!envelope) return reset("invalid");

  // Envelope newer than we understand — refuse rather than guess.
  if (envelope.v > CURRENT_VERSION) return reset("unsupported");

  if (!Array.isArray(envelope.cols)) return reset("invalid");
  const filtered = (envelope.cols as unknown[]).filter(
    (k): k is string => typeof k === "string" && allKeys.includes(k),
  );
  if (filtered.length === 0) return reset("empty");

  return { cols: new Set(filtered), reason: null };
}

/** Serialize a selection into the current-version envelope for localStorage. */
export function serializeIssueVisibleCols(cols: Iterable<string>): string {
  const payload: EnvelopeV1 = { v: CURRENT_VERSION, cols: [...cols] };
  return JSON.stringify(payload);
}

/**
 * Shared runtime validator for an Issues column selection.
 *
 * Used by both the picker (before persisting a toggle) and the export code
 * paths (PDF/CSV) so every consumer applies identical rules:
 *   - strip non-strings and unknown keys not in `allKeys`
 *   - de-duplicate
 *   - report `valid=false` when nothing usable remains
 *
 * Callers decide what to do when `valid` is false (toast + skip write for the
 * picker; toast + abort export for the export paths). This keeps the
 * "at least one column" invariant in one place.
 */
export type SanitizeIssueColsResult = {
  cols: Set<string>;
  valid: boolean;
  /** Keys removed because they were unknown or the wrong type — useful for diagnostics. */
  dropped: string[];
};

export function sanitizeIssueVisibleCols(
  candidate: Iterable<string> | null | undefined,
  allKeys: readonly string[],
): SanitizeIssueColsResult {
  const allow = new Set(allKeys);
  const kept = new Set<string>();
  const dropped: string[] = [];
  if (candidate) {
    for (const raw of candidate) {
      if (typeof raw !== "string") {
        dropped.push(String(raw));
        continue;
      }
      if (!allow.has(raw)) {
        dropped.push(raw);
        continue;
      }
      kept.add(raw);
    }
  }
  return { cols: kept, valid: kept.size > 0, dropped };
}
