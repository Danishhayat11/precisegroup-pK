/**
 * Local-only test harness for the Security Issues Review flow.
 *
 * The real scanner-persisted findings live server-side and cycle on the
 * backend's own cadence, which makes it hard to reproduce the
 * "ignore-with-justification → next scan skips it" loop on demand. This
 * module gives the reviewer a temporary, browser-local finding they can
 * ignore, refresh, and verify against a simulated next scan without
 * touching anything the real scanners care about.
 *
 * State is persisted to localStorage under two keys:
 *   - `security-review:test-findings`   — the seeded finding rows
 *   - `security-review:ignored-memory`  — id → justification map that
 *                                         mimics `security-memory` entries
 *
 * Nothing here is wired to the production scanner API; it exists solely to
 * exercise the client-side workflow (panel state, justification gate,
 * export payload, refresh persistence).
 */
import type { SecurityFinding } from "./findings";

const FINDINGS_KEY = "security-review:test-findings";
const IGNORE_MEMORY_KEY = "security-review:ignored-memory";

export type IgnoredMemory = Record<string, { justification: string; ignoredAt: string }>;

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function listTestFindings(): SecurityFinding[] {
  if (!isBrowser()) return [];
  return safeParse<SecurityFinding[]>(window.localStorage.getItem(FINDINGS_KEY), []);
}

export function saveTestFindings(next: SecurityFinding[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(FINDINGS_KEY, JSON.stringify(next));
}

export function getIgnoredMemory(): IgnoredMemory {
  if (!isBrowser()) return {};
  return safeParse<IgnoredMemory>(window.localStorage.getItem(IGNORE_MEMORY_KEY), {});
}

export function saveIgnoredMemory(next: IgnoredMemory) {
  if (!isBrowser()) return;
  window.localStorage.setItem(IGNORE_MEMORY_KEY, JSON.stringify(next));
}

/** Build a unique-ish id for a freshly seeded test finding. */
export function makeTestFindingId() {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `TEST_seeded_${stamp}_${rand}`;
}

/** Default template for a seeded finding — mirrors a real scanner row. */
export function buildTestFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  const id = overrides.id ?? makeTestFindingId();
  return {
    id,
    scanner: "agent_security",
    name: "Test finding (seeded locally)",
    description:
      "Synthetic finding used to verify the ignore-with-justification workflow. Ignoring this row should persist to security-memory and be skipped on the next simulated scan.",
    level: "warn",
    status: "pending",
    justification: "",
    reviewedAt: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

/**
 * Merge the curated findings snapshot with locally seeded test rows and
 * overlay any ignored-memory decisions so a refresh reproduces the exact
 * "already ignored, justification recorded" state the reviewer left behind.
 */
export function mergeWithSeededFindings(base: readonly SecurityFinding[]): SecurityFinding[] {
  const seeded = listTestFindings();
  const memory = getIgnoredMemory();
  const applyMemory = (f: SecurityFinding): SecurityFinding => {
    const remembered = memory[f.id];
    if (!remembered) return f;
    return { ...f, status: "ignored", justification: remembered.justification };
  };
  return [...base.map(applyMemory), ...seeded.map(applyMemory)];
}

/**
 * Simulate the backend re-running its scanner. Findings whose ids are
 * present in `security-memory` (ignored + justified) drop out of the
 * result set entirely — the same behaviour the real scanner promises.
 */
export function applyIgnoreSkip(findings: readonly SecurityFinding[]): SecurityFinding[] {
  const memory = getIgnoredMemory();
  return findings.filter((f) => !memory[f.id]);
}

export function recordIgnored(id: string, justification: string): IgnoredMemory {
  const next: IgnoredMemory = {
    ...getIgnoredMemory(),
    [id]: { justification, ignoredAt: new Date().toISOString() },
  };
  saveIgnoredMemory(next);
  return next;
}

export function forgetIgnored(id: string): IgnoredMemory {
  const current = getIgnoredMemory();
  if (!(id in current)) return current;
  const next = { ...current };
  delete next[id];
  saveIgnoredMemory(next);
  return next;
}

/**
 * Drop every ignore-memory entry whose id is NOT present in `keepIds`.
 * Used by the debug panel's "Prune inert" action to clear rules that no
 * longer match any surfaced finding while leaving active/shadowed rules
 * (i.e. ids still visible in the current scan) intact.
 * Returns the list of ids that were removed.
 */
export function pruneIgnoredNotIn(keepIds: Iterable<string>): string[] {
  const current = getIgnoredMemory();
  const keep = new Set(keepIds);
  const removed: string[] = [];
  const next: IgnoredMemory = {};
  for (const [id, entry] of Object.entries(current)) {
    if (keep.has(id)) next[id] = entry;
    else removed.push(id);
  }
  if (removed.length > 0) saveIgnoredMemory(next);
  return removed;
}

export function clearAllTestState() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(FINDINGS_KEY);
  window.localStorage.removeItem(IGNORE_MEMORY_KEY);
}
