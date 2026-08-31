/**
 * Per-browser snapshot store for the Data Health audit.
 *
 * Two slots in localStorage:
 *   • datahealth.snapshot.current  — the most recent report we've seen
 *   • datahealth.snapshot.previous — the report immediately before that
 *
 * `commitSnapshot()` only rotates current → previous when the report
 * fingerprint (issue-set + severities + descriptions) actually changes;
 * background refetches that yield an identical report leave the "previous"
 * slot untouched so users still have something meaningful to diff against.
 *
 * All storage failures are swallowed — the diff drawer is a nice-to-have
 * and must never break the page for a user with disabled storage / quota
 * exhaustion / SSR (no window).
 */
import type { AuditIssue, AuditReport, Severity } from "@/lib/dataAudit";

const CURRENT_KEY = "datahealth.snapshot.current";
const PREVIOUS_KEY = "datahealth.snapshot.previous";
const SCHEMA_VERSION = 1 as const;

export type IssueSnapshotRow = {
  id: string;
  severity: Severity;
  booking_id: string | null;
  client_name: string | null;
  type: string;
  description: string;
  detected_at: string;
};

export type IssueSnapshot = {
  v: typeof SCHEMA_VERSION;
  scannedAt: string;
  fingerprint: string;
  issues: Record<string, IssueSnapshotRow>;
};

const toRow = (i: AuditIssue): IssueSnapshotRow => ({
  id: i.id,
  severity: i.severity,
  booking_id: i.booking_id,
  client_name: i.client_name,
  type: i.type,
  description: i.description,
  detected_at: i.detected_at,
});

/**
 * Cheap, order-independent fingerprint. Uses id + severity + description
 * (the fields that actually matter for the diff view). Sorted so identical
 * issue sets always produce the same string regardless of scan order.
 */
export function fingerprintReport(report: AuditReport): string {
  const parts = report.issues.map((i) => `${i.id}|${i.severity}|${i.description}`).sort();
  return `${parts.length}:${parts.join("~")}`;
}

function safeGet(storage: Storage | null, key: string): IssueSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== SCHEMA_VERSION) return null;
    if (!parsed.issues || typeof parsed.issues !== "object") return null;
    return parsed as IssueSnapshot;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | null, key: string, value: IssueSnapshot | null) {
  if (!storage) return;
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled — silently drop; diff simply won't be available */
  }
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPreviousSnapshot(storage: Storage | null = getStorage()): IssueSnapshot | null {
  return safeGet(storage, PREVIOUS_KEY);
}

export function loadCurrentSnapshot(storage: Storage | null = getStorage()): IssueSnapshot | null {
  return safeGet(storage, CURRENT_KEY);
}

/**
 * Commit a fresh report as the new "current" snapshot. If it differs from
 * the previously-stored current, that previous current is rotated into the
 * "previous" slot first. Returns whichever snapshot is now in the previous
 * slot (i.e. what the diff drawer should compare against).
 */
export function commitSnapshot(
  report: AuditReport,
  storage: Storage | null = getStorage(),
): IssueSnapshot | null {
  if (!storage) return loadPreviousSnapshot(null);

  const fp = fingerprintReport(report);
  const nextCurrent: IssueSnapshot = {
    v: SCHEMA_VERSION,
    scannedAt: report.scannedAt,
    fingerprint: fp,
    issues: Object.fromEntries(report.issues.map((i) => [i.id, toRow(i)])),
  };

  const existingCurrent = safeGet(storage, CURRENT_KEY);
  if (existingCurrent && existingCurrent.fingerprint === fp) {
    // Same report as last time — refresh its scannedAt but don't rotate.
    safeSet(storage, CURRENT_KEY, { ...existingCurrent, scannedAt: report.scannedAt });
    return safeGet(storage, PREVIOUS_KEY);
  }

  // Rotate: existing current becomes previous, new becomes current.
  if (existingCurrent) safeSet(storage, PREVIOUS_KEY, existingCurrent);
  safeSet(storage, CURRENT_KEY, nextCurrent);
  return safeGet(storage, PREVIOUS_KEY);
}

export type IssueDiffKind = "new" | "unchanged" | "changed" | "resolved";

export type IssueFieldDiff = {
  field: "severity" | "type" | "description" | "client_name" | "booking_id";
  before: string | null;
  after: string | null;
};

export type IssueDiff = {
  kind: IssueDiffKind;
  previous: IssueSnapshotRow | null;
  current: IssueSnapshotRow | null;
  changedFields: IssueFieldDiff[];
};

export function diffIssue(
  current: AuditIssue | IssueSnapshotRow | null,
  previous: IssueSnapshotRow | null,
): IssueDiff {
  const curRow = current ? (isSnapshotRow(current) ? current : toRow(current)) : null;
  if (!curRow && !previous)
    return { kind: "unchanged", previous: null, current: null, changedFields: [] };
  if (curRow && !previous)
    return { kind: "new", previous: null, current: curRow, changedFields: [] };
  if (!curRow && previous) return { kind: "resolved", previous, current: null, changedFields: [] };

  const changed: IssueFieldDiff[] = [];
  const fields: IssueFieldDiff["field"][] = [
    "severity",
    "type",
    "description",
    "client_name",
    "booking_id",
  ];
  for (const f of fields) {
    const before = (previous as IssueSnapshotRow)[f];
    const after = (curRow as IssueSnapshotRow)[f];
    if ((before ?? null) !== (after ?? null)) {
      changed.push({ field: f, before: before ?? null, after: after ?? null });
    }
  }
  return {
    kind: changed.length ? "changed" : "unchanged",
    previous,
    current: curRow,
    changedFields: changed,
  };
}

function isSnapshotRow(x: AuditIssue | IssueSnapshotRow): x is IssueSnapshotRow {
  return (
    typeof (x as IssueSnapshotRow).id === "string" &&
    typeof (x as IssueSnapshotRow).description === "string"
  );
}

// Internal helpers exported for the drawer.
export const __test__ = { CURRENT_KEY, PREVIOUS_KEY, SCHEMA_VERSION };
