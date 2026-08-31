import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtPKR } from "@/lib/format";
import { Link } from "@/lib/router-compat";
import { Plus, CheckCircle2, XCircle } from "lucide-react";
import { useActiveProject } from "@/lib/activeProject";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";
import {
  AdjustmentFormDialog,
  RealizeAdjustmentDialog,
  WaiveAdjustmentDialog,
} from "@/components/AdjustmentForm";

type AdjustmentRow = {
  adjustment_id: string;
  booking_id: string | null;
  client_name: string | null;
  unit_id: string | null;
  asset_description: string | null;
  approved_value: number | null;
  realized_value: number | null;
  company_loss_gain: number | null;
  approval_date: string | null;
  status: string;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Status tone mapping so the row badge matches the spec:
 *   PENDING = orange, REALIZED = green, WAIVED = grey.
 * We reuse the existing StatusBadge tones from the design system so the
 * dashboard/ledger badges look consistent.
 */
function statusToneFor(status: string): "warning" | "success" | "muted" {
  const s = String(status ?? "").toUpperCase();
  if (s === "REALIZED") return "success";
  if (s === "WAIVED") return "muted";
  return "warning"; // PENDING
}

export default function Adjustments() {
  const { activeCode, activeProject } = useActiveProject();

  const [createOpen, setCreateOpen] = useState(false);
  const [realizeRow, setRealizeRow] = useState<AdjustmentRow | null>(null);
  const [waiveRow, setWaiveRow] = useState<AdjustmentRow | null>(null);

  // Adjustments have no direct project_code — filter via booking_ids for
  // the active project.
  const { data: allowedBookings, accessDenied } = usePIIGuardedQuery<Set<string> | null>({
    queryKey: ["adj-allowed-bookings", activeCode ?? "all"],
    queryFn: async () => {
      if (!activeCode) return null;
      const { data } = await supabase
        .from("bookings")
        .select("booking_id")
        .eq("project_code", activeCode);
      const set = new Set<string>();
      (data ?? []).forEach((b: any) => {
        if (b.booking_id) set.add(b.booking_id);
      });
      return set;
    },
  });

  const { data: rows = [] } = usePIIGuardedQuery<AdjustmentRow[]>({
    queryKey: ["adj", activeCode ?? "all"],
    enabled: allowedBookings !== undefined,
    queryFn: async () => {
      const { data } = await supabase
        .from("adjustments")
        .select(
          "adjustment_id, booking_id, client_name, unit_id, asset_description, approved_value, realized_value, company_loss_gain, approval_date, status",
        )
        .order("approval_date", { ascending: false, nullsFirst: false });
      const list = (data ?? []) as AdjustmentRow[];
      if (!allowedBookings) return list;
      return list.filter((r) => r.booking_id && allowedBookings.has(r.booking_id));
    },
  });

  const summary = useMemo(() => {
    let approved = 0;
    let realized = 0;
    let pendingApproved = 0;
    let loss = 0;
    let gain = 0;
    for (const r of rows) {
      const s = String(r.status ?? "").toUpperCase();
      const av = num(r.approved_value);
      const rv = num(r.realized_value);
      const lg = num(r.company_loss_gain);
      // Approved credit only counts when it still credits the client
      // (WAIVED rows are reversed and no longer act as a credit).
      if (s !== "WAIVED") approved += av;
      if (s === "REALIZED") {
        realized += rv;
        if (lg > 0) gain += lg;
        else if (lg < 0) loss += Math.abs(lg);
      }
      if (s === "PENDING") pendingApproved += av;
    }
    return {
      approved,
      realized,
      pendingApproved,
      loss,
      gain,
      net: gain - loss,
    };
  }, [rows]);

  const columns: Column<AdjustmentRow>[] = [
    {
      key: "id",
      header: "Adj ID",
      cell: (r) => <span className="font-mono text-xs text-primary">{r.adjustment_id}</span>,
    },
    {
      key: "bk",
      header: "Booking",
      cell: (r) => (
        <Link
          to={`/bookings/${r.booking_id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {r.booking_id}
        </Link>
      ),
    },
    {
      key: "client",
      header: "Client",
      cell: (r) => <span className="capitalize">{r.client_name}</span>,
    },
    {
      key: "unit",
      header: "Unit",
      cell: (r) => <span className="font-mono text-xs">{r.unit_id}</span>,
    },
    {
      key: "asset",
      header: "Asset Description",
      cell: (r) => r.asset_description,
    },
    {
      key: "appr",
      header: "Approved",
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtPKR(r.approved_value)}</span>,
    },
    {
      key: "real",
      header: "Realized",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {String(r.status).toUpperCase() === "REALIZED" ? fmtPKR(r.realized_value) : "—"}
        </span>
      ),
    },
    {
      key: "lg",
      header: "Loss / Gain",
      align: "right",
      cell: (r) => {
        if (String(r.status).toUpperCase() !== "REALIZED")
          return <span className="text-muted-foreground">—</span>;
        const v = num(r.company_loss_gain);
        return (
          <span
            className={`tabular-nums font-medium ${
              v < 0 ? "text-destructive" : v > 0 ? "text-success" : ""
            }`}
          >
            {fmtPKR(v)}
          </span>
        );
      },
    },
    {
      key: "date",
      header: "Approval Date",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{fmtDate(r.approval_date)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge label={String(r.status)} tone={statusToneFor(r.status) as any} />,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (r) => {
        const s = String(r.status).toUpperCase();
        if (s === "PENDING") {
          return (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 min-w-11 lg:h-8 lg:min-h-0 lg:min-w-0"
                onClick={() => setRealizeRow(r)}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Realize
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 min-w-11 lg:h-8 lg:min-h-0 lg:min-w-0"
                onClick={() => setWaiveRow(r)}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Waive
              </Button>
            </div>
          );
        }
        return <span className="text-xs text-muted-foreground">—</span>;
      },
    },
  ];

  const scope = activeProject
    ? `${activeProject.project_code} · ${activeProject.project_name}`
    : "All projects";

  if (accessDenied) {
    return (
      <div>
        <PageHeader title="Adjustments" description="Restricted view" />
        <AccessDenied
          title="Adjustment records are restricted"
          description="Loss/gain register data is only visible to admin, manager, and staff roles."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Adjustments / Asset Credits"
        description={`${scope} · ${rows.length} entries`}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Adjustment
          </Button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <SummaryCard label="Approved Credits" value={fmtPKR(summary.approved)} />
        <SummaryCard label="Realized" value={fmtPKR(summary.realized)} />
        <SummaryCard
          label="Pending (unrealized)"
          value={fmtPKR(summary.pendingApproved)}
          tone="warning"
        />
        <SummaryCard
          label="Company Loss"
          value={fmtPKR(summary.loss)}
          tone={summary.loss > 0 ? "danger" : undefined}
        />
        <SummaryCard
          label="Company Gain"
          value={fmtPKR(summary.gain)}
          tone={summary.gain > 0 ? "success" : undefined}
        />
        <SummaryCard
          label="Net Position"
          value={fmtPKR(summary.net)}
          tone={summary.net >= 0 ? "success" : "danger"}
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.adjustment_id}
        searchKeys={["adjustment_id", "booking_id", "client_name", "unit_id", "asset_description"]}
      />

      <AdjustmentFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <RealizeAdjustmentDialog
        open={!!realizeRow}
        onOpenChange={(v) => !v && setRealizeRow(null)}
        adjustment={realizeRow}
      />
      <WaiveAdjustmentDialog
        open={!!waiveRow}
        onOpenChange={(v) => !v && setWaiveRow(null)}
        adjustment={waiveRow}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger" | "warning";
}) {
  const toneCls =
    tone === "danger"
      ? "text-destructive"
      : tone === "success"
        ? "text-success"
        : tone === "warning"
          ? "text-warning"
          : "";
  return (
    <div className="card-elevated p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-1 tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}
