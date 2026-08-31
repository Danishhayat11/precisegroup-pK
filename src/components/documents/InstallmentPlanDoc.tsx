import { useEffect } from "react";
import {
  DocumentHeader,
  DocumentFooter,
  DocumentSheet,
  type DocumentBranding,
} from "./DocumentChrome";
import type { PlanProjection, PlanRow, PlanRowStatus } from "@/lib/planProjection";
import { injectPlanPrintStyles } from "@/lib/print/planPrintStyles";
import { fmtDate, fmtPKR, maskCNIC } from "@/lib/format";

const STATUS_STYLE: Record<PlanRowStatus, { bg: string; fg: string; label: string }> = {
  PAID: { bg: "hsl(142 71% 45% / 0.15)", fg: "hsl(142 71% 30%)", label: "PAID" },
  PARTIAL: { bg: "hsl(38 92% 50% / 0.18)", fg: "hsl(31 90% 35%)", label: "PARTIAL" },
  UNPAID: { bg: "hsl(220 14% 90%)", fg: "hsl(220 10% 30%)", label: "UNPAID" },
  OVERDUE: { bg: "hsl(0 84% 60% / 0.15)", fg: "hsl(0 74% 42%)", label: "OVERDUE" },
  UPCOMING: { bg: "hsl(210 90% 55% / 0.14)", fg: "hsl(210 80% 38%)", label: "UPCOMING" },
};

function StatusPill({ status }: { status: PlanRowStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="status-pill"
      style={{
        background: s.bg,
        color: s.fg,
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.03em",
      }}
    >
      {s.label}
    </span>
  );
}

export interface InstallmentPlanDocProps {
  booking: any;
  projection: PlanProjection;
  branding: DocumentBranding;
  planNo?: string;
  issueDate?: string;
}

export default function InstallmentPlanDoc({
  booking,
  projection,
  branding,
  planNo,
  issueDate,
}: InstallmentPlanDocProps) {
  useEffect(() => injectPlanPrintStyles(), []);

  const b = booking ?? {};
  const s = projection.summary;
  const today = issueDate ?? new Date().toISOString().slice(0, 10);
  const derivedPlanNo =
    planNo ?? `PLAN-${String(b.booking_id ?? "").replace(/^BK-?/i, "") || "0001"}`;

  return (
    <DocumentSheet className="plan-doc-print p-4 text-[13px]">
      <DocumentHeader
        branding={branding}
        docTitle="INSTALLMENT PAYMENT PLAN"
        docSubtitle={`Plan No: ${derivedPlanNo}   |   Issue Date: ${fmtDate(today)}`}
      />

      {/* Client + booking info grid */}
      <div className="grid grid-cols-4 gap-2 mt-3 text-[11px]">
        {[
          ["CLIENT NAME", b.client_name],
          ["CNIC", maskCNIC(b.cnic ?? "")],
          ["MOBILE", b.mobile ?? "—"],
          ["BOOKING ID", b.booking_id],
          ["BOOKING DATE", b.booking_date ? fmtDate(b.booking_date) : "—"],
          ["PROJECT", b.project_name ?? branding.projectDisplayName],
          ["UNIT", b.unit_id],
          ["COVERED AREA", b.size_sqft ? `${b.size_sqft} sqft` : "—"],
        ].map(([label, val]) => (
          <div key={label as string} className="border border-border rounded-md px-2 py-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="text-[12px] font-semibold text-foreground truncate">
              {(val as any) || "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Overdue banner */}
      {s.overdueCount > 0 && (
        <div
          className="plan-overdue-banner mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 flex items-center justify-between text-[12px]"
          style={{ borderColor: "hsl(0 74% 60%)", background: "hsl(0 84% 60% / 0.08)" }}
        >
          <div className="font-semibold text-red-700">
            {s.overdueCount} overdue installment{s.overdueCount > 1 ? "s" : ""}
          </div>
          <div className="font-bold text-red-700">Total Overdue: {fmtPKR(s.overdueAmount)}</div>
        </div>
      )}

      {/* Schedule table */}
      <table className="plan-schedule mt-3 w-full text-[12px]">
        <thead>
          <tr>
            <th className="w-[6%] text-left">#</th>
            <th className="text-left">Description</th>
            <th className="w-[14%] text-left">Due Date</th>
            <th className="w-[14%] text-right">Amount (PKR)</th>
            <th className="w-[12%] text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {projection.rows.map((r: PlanRow) => (
            <tr
              key={r.key}
              style={r.status === "OVERDUE" ? { background: "hsl(0 84% 60% / 0.06)" } : undefined}
            >
              <td className="font-semibold">{r.seq}</td>
              <td>
                {r.particulars}
                {r.status === "OVERDUE" && r.daysOverdue > 0 ? (
                  <span className="ml-1 text-[10px] font-semibold text-red-600">
                    ({r.daysOverdue}d late)
                  </span>
                ) : null}
              </td>
              <td>{r.dueDate ? fmtDate(r.dueDate) : "—"}</td>
              <td className="text-right tabular-nums font-semibold">{fmtPKR(r.dueAmount)}</td>
              <td className="text-center">
                <StatusPill status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="text-right">
              TOTAL CONTRACT VALUE
            </td>
            <td className="text-right tabular-nums">{fmtPKR(s.contractValue)}</td>
            <td />
          </tr>
          <tr>
            <td colSpan={3} className="text-right">
              CASH RECEIVED
            </td>
            <td className="text-right tabular-nums" style={{ color: "hsl(142 71% 30%)" }}>
              {fmtPKR(s.cashReceived)}
            </td>
            <td />
          </tr>
          <tr>
            <td colSpan={3} className="text-right">
              REMAINING BALANCE
            </td>
            <td className="text-right tabular-nums" style={{ color: "hsl(0 74% 42%)" }}>
              {fmtPKR(s.remainingBalance)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>

      {/* Summary cards */}
      <div className="plan-summary-grid grid grid-cols-4 gap-2 mt-3 text-[11px]">
        {[
          ["Installments", `${s.installmentsPaid} / ${s.installmentsTotal}`],
          ["Overdue", `${s.overdueCount}  •  ${fmtPKR(s.overdueAmount)}`],
          ["Upcoming", `${s.upcomingCount}  •  ${fmtPKR(s.upcomingAmount)}`],
          ["Possession Balance", fmtPKR(s.possessionBalance)],
        ].map(([label, val]) => (
          <div key={label} className="border border-border rounded-md px-2 py-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="text-[13px] font-bold text-foreground">{val}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
        {(["PAID", "PARTIAL", "UNPAID", "OVERDUE", "UPCOMING"] as PlanRowStatus[]).map((k) => (
          <div key={k} className="flex items-center gap-1">
            <StatusPill status={k} />
          </div>
        ))}
      </div>

      {/* Terms */}
      <div className="mt-3 text-[10px] leading-snug text-muted-foreground border-t border-border pt-2">
        Payment is valid only when credited to the Company&apos;s official bank account. Receipts
        are subject to bank clearance. Unauthorised cash or third-party payments are not accepted.
        Report any discrepancy to the Accounts Office within seven (7) days. This plan supersedes
        any prior schedule for the same booking.
      </div>

      {/* Signatures */}
      <div className="grid grid-cols-3 gap-6 mt-6 text-[11px]">
        {["Received By", "Authorized Signatory", "Client Signature"].map((label) => (
          <div key={label}>
            <div className="border-t border-foreground/80 pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
          </div>
        ))}
      </div>

      <DocumentFooter branding={branding} />
    </DocumentSheet>
  );
}
