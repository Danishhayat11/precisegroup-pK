/**
 * Row-level "View diff" drawer for a single AuditIssue.
 *
 * Compares the currently-selected issue against the same issue id in the
 * previous snapshot (rotated per-browser by `snapshotStore`). Renders one
 * of four states:
 *   • new        — no matching id in the previous snapshot
 *   • unchanged  — all diff-tracked fields match
 *   • changed    — one or more fields differ (highlighted per row)
 *   • resolved   — previous had this id, current does not (surfaced from
 *                   the "Recently resolved" list, not the live table)
 *
 * Severity colours reuse the SEV_META tokens from DataHealth.tsx via a
 * small local map so the drawer stays visually consistent with the row.
 */
import { AlertOctagon, AlertTriangle, Info, CheckCircle2, ArrowRight, Clock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router-compat";
import type { AuditIssue, Severity } from "@/lib/dataAudit";
import {
  diffIssue,
  type IssueFieldDiff,
  type IssueSnapshot,
  type IssueSnapshotRow,
} from "./snapshotStore";

const SEV_ICON: Record<Severity, typeof AlertOctagon> = {
  CRITICAL: AlertOctagon,
  WARNING: AlertTriangle,
  INFO: Info,
};

const SEV_TONE: Record<Severity, string> = {
  CRITICAL: "border-destructive/40 bg-destructive/10 text-destructive",
  WARNING: "border-warning/40 bg-warning/10 text-warning",
  INFO: "border-info/40 bg-info/10 text-info",
};

const KIND_TONE: Record<"new" | "unchanged" | "changed" | "resolved", string> = {
  new: "border-info/40 bg-info/10 text-info",
  unchanged: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  changed: "border-warning/40 bg-warning/10 text-warning",
  resolved: "border-success/40 bg-success/10 text-success",
};

const FIELD_LABEL: Record<IssueFieldDiff["field"], string> = {
  severity: "Severity",
  type: "Issue Type",
  description: "Description",
  client_name: "Client",
  booking_id: "Booking",
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
}

function SeverityChip({ sev }: { sev: Severity | null }) {
  if (!sev) return <span className="text-xs text-muted-foreground">—</span>;
  const Icon = SEV_ICON[sev];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border ${SEV_TONE[sev]}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" /> {sev}
    </span>
  );
}

function FieldValue({ field, value }: { field: IssueFieldDiff["field"]; value: string | null }) {
  if (value == null || value === "")
    return <span className="text-xs text-muted-foreground italic">empty</span>;
  if (field === "severity") return <SeverityChip sev={value as Severity} />;
  if (field === "booking_id") return <span className="font-mono text-xs">{value}</span>;
  if (field === "description") return <span className="text-sm whitespace-pre-wrap">{value}</span>;
  return <span className="text-sm">{value}</span>;
}

export type IssueDiffDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: AuditIssue | null;
  previousSnapshot: IssueSnapshot | null;
  /** Timestamp of the current (live) audit, for the header caption. */
  currentScannedAt: string | null;
};

export function IssueDiffDrawer({
  open,
  onOpenChange,
  issue,
  previousSnapshot,
  currentScannedAt,
}: IssueDiffDrawerProps) {
  const previousRow: IssueSnapshotRow | null =
    issue && previousSnapshot ? (previousSnapshot.issues[issue.id] ?? null) : null;
  const diff = diffIssue(issue, previousRow);

  const kindLabel: Record<typeof diff.kind, string> = {
    new: "New in this run",
    unchanged: "Unchanged",
    changed: `Changed (${diff.changedFields.length} field${diff.changedFields.length === 1 ? "" : "s"})`,
    resolved: "Resolved",
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-lg">Issue diff</SheetTitle>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[diff.kind]}`}
            >
              {kindLabel[diff.kind]}
            </span>
          </div>
          <SheetDescription>
            {issue?.type ? (
              <>
                Comparing <span className="font-medium text-foreground">{issue.type}</span> across
                runs.
              </>
            ) : (
              "Comparing this issue across audit runs."
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border p-2">
              <div className="flex items-center gap-1 text-muted-foreground uppercase tracking-wide font-semibold text-[10px]">
                <Clock className="h-3 w-3" aria-hidden="true" /> Previous run
              </div>
              <div className="mt-1 tabular-nums">
                {formatWhen(previousSnapshot?.scannedAt ?? null)}
              </div>
              {!previousSnapshot && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  No previous snapshot yet — this browser will remember the current run so the next
                  scan has something to diff against.
                </div>
              )}
            </div>
            <div className="rounded-md border p-2">
              <div className="flex items-center gap-1 text-muted-foreground uppercase tracking-wide font-semibold text-[10px]">
                <ArrowRight className="h-3 w-3" aria-hidden="true" /> Current run
              </div>
              <div className="mt-1 tabular-nums">{formatWhen(currentScannedAt)}</div>
            </div>
          </div>

          {!issue ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              No issue selected.
            </div>
          ) : diff.kind === "new" ? (
            <NewIssueSection row={diff.current!} />
          ) : diff.kind === "unchanged" ? (
            <UnchangedSection row={diff.current!} />
          ) : (
            <ChangedSection
              changed={diff.changedFields}
              previous={diff.previous!}
              current={diff.current!}
            />
          )}

          {issue?.booking_id && (
            <div className="pt-2 border-t">
              <Button asChild size="sm" variant="outline" className="min-h-11">
                <Link to={`/bookings/${issue.booking_id}`}>Open booking {issue.booking_id}</Link>
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NewIssueSection({ row }: { row: IssueSnapshotRow }) {
  return (
    <div className="rounded-md border border-info/40 bg-info/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-info border-info/40">
          NEW
        </Badge>
        <span className="text-xs text-muted-foreground">
          This issue did not exist in the previous snapshot.
        </span>
      </div>
      <MetaGrid row={row} />
    </div>
  );
}

function UnchangedSection({ row }: { row: IssueSnapshotRow }) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-xs text-muted-foreground">
        All tracked fields match the previous snapshot.
      </div>
      <MetaGrid row={row} />
    </div>
  );
}

function ChangedSection({
  changed,
  previous,
  current,
}: {
  changed: IssueFieldDiff[];
  previous: IssueSnapshotRow;
  current: IssueSnapshotRow;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning-foreground/90">
        {changed.length} field{changed.length === 1 ? "" : "s"} changed between the last two runs.
      </div>
      <ul className="space-y-3">
        {changed.map((c) => (
          <li key={c.field} className="rounded-md border p-3">
            <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-2">
              {FIELD_LABEL[c.field]}
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Before
                </div>
                <FieldValue field={c.field} value={c.before} />
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground mt-6" aria-hidden="true" />
              <div className="rounded-md border border-success/30 bg-success/5 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  After
                </div>
                <FieldValue field={c.field} value={c.after} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <details className="rounded-md border p-3">
        <summary className="text-xs text-muted-foreground cursor-pointer select-none">
          Full row snapshots
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
              Previous
            </div>
            <MetaGrid row={previous} compact />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
              Current
            </div>
            <MetaGrid row={current} compact />
          </div>
        </div>
      </details>
    </div>
  );
}

function MetaGrid({ row, compact = false }: { row: IssueSnapshotRow; compact?: boolean }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Severity", <SeverityChip key="s" sev={row.severity} />],
    ["Type", row.type],
    [
      "Booking",
      row.booking_id ? (
        <span key="b" className="font-mono text-xs">
          {row.booking_id}
        </span>
      ) : (
        "—"
      ),
    ],
    ["Client", row.client_name ?? "—"],
    [
      "Description",
      <span key="d" className="whitespace-pre-wrap">
        {row.description}
      </span>,
    ],
    ["Detected", formatWhen(row.detected_at)],
  ];
  return (
    <dl
      className={`grid ${compact ? "grid-cols-1 gap-1" : "grid-cols-[110px_1fr] gap-x-3 gap-y-1"} text-sm`}
    >
      {rows.map(([k, v]) => (
        <div key={k} className={compact ? "" : "contents"}>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</dt>
          <dd className="text-sm">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Also exported for the summary/resolved list to render `resolved` rows
 * that no longer appear in `report.issues`.
 */
export function pickResolvedRows(
  previous: IssueSnapshot | null,
  currentIds: Set<string>,
): IssueSnapshotRow[] {
  if (!previous) return [];
  return Object.values(previous.issues).filter((r) => !currentIds.has(r.id));
}
