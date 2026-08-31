/**
 * Persistent log of dashboard URL-sanitizer events across sessions.
 *
 * Stored in localStorage under SANITIZER_HISTORY_KEY as a JSON array of
 * entries. A capped ring-buffer (MAX_ENTRIES) keeps storage bounded.
 *
 * Each entry captures one sanitization event: when it happened, the URL
 * that triggered it, the list of param changes (key/from/to), and the
 * landing tab/kpi the user ended up on. Consumers can read the log to
 * render a history view or export it for debugging.
 */

export type SanitizerHistoryChange = {
  key: string;
  from: string;
  to: string;
};

export type SanitizerHistoryEntry = {
  /** ISO-8601 timestamp. */
  at: string;
  /** Full URL (href) at the time of sanitization. */
  url: string;
  /** Param-level changes recorded for this event. */
  changes: SanitizerHistoryChange[];
  /** Final landing tab after sanitization. */
  finalTab?: "overdue" | "kpi" | null;
  /** Final KPI key (if landing on the KPI tab). */
  finalKpi?: string | null;
  /** Friendly label for the final KPI (if applicable). */
  kpiLabel?: string | null;
};

export const SANITIZER_HISTORY_KEY = "dash.urlSanitizer.history.v1";
export const MAX_ENTRIES = 200;

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSanitizerHistory(): SanitizerHistoryEntry[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(SANITIZER_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive filter — only keep well-shaped entries.
    return parsed.filter(
      (e: unknown): e is SanitizerHistoryEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as SanitizerHistoryEntry).at === "string" &&
        Array.isArray((e as SanitizerHistoryEntry).changes),
    );
  } catch {
    return [];
  }
}

export function appendSanitizerHistoryEntry(entry: SanitizerHistoryEntry): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const existing = readSanitizerHistory();
    const next = [...existing, entry].slice(-MAX_ENTRIES);
    storage.setItem(SANITIZER_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Quota / serialization failures are non-fatal; the banner still works.
  }
}

export function clearSanitizerHistory(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(SANITIZER_HISTORY_KEY);
  } catch {
    /* noop */
  }
}

/** Build a JSON payload (string) for download. */
export function buildSanitizerHistoryJson(
  entries: SanitizerHistoryEntry[] = readSanitizerHistory(),
): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: entries.length,
      entries,
    },
    null,
    2,
  );
}

/** Build a CSV payload (string) — one row per change, with entry metadata. */
export function buildSanitizerHistoryCsv(
  entries: SanitizerHistoryEntry[] = readSanitizerHistory(),
): string {
  const esc = (v: string) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "at",
    "url",
    "finalTab",
    "finalKpi",
    "kpiLabel",
    "key",
    "original",
    "outcome",
    "replacement",
  ];
  const lines = [header.join(",")];
  for (const e of entries) {
    if (e.changes.length === 0) {
      lines.push(
        [e.at, e.url, e.finalTab ?? "", e.finalKpi ?? "", e.kpiLabel ?? "", "", "", "", ""]
          .map(esc)
          .join(","),
      );
      continue;
    }
    for (const c of e.changes) {
      const outcome = c.to === "removed" ? "removed" : "replaced";
      const replacement = c.to === "removed" ? "" : c.to;
      lines.push(
        [
          e.at,
          e.url,
          e.finalTab ?? "",
          e.finalKpi ?? "",
          e.kpiLabel ?? "",
          c.key,
          c.from,
          outcome,
          replacement,
        ]
          .map(esc)
          .join(","),
      );
    }
  }
  return lines.join("\r\n") + "\r\n";
}
