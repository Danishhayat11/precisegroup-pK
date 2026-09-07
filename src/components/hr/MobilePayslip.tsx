import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { Share2, Download, X } from "lucide-react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { fmtPKR, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// Mobile payslip preview + WhatsApp share.
//
// Renders at A5 portrait proportions (148:210) so the shared image looks
// clean when forwarded. We render to PNG via html-to-image and prefer
// `navigator.share({ files })` — falls back to a download otherwise so
// the user can still attach it in WhatsApp manually.

type Payslip = {
  id: string;
  basic_salary: number;
  allowances: number;
  gross_salary: number;
  working_days: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  half_days: number;
  late_days: number;
  deduction: number;
  net_salary: number;
  paid_at: string | null;
  hr_employees?: {
    full_name?: string | null;
    employee_id?: string | null;
    department?: string | null;
    designation?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
  } | null;
};

export function MobilePayslipSheet({
  open,
  onOpenChange,
  payslip,
  periodLabel,
  companyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payslip: Payslip | null;
  periodLabel: string;
  companyName?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  async function generatePng(): Promise<{ blob: Blob; filename: string } | null> {
    if (!cardRef.current) return null;
    // Pixel ratio 2 keeps the image crisp on WhatsApp compression.
    const dataUrl = await toPng(cardRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#ffffff",
    });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const name = payslip?.hr_employees?.full_name?.replace(/\s+/g, "-") ?? "payslip";
    return { blob, filename: `payslip-${name}-${periodLabel.replace(/\s+/g, "-")}.png` };
  }

  async function handleShare() {
    if (!payslip) return;
    setBusy(true);
    try {
      const out = await generatePng();
      if (!out) return;
      const file = new File([out.blob], out.filename, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          files: [file],
          title: "Payslip",
          text: `Payslip · ${payslip.hr_employees?.full_name ?? ""} · ${periodLabel}`,
        });
      } else {
        // Fallback: download so the user can attach it in WhatsApp.
        downloadBlob(out.blob, out.filename);
        toast.info("Payslip saved — attach it in WhatsApp");
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast.error(err?.message ?? "Could not share payslip");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    if (!payslip) return;
    setBusy(true);
    try {
      const out = await generatePng();
      if (!out) return;
      downloadBlob(out.blob, out.filename);
      toast.success("Payslip downloaded");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not save payslip");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] p-0 flex flex-col rounded-t-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="text-sm font-semibold">Payslip · {periodLabel}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={() => onOpenChange(false)}
            aria-label="Close payslip"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto bg-muted/30 p-4">
          {payslip && (
            <div
              ref={cardRef}
              // A5 portrait proportions — width fills the sheet, height
              // follows 210/148 ratio so screenshots look print-ready.
              className={cn(
                "mx-auto bg-white text-slate-900 shadow-md rounded-lg overflow-hidden",
                "aspect-[148/210] max-w-[420px] w-full",
              )}
              style={{ fontFamily: "system-ui, sans-serif" }}
            >
              <PayslipContent
                payslip={payslip}
                periodLabel={periodLabel}
                companyName={companyName}
              />
            </div>
          )}
        </div>

        <div
          className="border-t border-border bg-background px-4 py-3 grid grid-cols-2 gap-2"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={handleDownload}
            disabled={busy || !payslip}
          >
            <Download className="h-4 w-4 mr-2" aria-hidden="true" />
            Save PNG
          </Button>
          <Button
            type="button"
            className="min-h-11 bg-success text-success-foreground hover:bg-success/90"
            onClick={handleShare}
            disabled={busy || !payslip}
          >
            <Share2 className="h-4 w-4 mr-2" aria-hidden="true" />
            {busy ? "Preparing…" : "Share to WhatsApp"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Payslip layout is kept inline (no theme tokens) because it renders into a
// PNG independently of the app theme.
function PayslipContent({
  payslip,
  periodLabel,
  companyName,
}: {
  payslip: Payslip;
  periodLabel: string;
  companyName?: string;
}) {
  const emp = payslip.hr_employees;
  return (
    <div className="p-5 flex flex-col h-full text-[11px]">
      <div className="text-center pb-3 border-b border-gray-300">
        <div className="text-base font-bold uppercase tracking-wide">
          {companyName ?? "Payslip"}
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5">Salary Slip · {periodLabel}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-3">
        <Row label="Employee" value={emp?.full_name ?? "—"} />
        <Row label="Employee ID" value={emp?.employee_id ?? "—"} mono />
        <Row label="Designation" value={emp?.designation ?? "—"} />
        <Row label="Department" value={emp?.department ?? "—"} />
        <Row label="Bank" value={emp?.bank_name ?? "—"} />
        <Row label="Account" value={emp?.bank_account ?? "—"} mono />
      </div>

      <div className="mt-4 border-t border-gray-300 pt-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
          Attendance
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <Mini label="Days" value={String(payslip.working_days)} />
          <Mini label="Present" value={String(payslip.present_days)} />
          <Mini label="Absent" value={String(payslip.absent_days)} />
          <Mini label="Leave" value={String(payslip.leave_days)} />
        </div>
      </div>

      <div className="mt-4 border-t border-gray-300 pt-3 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
          Earnings & Deductions
        </div>
        <LineRow label="Basic Salary" value={fmtPKR(payslip.basic_salary)} />
        <LineRow label="Allowances" value={fmtPKR(payslip.allowances)} />
        <LineRow label="Gross Salary" value={fmtPKR(payslip.gross_salary)} bold />
        <LineRow
          label="Deductions"
          value={payslip.deduction > 0 ? `- ${fmtPKR(payslip.deduction)}` : "—"}
        />
      </div>

      <div className="mt-3 rounded-md bg-slate-900 text-white px-3 py-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide">Net Payable</span>
        <span className="text-lg font-bold tabular-nums">{fmtPKR(payslip.net_salary)}</span>
      </div>

      <div className="mt-3 text-center text-[9px] text-slate-500">
        {payslip.paid_at ? `Paid on ${fmtDate(payslip.paid_at)}` : "Payment pending"}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("text-[11px] font-medium truncate", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 p-1.5">
      <div className="text-[9px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

function LineRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-1",
        bold && "border-t border-b border-gray-300 my-1 font-semibold",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
