/**
 * Lightweight telemetry for fit-to-one-page runs.
 *
 * Each terminal decision from `fitStep` funnels through `recordFitRun`,
 * producing a compact summary (steps, convergence reason, clamp/unstable
 * signals, geometry context). Records live in an in-memory ring buffer
 * (last 50) with an opportunistic `localStorage` mirror so an edge case
 * survives a reload for post-hoc diagnosis.
 *
 * Deliberately dependency-free: no React, no logger, no network. Consumers
 * can grab `getFitTelemetry()` from the console or copy the JSON via
 * `dumpFitTelemetry()`.
 */

import type { FitLogEntry } from "./fitToOnePage";

export type FitTelemetryRecord = {
  id: string;
  at: number;
  /** Where the run originated — "preview" (PrintPreviewModal) or "tester". */
  source: "preview" | "tester" | string;
  finalScale: number;
  steps: number;
  impossible: boolean;
  unstable: boolean;
  /** Terminal reason from the last log entry (e.g. "converged", "cycle"). */
  convergence: string;
  /** True when any log entry's reason contained "clamped". */
  clamped: boolean;
  clampReasons: string[];
  /** Optional geometry / caller context — paper, orientation, margins, etc. */
  context?: Record<string, unknown>;
  /** First & last log entries only, to keep the record small. */
  head?: FitLogEntry;
  tail?: FitLogEntry;
};

const MAX_RECORDS = 50;
const STORAGE_KEY = "lovable:fit-telemetry:v1";

let buffer: FitTelemetryRecord[] = load();
/** Full trail of the most recent run (not persisted — kept in memory only). */
let latestFullTrail: { record: FitTelemetryRecord; log: FitLogEntry[] } | null = null;
const listeners = new Set<(records: FitTelemetryRecord[]) => void>();

function load(): FitTelemetryRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_RECORDS) : [];
  } catch {
    return [];
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    /* quota / private mode — telemetry is best-effort */
  }
}

function notify() {
  for (const fn of listeners) {
    try {
      fn(buffer);
    } catch {
      /* isolate subscriber failures */
    }
  }
}

export type RecordFitRunInput = {
  source: FitTelemetryRecord["source"];
  finalScale: number;
  steps: number;
  impossible: boolean;
  unstable: boolean;
  log: FitLogEntry[];
  context?: Record<string, unknown>;
};

export function recordFitRun(input: RecordFitRunInput): FitTelemetryRecord {
  const { log } = input;
  const tail = log.length ? log[log.length - 1] : undefined;
  const head = log.length ? log[0] : undefined;
  const clampReasons = Array.from(
    new Set(log.filter((e) => e.reason.includes("clamped")).map((e) => e.reason)),
  );
  const record: FitTelemetryRecord = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `fit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    source: input.source,
    finalScale: input.finalScale,
    steps: input.steps,
    impossible: input.impossible,
    unstable: input.unstable,
    convergence: tail?.reason ?? "unknown",
    clamped: clampReasons.length > 0,
    clampReasons,
    context: input.context,
    head,
    tail,
  };

  buffer = [...buffer, record].slice(-MAX_RECORDS);
  latestFullTrail = { record, log: [...log] };
  persist();
  notify();
  return record;
}

/**
 * Build a JSON-serialisable bug-report payload for the most recent fit run.
 * Returns `null` if no run has been recorded in this session.
 */
export function buildLatestFitTrailReport(): {
  filename: string;
  json: string;
  payload: {
    kind: "lovable.fit-trail";
    version: 1;
    exportedAt: string;
    userAgent: string | null;
    record: FitTelemetryRecord;
    log: FitLogEntry[];
  };
} | null {
  if (!latestFullTrail) return null;
  const { record, log } = latestFullTrail;
  const exportedAt = new Date(record.at).toISOString();
  const payload = {
    kind: "lovable.fit-trail" as const,
    version: 1 as const,
    exportedAt,
    userAgent:
      typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
        ? navigator.userAgent
        : null,
    record,
    log,
  };
  const stamp = exportedAt.replace(/[:.]/g, "-");
  return {
    filename: `fit-trail-${record.source}-${stamp}.json`,
    json: JSON.stringify(payload, null, 2),
    payload,
  };
}

/**
 * Trigger a browser download of the latest fit trail as JSON.
 * No-op (returns false) on the server or when no run has been recorded.
 */
export function downloadLatestFitTrail(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const report = buildLatestFitTrailReport();
  if (!report) return false;
  const blob = new Blob([report.json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = report.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export function getFitTelemetry(): FitTelemetryRecord[] {
  return [...buffer];
}

export function clearFitTelemetry(): void {
  buffer = [];
  latestFullTrail = null;
  persist();
  notify();
}

export function subscribeFitTelemetry(fn: (records: FitTelemetryRecord[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dumpFitTelemetry(): string {
  return JSON.stringify(buffer, null, 2);
}

// Expose a diagnostics handle in the browser so support can pull it from the
// console without shipping a UI surface. No-op on the server.
if (typeof window !== "undefined") {
  (window as unknown as { __fitTelemetry?: unknown }).__fitTelemetry = {
    get: getFitTelemetry,
    clear: clearFitTelemetry,
    dump: dumpFitTelemetry,
    subscribe: subscribeFitTelemetry,
    latestTrail: buildLatestFitTrailReport,
    download: downloadLatestFitTrail,
  };
}
