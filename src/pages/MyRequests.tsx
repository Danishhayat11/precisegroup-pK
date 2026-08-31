/* allow-raw-color-file: request-status ribbons use amber/emerald/rose palette pending status-token migration
 * Tracked debt: migrate to semantic status tokens (bg-success, bg-warning,
 * bg-destructive, bg-info) in follow-up. Guardrail (scripts/ci/no-hex-in-
 * marketing-shell.mjs) blocks NEW drift while this marker documents the
 * legacy status-color usage in-file. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePIIGuardedQuery } from "@/lib/access";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fmtDate } from "@/lib/format";
import { Link } from "@tanstack/react-router";
import {
  Inbox,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Clock,
  User as UserIcon,
} from "lucide-react";
import { ListSkeleton } from "@/components/ui/skeletons";

type Row = {
  id: string;
  payment_receipt_no: string | null;
  booking_id: string | null;
  body: string;
  kind: "comment" | "edit_request";
  status: "open" | "resolved";
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

type AuditRow = {
  id: string;
  action: string;
  actor_email: string | null;
  created_at: string;
  before: any;
  after: any;
};

/**
 * Staff-facing "My Requests" page.
 *
 * Lists every payment comment / edit_request the current user has raised,
 * grouped and filterable by status. For resolved threads it correlates any
 * `audit_logs` entries touching the same payment between the request's
 * creation and shortly after resolution, so staff can see the concrete
 * change an admin applied without needing UPDATE access to financial tables.
 */
export default function MyRequests() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"all" | "open" | "resolved">("all");
  const [kind, setKind] = useState<"all" | "comment" | "edit_request">("all");
  const [q, setQ] = useState("");

  const { data: rows = [], isLoading } = usePIIGuardedQuery<Row[]>({
    queryKey: ["my-requests", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_comments")
        .select(
          "id,payment_receipt_no,booking_id,body,kind,status,created_at,resolved_at,resolved_by",
        )
        .eq("created_by", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 15_000,
  });

  const resolverIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.resolved_by).filter(Boolean))) as string[],
    [rows],
  );

  const { data: resolvers = {} } = useQuery({
    queryKey: ["my-requests-resolvers", resolverIds],
    enabled: resolverIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,email,full_name")
        .in("id", resolverIds);
      if (error) return {};
      const map: Record<string, { email: string; full_name: string | null }> = {};
      for (const p of data ?? [])
        map[(p as any).id] = { email: (p as any).email, full_name: (p as any).full_name };
      return map;
    },
    staleTime: 5 * 60_000,
  });

  const receiptNos = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .filter((r) => r.status === "resolved" && r.payment_receipt_no)
            .map((r) => r.payment_receipt_no!),
        ),
      ),
    [rows],
  );

  // Pull audit entries for every referenced receipt in one shot; correlate
  // per-request in the render layer to keep the query surface small.
  const { data: auditByReceipt = {} } = useQuery({
    queryKey: ["my-requests-audit", receiptNos],
    enabled: receiptNos.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id,action,actor_email,created_at,before,after,entity,entity_id")
        .eq("entity", "payment")
        .in("entity_id", receiptNos)
        .order("created_at", { ascending: false });
      if (error) return {};
      const map: Record<string, AuditRow[]> = {};
      for (const a of (data ?? []) as any[]) {
        (map[a.entity_id] ||= []).push({
          id: a.id,
          action: a.action,
          actor_email: a.actor_email,
          created_at: a.created_at,
          before: a.before,
          after: a.after,
        });
      }
      return map;
    },
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (kind !== "all" && r.kind !== kind) return false;
      if (needle) {
        const hay = `${r.payment_receipt_no ?? ""} ${r.booking_id ?? ""} ${r.body}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, status, kind, q]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      open: rows.filter((r) => r.status === "open").length,
      resolved: rows.filter((r) => r.status === "resolved").length,
      edit: rows.filter((r) => r.kind === "edit_request" && r.status === "open").length,
    }),
    [rows],
  );

  return (
    <div>
      <PageHeader
        title="My Requests"
        description="Track the status of the payment comments and edit requests you've raised."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard icon={Inbox} label="Total" value={counts.total} />
        <StatCard icon={AlertCircle} label="Open" value={counts.open} tone="amber" />
        <StatCard icon={CheckCircle2} label="Resolved" value={counts.resolved} tone="green" />
        <StatCard icon={MessageSquare} label="Edit requests open" value={counts.edit} tone="rose" />
      </div>

      <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search receipt, booking or text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger aria-label="Filter by status" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => setKind(v as any)}>
          <SelectTrigger aria-label="Filter by request type" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="comment">Comment</SelectItem>
            <SelectItem value="edit_request">Edit request</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {rows.length}
        </div>
      </Card>

      <div className="space-y-2">
        {isLoading ? (
          <ListSkeleton items={4} />
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-60" />
            No requests match the current filters. Raise one from any payment via the Comments
            panel.
          </Card>
        ) : (
          filtered.map((r) => (
            <RequestRow
              key={r.id}
              row={r}
              resolver={r.resolved_by ? resolvers[r.resolved_by] : undefined}
              audits={r.payment_receipt_no ? (auditByReceipt[r.payment_receipt_no] ?? []) : []}
            />
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: number;
  tone?: "amber" | "green" | "rose";
}) {
  const toneCls =
    tone === "amber"
      ? "text-amber-600"
      : tone === "green"
        ? "text-emerald-600"
        : tone === "rose"
          ? "text-rose-600"
          : "text-foreground";
  return (
    <Card className="p-3 flex items-center gap-3">
      <Icon className={`h-5 w-5 ${toneCls}`} />
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
      </div>
    </Card>
  );
}

function RequestRow({
  row,
  resolver,
  audits,
}: {
  row: Row;
  resolver?: { email: string; full_name: string | null };
  audits: AuditRow[];
}) {
  const [open, setOpen] = useState(false);
  const isOpen = row.status === "open";

  // Correlate audit_logs entries to this request: same receipt, created
  // between the comment and (resolved_at + 24h grace window).
  const related = useMemo(() => {
    if (row.status !== "resolved" || !row.resolved_at) return [] as AuditRow[];
    const from = new Date(row.created_at).getTime();
    const to = new Date(row.resolved_at).getTime() + 24 * 3600 * 1000;
    return audits.filter((a) => {
      const t = new Date(a.created_at).getTime();
      return t >= from && t <= to;
    });
  }, [audits, row]);

  return (
    <Card className="p-0 overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-accent/40"
          >
            <div className="pt-1">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <Badge
                  variant={row.kind === "edit_request" ? "destructive" : "secondary"}
                  className="capitalize"
                >
                  {row.kind === "edit_request" ? "Edit request" : "Comment"}
                </Badge>
                <Badge
                  variant={isOpen ? "outline" : "default"}
                  className={
                    isOpen
                      ? "border-amber-500 text-amber-700"
                      : "bg-emerald-600 hover:bg-emerald-600"
                  }
                >
                  {isOpen ? "Pending" : "Resolved"}
                </Badge>
                {row.payment_receipt_no && (
                  <span className="text-xs font-mono text-muted-foreground">
                    #{row.payment_receipt_no}
                  </span>
                )}
                {row.booking_id && (
                  <span className="text-xs text-muted-foreground">· {row.booking_id}</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {fmtDate(row.created_at)}
                </span>
              </div>
              <div className="text-sm line-clamp-2 whitespace-pre-wrap">{row.body}</div>
              {!isOpen && row.resolved_at && (
                <div className="mt-1 text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  Resolved {fmtDate(row.resolved_at)}
                  {resolver && (
                    <>
                      {" "}
                      by <UserIcon className="h-3 w-3" />
                      <span>{resolver.full_name || resolver.email}</span>
                    </>
                  )}
                  {related.length > 0 && (
                    <span className="ml-2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 px-1.5 py-0.5">
                      {related.length} change{related.length === 1 ? "" : "s"} applied
                    </span>
                  )}
                </div>
              )}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t px-4 py-3 space-y-3 bg-muted/30">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Full text
              </div>
              <div className="text-sm whitespace-pre-wrap">{row.body}</div>
            </div>

            {row.payment_receipt_no && (
              <div>
                <Link
                  to="/payments"
                  search={{ q: row.payment_receipt_no } as any}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Open payment #{row.payment_receipt_no}
                </Link>
              </div>
            )}

            {row.status === "resolved" && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Resulting changes
                </div>
                {related.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    Marked resolved with no financial edit recorded (may have been resolved as a
                    comment reply only).
                  </div>
                ) : (
                  <div className="space-y-2">
                    {related.map((a) => (
                      <AuditSummary key={a.id} audit={a} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function AuditSummary({ audit }: { audit: AuditRow }) {
  const [showJson, setShowJson] = useState(false);

  // Extract the payment patch keys that actually changed, so the summary is
  // readable even when the full before/after payload is dense.
  const changes = useMemo(() => {
    const before = (audit.before?.payment ?? audit.before) || {};
    const after = (audit.after?.payment ?? audit.after) || {};
    if (!before || !after) return [] as Array<{ k: string; from: any; to: any }>;
    const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
    const out: Array<{ k: string; from: any; to: any }> = [];
    for (const k of keys) {
      if (["updated_at", "created_at"].includes(k)) continue;
      const b = before?.[k];
      const a = after?.[k];
      if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ k, from: b, to: a });
    }
    return out.slice(0, 8);
  }, [audit]);

  return (
    <div className="rounded-md border bg-background p-2">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline" className="capitalize">
          {audit.action.replace(/\./g, " ")}
        </Badge>
        <span className="text-muted-foreground">{fmtDate(audit.created_at)}</span>
        {audit.actor_email && <span className="text-muted-foreground">· {audit.actor_email}</span>}
        <button
          type="button"
          onClick={() => setShowJson((s) => !s)}
          className="ml-auto text-[11px] text-muted-foreground hover:text-foreground underline"
        >
          {showJson ? "Hide JSON" : "Show JSON"}
        </button>
      </div>
      {changes.length > 0 && (
        <table className="mt-2 w-full text-[11px]">
          <tbody>
            {changes.map((c) => (
              <tr key={c.k} className="border-t">
                <td className="py-1 pr-2 font-mono text-muted-foreground w-1/4 align-top">{c.k}</td>
                <td className="py-1 pr-2 line-through text-rose-600 align-top break-all">
                  {fmtVal(c.from)}
                </td>
                <td className="py-1 text-emerald-700 align-top break-all">{fmtVal(c.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showJson && (
        <pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-2 text-[10px] leading-tight">
          {JSON.stringify({ before: audit.before, after: audit.after }, null, 2)}
        </pre>
      )}
    </div>
  );
}

function fmtVal(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
