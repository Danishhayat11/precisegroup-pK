/* allow-raw-color-file: maintenance status/category/report chips use amber/emerald/red/orange/purple/blue palette pending status-token migration (matches AuditLog/Dashboard/Documents exemptions) */
/* Maintenance module — schedules, charges ledger, payment collection with
   printable receipts, building expense tracker, WhatsApp reminders, reports. */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Wrench,
  Printer,
  MessageCircle,
  Ban,
  Loader2,
  AlertCircle,
  Receipt as ReceiptIcon,
  FileText,
  Send,
  Trash2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileMaintenance } from "@/components/maintenance/MobileMaintenance";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge as SharedStatusBadge, statusTone } from "@/components/StatusBadge";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fmtDate, fmtPKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { callRpc } from "@/integrations/supabase/approvedRpc";

// ============================================================
// Types
// ============================================================
type ChargeType = "Monthly" | "Quarterly" | "Annually" | "One-Time";
type ApplicableTo =
  | "All Units"
  | "Apartments Only"
  | "Shops Only"
  | "Offices Only"
  | "Custom Selection";
type ChargeStatus = "Paid" | "Overdue" | "Due Soon" | "Upcoming" | "Partial" | "Waived";
type PayMode = "Cash" | "Cheque" | "Online Transfer" | "Bank Draft";

const EXPENSE_CATEGORIES = [
  "Lift/Elevator Repair",
  "Generator Maintenance",
  "Water Pump",
  "Common Area Cleaning",
  "Plumbing Repair",
  "Electrical Repair",
  "Painting/Whitewash",
  "Security Services",
  "Gardening/Landscaping",
  "Roof Repair",
  "Building Insurance",
  "Other",
] as const;

const PAY_MODES: PayMode[] = ["Cash", "Cheque", "Online Transfer", "Bank Draft"];
const CHARGE_TYPES: ChargeType[] = ["Monthly", "Quarterly", "Annually", "One-Time"];
const APPLICABLE_TO: ApplicableTo[] = [
  "All Units",
  "Apartments Only",
  "Shops Only",
  "Offices Only",
  "Custom Selection",
];

type Schedule = {
  id: string;
  project_code: string;
  charge_name: string;
  charge_type: ChargeType;
  fixed_amount: number | null;
  amount_per_sqft: number | null;
  applicable_to: ApplicableTo;
  custom_unit_ids: string[];
  effective_from: string;
  due_day: number | null;
  late_fee: number;
  grace_period_days: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

type Charge = {
  id: string;
  charge_id: string;
  schedule_id: string;
  unit_id: string;
  booking_id: string | null;
  project_code: string;
  project_name: string | null;
  client_name: string | null;
  charge_name: string;
  period: string;
  period_start: string;
  amount_due: number;
  late_fee: number;
  total_due: number;
  due_date: string;
  paid_amount: number;
  paid_date: string | null;
  balance: number;
  status: ChargeStatus;
  waived: boolean;
};

type Payment = {
  id: string;
  receipt_no: string;
  charge_id: string;
  unit_id: string;
  client_name: string | null;
  amount_paid: number;
  payment_date: string;
  payment_mode: PayMode;
  reference_no: string | null;
  received_by: string | null;
  late_fee_waived: boolean;
  notes: string | null;
  created_at: string;
};

type Expense = {
  id: string;
  expense_no: string;
  project_code: string | null;
  date: string;
  category: string;
  description: string | null;
  vendor: string | null;
  amount: number;
  paid_by: string | null;
  reference_no: string | null;
  notes: string | null;
  created_at: string;
};

// ============================================================
// Root Page with Tabs
// ============================================================
export default function MaintenancePage() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<string>("ledger");

  if (isMobile) return <MobileMaintenance />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        description="Recurring maintenance charges, receipts and building expenses."
      />
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="ledger" className="space-y-4">
          <LedgerTab />
        </TabsContent>
        <TabsContent value="schedules" className="space-y-4">
          <SchedulesTab />
        </TabsContent>
        <TabsContent value="expenses" className="space-y-4">
          <ExpensesTab />
        </TabsContent>
        <TabsContent value="reports" className="space-y-4">
          <ReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Shared queries
// ============================================================
function useProjects() {
  return useQuery({
    queryKey: ["mx-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("project_code, project_name")
        .order("project_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useUnits(projectCode?: string) {
  return useQuery({
    queryKey: ["mx-units", projectCode ?? "all"],
    queryFn: async () => {
      let q = supabase.from("units").select("unit_id, unit_no, unit_type, project_code, size_sqft");
      if (projectCode) q = q.eq("project_code", projectCode);
      const { data, error } = await q.order("unit_no");
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ============================================================
// Status badge — delegates to the shared design-system badge so
// Maintenance renders the same pill shape and semantic tokens as
// Bookings, Payments, Ledger, HR, CRM. "Waived" maps to adjustment.
// ============================================================
function StatusBadge({ status }: { status: ChargeStatus }) {
  return <SharedStatusBadge label={status} tone={statusTone(status)} />;
}

// ============================================================
// PART B — LEDGER TAB
// ============================================================
function LedgerTab() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data: projects = [] } = useProjects();
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>(""); // YYYY-MM
  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
  const [waiveCharge, setWaiveCharge] = useState<Charge | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [receiptFor, setReceiptFor] = useState<{
    payment: Payment;
    charge: Charge;
    projectName?: string;
  } | null>(null);

  const chargesQ = useQuery({
    queryKey: ["mx-charges", projectFilter, statusFilter, monthFilter],
    queryFn: async () => {
      let q = supabase
        .from("maintenance_charges")
        .select("*")
        .order("due_date", { ascending: false })
        .limit(2000);
      if (projectFilter !== "all") q = q.eq("project_code", projectFilter);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (monthFilter) {
        const start = `${monthFilter}-01`;
        const [y, m] = monthFilter.split("-").map(Number);
        const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
        q = q.gte("due_date", start).lt("due_date", nextMonth);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Charge[];
    },
  });

  const rows = chargesQ.data ?? [];

  // Summary cards — based on due_date this month
  const thisMonth = new Date().toISOString().slice(0, 7);
  const summary = useMemo(() => {
    const monthRows = rows.filter((r) => r.due_date?.startsWith(thisMonth));
    const billed = monthRows.reduce((s, r) => s + Number(r.total_due), 0);
    const collected = monthRows.reduce((s, r) => s + Number(r.paid_amount), 0);
    const outstanding = rows.filter((r) => !r.waived).reduce((s, r) => s + Number(r.balance), 0);
    const overdueCount = rows.filter((r) => r.status === "Overdue").length;
    return { billed, collected, outstanding, overdueCount };
  }, [rows, thisMonth]);

  const waiveMutation = useMutation({
    mutationFn: async () => {
      if (!waiveCharge) return;
      const { error } = await callRpc("waive_maintenance_charge", {
        _charge_id: waiveCharge.charge_id,
        _reason: waiveReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Charge waived");
      qc.invalidateQueries({ queryKey: ["mx-charges"] });
      setWaiveCharge(null);
      setWaiveReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const overdueRows = rows.filter((r) => r.status === "Overdue");

  const columns: Column<Charge>[] = [
    {
      key: "charge_id",
      header: "Charge ID",
      cell: (r) => <span className="font-mono text-xs">{r.charge_id}</span>,
    },
    { key: "period", header: "Period", cell: (r) => r.period },
    { key: "project_name", header: "Project", cell: (r) => r.project_name ?? r.project_code },
    { key: "unit_id", header: "Unit", cell: (r) => r.unit_id },
    { key: "client_name", header: "Client", cell: (r) => r.client_name ?? "—" },
    { key: "charge_name", header: "Charge", cell: (r) => r.charge_name },
    { key: "amount_due", header: "Amount Due", align: "right", cell: (r) => fmtPKR(r.amount_due) },
    { key: "late_fee", header: "Late Fee", align: "right", cell: (r) => fmtPKR(r.late_fee) },
    {
      key: "total_due",
      header: "Total Due",
      align: "right",
      cell: (r) => <span className="font-medium">{fmtPKR(r.total_due)}</span>,
    },
    { key: "due_date", header: "Due", cell: (r) => fmtDate(r.due_date) },
    {
      key: "paid_date",
      header: "Paid Date",
      cell: (r) => (r.paid_date ? fmtDate(r.paid_date) : "—"),
    },
    { key: "paid_amount", header: "Paid", align: "right", cell: (r) => fmtPKR(r.paid_amount) },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      cell: (r) => (
        <span className={r.balance > 0 ? "text-orange-600 dark:text-orange-400 font-medium" : ""}>
          {fmtPKR(r.balance)}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "Actions",
      cell: (r) => (
        <div className="flex items-center gap-1 justify-end">
          {(r.status === "Overdue" || r.status === "Due Soon" || r.status === "Partial") && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 px-2"
              onClick={() => setSelectedCharge(r)}
            >
              <ReceiptIcon className="h-3.5 w-3.5 mr-1" /> Collect
            </Button>
          )}
          {r.status === "Overdue" && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11 p-0"
              title="WhatsApp reminder"
              onClick={() => sendWhatsappReminder(r)}
            >
              <MessageCircle className="h-4 w-4 text-green-600" />
            </Button>
          )}
          {isAdmin && !r.waived && r.status !== "Paid" && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11 p-0"
              title="Waive"
              onClick={() => setWaiveCharge(r)}
            >
              <Ban className="h-4 w-4 text-purple-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Billed This Month" value={fmtPKR(summary.billed)} tone="blue" />
        <SummaryCard label="Collected This Month" value={fmtPKR(summary.collected)} tone="green" />
        <SummaryCard label="Total Outstanding" value={fmtPKR(summary.outstanding)} tone="orange" />
        <SummaryCard label="Overdue Charges" value={String(summary.overdueCount)} tone="red" />
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.project_code} value={p.project_code}>
                  {p.project_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(
                ["Paid", "Overdue", "Due Soon", "Upcoming", "Partial", "Waived"] as ChargeStatus[]
              ).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="w-40"
            placeholder="Month"
          />
          {monthFilter && (
            <Button size="sm" variant="ghost" onClick={() => setMonthFilter("")}>
              Clear month
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {overdueRows.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => sendBulkReminders(overdueRows)}>
                <Send className="h-4 w-4 mr-1" /> Send Bulk Reminder ({overdueRows.length})
              </Button>
            )}
          </div>
        </div>
      </Card>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        searchKeys={["unit_id", "client_name", "charge_id", "project_name"]}
        loading={chargesQ.isLoading}
        pageSize={25}
        emptyTitle="No maintenance charges"
        emptyDescription="Set up a schedule under the Schedules tab to auto-generate charges."
      />

      {/* Collect Payment dialog */}
      {selectedCharge && (
        <CollectPaymentDialog
          charge={selectedCharge}
          onClose={() => setSelectedCharge(null)}
          onCollected={(p, c) => {
            const proj = projects.find((x) => x.project_code === c.project_code);
            setSelectedCharge(null);
            qc.invalidateQueries({ queryKey: ["mx-charges"] });
            setReceiptFor({ payment: p, charge: c, projectName: proj?.project_name });
          }}
          isAdmin={isAdmin}
        />
      )}

      {/* Waive confirm */}
      <AlertDialog open={!!waiveCharge} onOpenChange={(o) => !o && setWaiveCharge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Waive maintenance charge</AlertDialogTitle>
            <AlertDialogDescription>
              This marks <span className="font-mono">{waiveCharge?.charge_id}</span> as Waived and
              clears its balance. Enter a reason for the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Label htmlFor="waive-reason">Reason</Label>
            <Textarea
              id="waive-reason"
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!waiveReason.trim() || waiveMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                waiveMutation.mutate();
              }}
            >
              {waiveMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Waive charge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print receipt */}
      {receiptFor && <ReceiptDialog {...receiptFor} onClose={() => setReceiptFor(null)} />}
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
  tone: "blue" | "green" | "orange" | "red";
}) {
  const tones: Record<string, string> = {
    blue: "border-blue-500/30 bg-blue-500/5",
    green: "border-emerald-500/30 bg-emerald-500/5",
    orange: "border-orange-500/30 bg-orange-500/5",
    red: "border-red-500/30 bg-red-500/5",
  };
  return (
    <Card className={cn("p-4 border", tones[tone])}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
}

// ============================================================
// PART E — WhatsApp
// ============================================================
function whatsappUrlFor(c: Charge, mobile?: string | null): string {
  const msg = `Assalam o Alaikum ${c.client_name ?? "Client"} sahib,

Hope you are well. This is a gentle reminder that your maintenance charges for Unit ${c.unit_id}, ${c.project_name ?? c.project_code} for the period ${c.period} amounting to PKR ${fmtPKR(Number(c.total_due))} were due on ${c.due_date}.

Kindly arrange payment at your earliest convenience to avoid late fee charges.

For any queries please contact us.

Regards,
Precise Realtors & Builders`;
  const cleaned = (mobile ?? "").replace(/[^\d]/g, "");
  const base = cleaned ? `https://wa.me/${cleaned}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(msg)}`;
}

async function sendWhatsappReminder(c: Charge) {
  // Fetch mobile from booking → client
  let mobile: string | null = null;
  if (c.booking_id) {
    const { data } = await supabase
      .from("bookings")
      .select("mobile")
      .eq("booking_id", c.booking_id)
      .maybeSingle();
    mobile = (data as { mobile: string | null } | null)?.mobile ?? null;
  }
  window.open(whatsappUrlFor(c, mobile), "_blank", "noopener");
}

async function sendBulkReminders(rows: Charge[]) {
  if (!confirm(`Open WhatsApp for ${rows.length} overdue clients, one by one?`)) return;
  for (const r of rows) {
    // Small delay so popups aren't blocked; user must allow multiple popups
    await new Promise((res) => setTimeout(res, 300));
    await sendWhatsappReminder(r);
  }
}

// ============================================================
// PART C — Collect Payment Dialog
// ============================================================
function CollectPaymentDialog({
  charge,
  onClose,
  onCollected,
  isAdmin,
}: {
  charge: Charge;
  onClose: () => void;
  onCollected: (p: Payment, c: Charge) => void;
  isAdmin: boolean;
}) {
  const [amount, setAmount] = useState<string>(String(Number(charge.balance) || charge.total_due));
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<PayMode>("Cash");
  const [ref, setRef] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [waiveLate, setWaiveLate] = useState(false);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      setErr(null);
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be greater than zero");
      if (
        (mode === "Cheque" || mode === "Online Transfer" || mode === "Bank Draft") &&
        !ref.trim()
      ) {
        throw new Error("Reference No is required for this payment mode");
      }
      const insertRow = {
        charge_id: charge.charge_id,
        unit_id: charge.unit_id,
        client_name: charge.client_name,
        amount_paid: amt,
        payment_date: payDate,
        payment_mode: mode,
        reference_no: ref.trim() || null,
        received_by: receivedBy.trim() || null,
        late_fee_waived: isAdmin ? waiveLate : false,
        notes: notes.trim() || null,
      };
      const { data, error } = await supabase
        .from("maintenance_payments")
        .insert(insertRow)
        .select("*")
        .single();
      if (error) throw error;
      // Refetch parent charge so receipt shows fresh balance
      const { data: refreshed } = await supabase
        .from("maintenance_charges")
        .select("*")
        .eq("charge_id", charge.charge_id)
        .single();
      return { payment: data as Payment, charge: (refreshed ?? charge) as Charge };
    },
    onSuccess: ({ payment, charge: c }) => {
      toast.success(`Receipt ${payment.receipt_no} saved`);
      onCollected(payment, c);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const effectiveTotal = charge.amount_due + (waiveLate ? 0 : charge.late_fee);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Collect Maintenance Payment</DialogTitle>
          <DialogDescription>
            Charge {charge.charge_id} · {charge.period}
          </DialogDescription>
        </DialogHeader>

        {err && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <ReadonlyField label="Unit ID" value={charge.unit_id} />
          <ReadonlyField label="Client" value={charge.client_name ?? "—"} />
          <ReadonlyField label="Period" value={charge.period} />
          <ReadonlyField label="Amount Due" value={fmtPKR(charge.amount_due)} />
          <ReadonlyField label="Late Fee" value={fmtPKR(waiveLate ? 0 : charge.late_fee)} />
          <ReadonlyField label="Total Due" value={fmtPKR(effectiveTotal)} highlight />

          <div className="col-span-2">
            <Label htmlFor="amt">Amount Received (PKR)*</Label>
            <Input
              id="amt"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="pd">Payment Date</Label>
            <Input
              id="pd"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </div>
          <div>
            <Label>Payment Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as PayMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ref">Reference No{mode !== "Cash" ? "*" : ""}</Label>
            <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rb">Received By</Label>
            <Input
              id="rb"
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
              placeholder="Staff name"
            />
          </div>

          {isAdmin && charge.late_fee > 0 && (
            <div className="col-span-2 flex items-center gap-3">
              <Switch id="wlf" checked={waiveLate} onCheckedChange={setWaiveLate} />
              <Label htmlFor="wlf" className="cursor-pointer">
                Waive late fee ({fmtPKR(charge.late_fee)}) — admin only
              </Label>
            </div>
          )}

          <div className="col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save & Generate Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReadonlyField({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-sm",
          highlight && "font-semibold",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ============================================================
// Receipt Print Dialog
// ============================================================
function ReceiptDialog({
  payment,
  charge,
  projectName,
  onClose,
}: {
  payment: Payment;
  charge: Charge;
  projectName?: string;
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const balance = Number(charge.balance);

  const handlePrint = () => {
    const html = printRef.current?.outerHTML ?? "";
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Receipt ${payment.receipt_no}</title>
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;color:#111;padding:24px;}
        h1{font-size:20px;margin:0 0 4px 0}
        h2{font-size:14px;margin:0;color:#555;font-weight:normal}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        td{padding:6px 8px;border-bottom:1px solid #eee;font-size:13px}
        .label{color:#666;width:40%}
        .total{font-size:16px;font-weight:600;background:#f5f5f5}
        .footer{margin-top:32px;padding-top:16px;border-top:1px solid #ddd;text-align:center;color:#666;font-size:12px}
      </style></head><body>${html}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 200);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Maintenance Receipt</DialogTitle>
        </DialogHeader>

        <div ref={printRef}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <h1 style={{ margin: 0 }}>Precise Realtors &amp; Builders</h1>
            <h2 style={{ margin: 0, color: "#555", fontWeight: "normal" }}>Maintenance Receipt</h2>
          </div>
          <table>
            <tbody>
              <tr>
                <td className="label">Receipt No</td>
                <td>
                  <strong>{payment.receipt_no}</strong>
                </td>
              </tr>
              <tr>
                <td className="label">Date</td>
                <td>{fmtDate(payment.payment_date)}</td>
              </tr>
              <tr>
                <td className="label">Client</td>
                <td>{charge.client_name ?? "—"}</td>
              </tr>
              <tr>
                <td className="label">Unit</td>
                <td>
                  {charge.unit_id} · {projectName ?? charge.project_code}
                </td>
              </tr>
              <tr>
                <td className="label">Charge Period</td>
                <td>
                  {charge.period} — {charge.charge_name}
                </td>
              </tr>
              <tr>
                <td className="label">Payment Mode</td>
                <td>
                  {payment.payment_mode}
                  {payment.reference_no ? ` — ${payment.reference_no}` : ""}
                </td>
              </tr>
              <tr className="total">
                <td className="label">Amount Paid</td>
                <td>
                  <strong>PKR {fmtPKR(Number(payment.amount_paid))}</strong>
                </td>
              </tr>
              {balance > 0 && (
                <tr>
                  <td className="label">Remaining Balance</td>
                  <td>PKR {fmtPKR(balance)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="footer">
            Thank you for your payment.
            <br />
            Precise Realtors &amp; Builders · Islamabad
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// PART A — SCHEDULES TAB
// ============================================================
function SchedulesTab() {
  const qc = useQueryClient();
  const { data: projects = [] } = useProjects();
  const [openNew, setOpenNew] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const schedQ = useQuery({
    queryKey: ["mx-schedules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_schedules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Schedule[];
    },
  });

  const generate = async (schedId: string) => {
    setGeneratingId(schedId);
    try {
      const today = new Date();
      const through = new Date(today.getFullYear(), today.getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10);
      const { data, error } = await callRpc("generate_maintenance_charges", {
        _schedule_id: schedId,
        _through: through,
      });
      if (error) throw error;
      toast.success(`Generated ${data ?? 0} new charge(s)`);
      qc.invalidateQueries({ queryKey: ["mx-charges"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGeneratingId(null);
    }
  };

  const rows = schedQ.data ?? [];
  const projMap = new Map(projects.map((p) => [p.project_code, p.project_name] as const));

  const columns: Column<Schedule>[] = [
    {
      key: "charge_name",
      header: "Charge Name",
      cell: (r) => <span className="font-medium">{r.charge_name}</span>,
    },
    {
      key: "project_code",
      header: "Project",
      cell: (r) => projMap.get(r.project_code) ?? r.project_code,
    },
    { key: "charge_type", header: "Type", cell: (r) => r.charge_type },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (r) => (r.fixed_amount ? fmtPKR(r.fixed_amount) : `${r.amount_per_sqft} PKR/sqft`),
    },
    { key: "applicable_to", header: "Applies To", cell: (r) => r.applicable_to },
    { key: "effective_from", header: "Effective From", cell: (r) => fmtDate(r.effective_from) },
    { key: "late_fee", header: "Late Fee", align: "right", cell: (r) => fmtPKR(r.late_fee) },
    { key: "is_active", header: "Active", cell: (r) => (r.is_active ? "Yes" : "No") },
    {
      key: "actions",
      header: "Actions",
      cell: (r) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => generate(r.id)}
          disabled={generatingId === r.id}
        >
          {generatingId === r.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
          Generate charges
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpenNew(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Schedule
        </Button>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={schedQ.isLoading}
        emptyTitle="No maintenance schedules"
        emptyDescription="Create a schedule to auto-generate monthly maintenance charges for units."
        emptyAction={
          <Button onClick={() => setOpenNew(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Schedule
          </Button>
        }
      />
      {openNew && (
        <ScheduleFormDialog
          projects={projects}
          onClose={() => setOpenNew(false)}
          onSaved={() => {
            setOpenNew(false);
            qc.invalidateQueries({ queryKey: ["mx-schedules"] });
          }}
        />
      )}
    </div>
  );
}

function ScheduleFormDialog({
  projects,
  onClose,
  onSaved,
}: {
  projects: { project_code: string; project_name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectCode, setProjectCode] = useState<string>("");
  const [chargeName, setChargeName] = useState("Monthly Maintenance Fee");
  const [chargeType, setChargeType] = useState<ChargeType>("Monthly");
  const [applicableTo, setApplicableTo] = useState<ApplicableTo>("All Units");
  const [customUnits, setCustomUnits] = useState<string[]>([]);
  const [fixed, setFixed] = useState("");
  const [perSqft, setPerSqft] = useState("");
  const [effFrom, setEffFrom] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dueDay, setDueDay] = useState<string>("1");
  const [lateFee, setLateFee] = useState<string>("0");
  const [grace, setGrace] = useState<string>("7");
  const [notes, setNotes] = useState("");
  const [autoGen, setAutoGen] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const { data: units = [] } = useUnits(projectCode || undefined);

  const mut = useMutation({
    mutationFn: async () => {
      setErr(null);
      if (!projectCode) throw new Error("Select a project");
      if (!chargeName.trim()) throw new Error("Charge name required");
      if (!fixed && !perSqft) throw new Error("Enter either a fixed amount or per-sqft rate");
      const insertRow = {
        project_code: projectCode,
        charge_name: chargeName.trim(),
        charge_type: chargeType,
        fixed_amount: fixed ? Number(fixed) : null,
        amount_per_sqft: perSqft ? Number(perSqft) : null,
        applicable_to: applicableTo,
        custom_unit_ids: applicableTo === "Custom Selection" ? customUnits : [],
        effective_from: effFrom,
        due_day: chargeType === "Monthly" ? Number(dueDay) : null,
        late_fee: Number(lateFee) || 0,
        grace_period_days: Number(grace) || 7,
        notes: notes.trim() || null,
        is_active: true,
      };
      const { data, error } = await supabase
        .from("maintenance_schedules")
        .insert(insertRow)
        .select("id")
        .single();
      if (error) throw error;
      if (autoGen) {
        const today = new Date();
        const through = new Date(today.getFullYear(), today.getMonth() + 1, 0)
          .toISOString()
          .slice(0, 10);
        const { error: e2 } = await callRpc("generate_maintenance_charges", {
          _schedule_id: data.id,
          _through: through,
        });
        if (e2) throw e2;
      }
    },
    onSuccess: () => {
      toast.success("Schedule saved");
      onSaved();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Maintenance Schedule</DialogTitle>
          <DialogDescription>
            Defines how a recurring charge is billed to units in a project.
          </DialogDescription>
        </DialogHeader>

        {err && (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Project*</Label>
            <Select value={projectCode} onValueChange={setProjectCode}>
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.project_code} value={p.project_code}>
                    {p.project_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Charge Name*</Label>
            <Input value={chargeName} onChange={(e) => setChargeName(e.target.value)} />
          </div>
          <div>
            <Label>Charge Type</Label>
            <Select value={chargeType} onValueChange={(v) => setChargeType(v as ChargeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHARGE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Applies To</Label>
            <Select value={applicableTo} onValueChange={(v) => setApplicableTo(v as ApplicableTo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPLICABLE_TO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fixed Amount (PKR)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={fixed}
              onChange={(e) => setFixed(e.target.value)}
              placeholder="e.g. 3000"
            />
          </div>
          <div>
            <Label>Amount / sqft (PKR)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={perSqft}
              onChange={(e) => setPerSqft(e.target.value)}
              placeholder="e.g. 5"
            />
          </div>
          <div>
            <Label>Effective From</Label>
            <Input type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} />
          </div>
          {chargeType === "Monthly" && (
            <div>
              <Label>Due Day of Month (1–28)</Label>
              <Input
                type="number"
                min="1"
                max="28"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
              />
            </div>
          )}
          <div>
            <Label>Late Fee (PKR)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={lateFee}
              onChange={(e) => setLateFee(e.target.value)}
            />
          </div>
          <div>
            <Label>Grace Period (days)</Label>
            <Input type="number" min="0" value={grace} onChange={(e) => setGrace(e.target.value)} />
          </div>
          {applicableTo === "Custom Selection" && (
            <div className="col-span-2">
              <Label>Select Units</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                {units.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Pick a project to load units.</div>
                ) : (
                  units.map((u) => (
                    <label key={u.unit_id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={customUnits.includes(u.unit_id)}
                        onChange={(e) =>
                          setCustomUnits((prev) =>
                            e.target.checked
                              ? [...prev, u.unit_id]
                              : prev.filter((x) => x !== u.unit_id),
                          )
                        }
                      />
                      {u.unit_no} <span className="text-muted-foreground">({u.unit_type})</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch id="autogen" checked={autoGen} onCheckedChange={setAutoGen} />
            <Label htmlFor="autogen" className="cursor-pointer">
              Auto-generate charges up to end of this month
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// PART D — EXPENSES TAB
// ============================================================
function ExpensesTab() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { data: projects = [] } = useProjects();
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  const expQ = useQuery({
    queryKey: ["mx-expenses", projectFilter],
    queryFn: async () => {
      let q = supabase.from("maintenance_expenses").select("*").order("date", { ascending: false });
      if (projectFilter !== "all") q = q.eq("project_code", projectFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Expense[];
    },
  });

  const paymentsQ = useQuery({
    queryKey: ["mx-payments-sum", projectFilter],
    queryFn: async () => {
      // Sum via charges join (client-side)
      const { data: charges } = await supabase
        .from("maintenance_charges")
        .select("charge_id, project_code");
      const relevantIds = new Set(
        (charges ?? [])
          .filter((c) => projectFilter === "all" || c.project_code === projectFilter)
          .map((c) => c.charge_id),
      );
      const { data: pays } = await supabase
        .from("maintenance_payments")
        .select("amount_paid, charge_id");
      const income = (pays ?? [])
        .filter((p) => relevantIds.has(p.charge_id))
        .reduce((s, p) => s + Number(p.amount_paid), 0);
      return income;
    },
  });

  const totalExpense = useMemo(
    () => (expQ.data ?? []).reduce((s, e) => s + Number(e.amount), 0),
    [expQ.data],
  );
  const income = paymentsQ.data ?? 0;
  const fund = income - totalExpense;

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("maintenance_expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense deleted");
      qc.invalidateQueries({ queryKey: ["mx-expenses"] });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: Column<Expense>[] = [
    {
      key: "expense_no",
      header: "No.",
      cell: (r) => <span className="font-mono text-xs">{r.expense_no}</span>,
    },
    { key: "date", header: "Date", cell: (r) => fmtDate(r.date) },
    { key: "project_code", header: "Project", cell: (r) => r.project_code ?? "—" },
    { key: "category", header: "Category", cell: (r) => r.category },
    { key: "vendor", header: "Vendor", cell: (r) => r.vendor ?? "—" },
    { key: "description", header: "Description", cell: (r) => r.description ?? "—" },
    { key: "amount", header: "Amount", align: "right", cell: (r) => fmtPKR(r.amount) },
    { key: "paid_by", header: "Paid By", cell: (r) => r.paid_by ?? "—" },
    ...(isAdmin
      ? [
          {
            key: "actions",
            header: "",
            cell: (r: Expense) => (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 min-w-11 p-0"
                onClick={() => setDeleteTarget(r)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            ),
          } as Column<Expense>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          "p-4 border-2",
          fund >= 0 ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Maintenance Fund
            </div>
            <div
              className={cn(
                "mt-1 text-2xl font-semibold",
                fund >= 0 ? "text-success" : "text-destructive",
              )}
            >
              PKR {fmtPKR(Math.abs(fund))} {fund >= 0 ? "Surplus" : "Deficit"}
            </div>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div>
              Income (collected):{" "}
              <span className="text-foreground font-medium">{fmtPKR(income)}</span>
            </div>
            <div>
              Expense (spent):{" "}
              <span className="text-foreground font-medium">{fmtPKR(totalExpense)}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.project_code} value={p.project_code}>
                {p.project_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setOpenNew(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Expense
          </Button>
        </div>
      </div>

      <DataTable
        rows={expQ.data ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        loading={expQ.isLoading}
        pageSize={25}
        emptyTitle="No maintenance expenses"
        emptyDescription="Record spending on lifts, generators, cleaning, and repairs to keep a running ledger."
        emptyAction={
          <Button onClick={() => setOpenNew(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Expense
          </Button>
        }
      />

      {openNew && (
        <ExpenseFormDialog
          projects={projects}
          onClose={() => setOpenNew(false)}
          onSaved={() => {
            setOpenNew(false);
            qc.invalidateQueries({ queryKey: ["mx-expenses"] });
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) delMut.mutate(deleteTarget.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExpenseFormDialog({
  projects,
  onClose,
  onSaved,
}: {
  projects: { project_code: string; project_name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [projectCode, setProjectCode] = useState<string>("");
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [refNo, setRefNo] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      setErr(null);
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt < 0) throw new Error("Amount required");
      const { error } = await supabase.from("maintenance_expenses").insert({
        date,
        project_code: projectCode || null,
        category,
        description: description.trim() || null,
        vendor: vendor.trim() || null,
        amount: amt,
        paid_by: paidBy.trim() || null,
        reference_no: refNo.trim() || null,
        notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense saved");
      onSaved();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Maintenance Expense</DialogTitle>
        </DialogHeader>

        {err && (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Project</Label>
            <Select value={projectCode} onValueChange={setProjectCode}>
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.project_code} value={p.project_code}>
                    {p.project_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label>Vendor / Contractor</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div>
            <Label>Amount (PKR)*</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label>Paid By</Label>
            <Input
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              placeholder="Cash / Bank name"
            />
          </div>
          <div>
            <Label>Reference No</Label>
            <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// PART F — REPORTS TAB
// ============================================================
function ReportsTab() {
  const [report, setReport] = useState<string>("monthly");
  const { data: projects = [] } = useProjects();
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [unitId, setUnitId] = useState<string>("");

  const handlePrint = () => window.print();

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={report} onValueChange={setReport}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly Collection Report</SelectItem>
              <SelectItem value="outstanding">Outstanding Report</SelectItem>
              <SelectItem value="unit">Unit-wise Statement</SelectItem>
              <SelectItem value="income-expense">Income vs Expense Summary</SelectItem>
            </SelectContent>
          </Select>
          {report === "monthly" && (
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-40"
            />
          )}
          {report === "unit" && (
            <Input
              placeholder="Unit ID"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className="w-48"
            />
          )}
          <div className="ml-auto">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        {report === "monthly" && <MonthlyCollectionReport month={month} projects={projects} />}
        {report === "outstanding" && <OutstandingReport projects={projects} />}
        {report === "unit" && <UnitStatementReport unitId={unitId} />}
        {report === "income-expense" && <IncomeExpenseReport projects={projects} />}
      </Card>
    </div>
  );
}

function MonthlyCollectionReport({
  month,
  projects,
}: {
  month: string;
  projects: { project_code: string; project_name: string }[];
}) {
  const q = useQuery({
    queryKey: ["mx-report-monthly", month],
    queryFn: async () => {
      const [y, m] = month.split("-").map(Number);
      const start = `${month}-01`;
      const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const { data, error } = await supabase
        .from("maintenance_charges")
        .select("*")
        .gte("due_date", start)
        .lt("due_date", end);
      if (error) throw error;
      return (data ?? []) as Charge[];
    },
  });
  const rows = q.data ?? [];
  const byProject = useMemo(() => {
    const g = new Map<string, Charge[]>();
    for (const r of rows) {
      const arr = g.get(r.project_code) ?? [];
      arr.push(r);
      g.set(r.project_code, arr);
    }
    return g;
  }, [rows]);
  const projName = new Map(projects.map((p) => [p.project_code, p.project_name] as const));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Monthly Collection — {month}</h2>
      {Array.from(byProject.entries()).map(([code, list]) => {
        const billed = list.reduce((s, r) => s + Number(r.total_due), 0);
        const collected = list.reduce((s, r) => s + Number(r.paid_amount), 0);
        return (
          <div key={code} className="space-y-1">
            <h3 className="font-medium">{projName.get(code) ?? code}</h3>
            <div className="text-sm text-muted-foreground">
              Billed {fmtPKR(billed)} · Collected {fmtPKR(collected)} · Balance{" "}
              {fmtPKR(billed - collected)}
            </div>
            <table className="w-full text-sm mt-2">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Charge</th>
                  <th>Unit</th>
                  <th>Client</th>
                  <th className="text-right">Due</th>
                  <th className="text-right">Paid</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1 font-mono text-xs">{r.charge_id}</td>
                    <td>{r.unit_id}</td>
                    <td>{r.client_name ?? "—"}</td>
                    <td className="text-right">{fmtPKR(r.total_due)}</td>
                    <td className="text-right">{fmtPKR(r.paid_amount)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {rows.length === 0 && (
        <div className="text-sm text-muted-foreground">No charges due in this month.</div>
      )}
    </div>
  );
}

function OutstandingReport({
  projects,
}: {
  projects: { project_code: string; project_name: string }[];
}) {
  const q = useQuery({
    queryKey: ["mx-report-outstanding"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_charges")
        .select("*")
        .gt("balance", 0)
        .order("due_date");
      if (error) throw error;
      return (data ?? []) as Charge[];
    },
  });
  const rows = q.data ?? [];
  const projName = new Map(projects.map((p) => [p.project_code, p.project_name] as const));
  const total = rows.reduce((s, r) => s + Number(r.balance), 0);
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">
        Outstanding as of {fmtDate(new Date().toISOString().slice(0, 10))}
      </h2>
      <div className="text-sm text-muted-foreground">
        Total Outstanding: <span className="text-foreground font-semibold">{fmtPKR(total)}</span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1">Charge</th>
            <th>Project</th>
            <th>Unit</th>
            <th>Client</th>
            <th>Due</th>
            <th className="text-right">Balance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="py-1 font-mono text-xs">{r.charge_id}</td>
              <td>{projName.get(r.project_code) ?? r.project_code}</td>
              <td>{r.unit_id}</td>
              <td>{r.client_name ?? "—"}</td>
              <td>{fmtDate(r.due_date)}</td>
              <td className="text-right font-medium">{fmtPKR(r.balance)}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="text-sm text-muted-foreground">No outstanding balances.</div>
      )}
    </div>
  );
}

function UnitStatementReport({ unitId }: { unitId: string }) {
  const q = useQuery({
    queryKey: ["mx-report-unit", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data: charges } = await supabase
        .from("maintenance_charges")
        .select("*")
        .eq("unit_id", unitId)
        .order("due_date");
      const chargeIds = (charges ?? []).map((c) => (c as Charge).charge_id);
      const { data: pays } = await supabase
        .from("maintenance_payments")
        .select("*")
        .in("charge_id", chargeIds.length ? chargeIds : ["__none__"]);
      return { charges: (charges ?? []) as Charge[], payments: (pays ?? []) as Payment[] };
    },
  });

  if (!unitId) return <div className="text-sm text-muted-foreground">Enter a Unit ID above.</div>;
  const charges = q.data?.charges ?? [];
  const payments = q.data?.payments ?? [];
  const paysByCharge = new Map<string, Payment[]>();
  for (const p of payments) {
    const arr = paysByCharge.get(p.charge_id) ?? [];
    arr.push(p);
    paysByCharge.set(p.charge_id, arr);
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Unit Statement — {unitId}</h2>
      {charges.map((c) => (
        <div key={c.id} className="border border-border rounded-md p-3">
          <div className="flex justify-between text-sm">
            <div>
              <span className="font-mono text-xs text-muted-foreground">{c.charge_id}</span> ·{" "}
              {c.charge_name} · {c.period}
            </div>
            <StatusBadge status={c.status} />
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Due {fmtDate(c.due_date)} · Total {fmtPKR(c.total_due)} · Paid {fmtPKR(c.paid_amount)} ·
            Balance {fmtPKR(c.balance)}
          </div>
          {paysByCharge.get(c.charge_id)?.map((p) => (
            <div key={p.id} className="text-xs mt-1 pl-3 border-l-2 border-success/40">
              {p.receipt_no} · {fmtDate(p.payment_date)} · {p.payment_mode} ·{" "}
              {fmtPKR(p.amount_paid)}
            </div>
          ))}
        </div>
      ))}
      {charges.length === 0 && !q.isLoading && (
        <div className="text-sm text-muted-foreground">No charges found for this unit.</div>
      )}
    </div>
  );
}

function IncomeExpenseReport({
  projects,
}: {
  projects: { project_code: string; project_name: string }[];
}) {
  const q = useQuery({
    queryKey: ["mx-report-ie"],
    queryFn: async () => {
      const { data: charges } = await supabase
        .from("maintenance_charges")
        .select("charge_id, project_code");
      const { data: pays } = await supabase
        .from("maintenance_payments")
        .select("charge_id, amount_paid, payment_date");
      const { data: exps } = await supabase
        .from("maintenance_expenses")
        .select("project_code, amount, date");
      const chargeProj = new Map(
        (charges ?? []).map((c) => [c.charge_id, c.project_code] as const),
      );
      const income: Record<string, Record<string, number>> = {};
      for (const p of pays ?? []) {
        const proj = chargeProj.get(p.charge_id) ?? "unknown";
        const m = (p.payment_date as string).slice(0, 7);
        income[proj] ??= {};
        income[proj][m] = (income[proj][m] ?? 0) + Number(p.amount_paid);
      }
      const expense: Record<string, Record<string, number>> = {};
      for (const e of exps ?? []) {
        const proj = (e.project_code as string) ?? "unknown";
        const m = (e.date as string).slice(0, 7);
        expense[proj] ??= {};
        expense[proj][m] = (expense[proj][m] ?? 0) + Number(e.amount);
      }
      return { income, expense };
    },
  });

  const income = q.data?.income ?? {};
  const expense = q.data?.expense ?? {};
  const allProjects = new Set([...Object.keys(income), ...Object.keys(expense)]);
  const projName = new Map(projects.map((p) => [p.project_code, p.project_name] as const));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Income vs Expense — by project × month</h2>
      {Array.from(allProjects).map((proj) => {
        const months = new Set([
          ...Object.keys(income[proj] ?? {}),
          ...Object.keys(expense[proj] ?? {}),
        ]);
        const sortedMonths = Array.from(months).sort().reverse();
        return (
          <div key={proj} className="space-y-1">
            <h3 className="font-medium">{projName.get(proj) ?? proj}</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Month</th>
                  <th className="text-right">Income</th>
                  <th className="text-right">Expense</th>
                  <th className="text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {sortedMonths.map((m) => {
                  const inc = income[proj]?.[m] ?? 0;
                  const exp = expense[proj]?.[m] ?? 0;
                  const net = inc - exp;
                  return (
                    <tr key={m} className="border-t border-border">
                      <td className="py-1">{m}</td>
                      <td className="text-right">{fmtPKR(inc)}</td>
                      <td className="text-right">{fmtPKR(exp)}</td>
                      <td
                        className={cn(
                          "text-right font-medium",
                          net >= 0 ? "text-success" : "text-destructive",
                        )}
                      >
                        {fmtPKR(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {allProjects.size === 0 && <div className="text-sm text-muted-foreground">No data yet.</div>}
    </div>
  );
}
