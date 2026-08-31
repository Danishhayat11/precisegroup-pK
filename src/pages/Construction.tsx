/* allow-raw-color-file: builds a standalone print-only HTML document in a new window that has no access to the app's CSS theme tokens */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { AlertTriangle, HardHat, Plus, Printer, Save, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileConstruction } from "@/components/construction/MobileConstruction";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { fmtDate, fmtPKR } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---- Domain constants ---------------------------------------------------
const CATEGORIES = [
  "Land Cost",
  "Foundation",
  "Structure/RCC",
  "Brickwork",
  "Plumbing",
  "Electrical",
  "Finishing",
  "Doors/Windows",
  "Tiles/Flooring",
  "Paint",
  "Elevator",
  "Generator",
  "CCTV/Security",
  "Landscaping",
  "Architecture Fee",
  "Engineering Fee",
  "Labour (Daily)",
  "Labour (Contract)",
  "Equipment Rental",
  "Other",
] as const;

const UNITS = ["Sft", "Cubic Ft", "Bags", "Nos", "LS", "Kg", "Ton", "Meter"] as const;
const PARTY_TYPES = ["Vendor", "Contractor"] as const;
const PAYMENT_MODES = ["Cash", "Online Transfer", "Cheque", "Bank Draft", "Credit"] as const;

type Cost = {
  id: string;
  project_code: string;
  cost_date: string;
  category: string;
  party_type: "Vendor" | "Contractor";
  party_name: string | null;
  work_description: string;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  amount: number;
  amount_paid: number;
  payment_mode: string | null;
  reference_no: string | null;
  notes: string | null;
  created_at: string;
};

type Budget = {
  project_code: string;
  approved_budget: number;
  progress_percent: number;
  notes: string | null;
};

// ---- Form schema --------------------------------------------------------
const costSchema = z.object({
  project_code: z.string().min(1, "Project is required"),
  cost_date: z.string().min(1, "Date is required"),
  category: z
    .string()
    .refine((v) => (CATEGORIES as readonly string[]).includes(v), "Select a category"),
  party_type: z.enum(["Vendor", "Contractor"]),
  party_name: z.string().trim().max(200).optional().or(z.literal("")),
  work_description: z.string().trim().min(1, "Work description is required").max(500),
  quantity: z.string().optional(),
  unit: z.string().optional(),
  rate: z.string().optional(),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  amount_paid: z.coerce.number().min(0, "Amount paid cannot be negative"),
  payment_mode: z.string().optional(),
  reference_no: z.string().trim().max(100).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

type CostForm = {
  project_code: string;
  cost_date: string;
  category: string;
  party_type: "Vendor" | "Contractor";
  party_name: string;
  work_description: string;
  quantity: string;
  unit: string;
  rate: string;
  amount: string;
  amount_paid: string;
  payment_mode: string;
  reference_no: string;
  notes: string;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyForm = (projectCode: string): CostForm => ({
  project_code: projectCode,
  cost_date: todayISO(),
  category: "",
  party_type: "Vendor",
  party_name: "",
  work_description: "",
  quantity: "",
  unit: "",
  rate: "",
  amount: "",
  amount_paid: "",
  payment_mode: "",
  reference_no: "",
  notes: "",
});

export default function Construction() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<CostForm>(emptyForm(""));

  // Projects
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-construction"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("project_code, project_name")
        .order("project_name");
      if (error) throw error;
      return (data ?? []) as { project_code: string; project_name: string }[];
    },
  });

  // Auto-select first project when list loads.
  useEffect(() => {
    if (!selectedProject && projects.length) setSelectedProject(projects[0].project_code);
  }, [projects, selectedProject]);

  // Budget row for selected project
  const { data: budget } = useQuery({
    queryKey: ["construction-budget", selectedProject],
    enabled: !!selectedProject,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("construction_project_budgets")
        .select("*")
        .eq("project_code", selectedProject)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Budget | null;
    },
  });

  // Cost entries for selected project
  const { data: costs = [], isLoading } = useQuery({
    queryKey: ["construction-costs", selectedProject],
    enabled: !!selectedProject,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("construction_costs")
        .select("*")
        .eq("project_code", selectedProject)
        .order("cost_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Cost[];
    },
  });

  // Aggregates
  const totalSpent = useMemo(() => costs.reduce((s, r) => s + Number(r.amount || 0), 0), [costs]);
  const totalPaid = useMemo(
    () => costs.reduce((s, r) => s + Number(r.amount_paid || 0), 0),
    [costs],
  );
  const approvedBudget = Number(budget?.approved_budget ?? 0);
  const remaining = approvedBudget - totalSpent;
  const usedPct = approvedBudget > 0 ? (totalSpent / approvedBudget) * 100 : 0;
  const progressPct = Number(budget?.progress_percent ?? 0);

  // Category grouping for the report
  const byCategory = useMemo(() => {
    const groups: Record<string, { rows: Cost[]; subtotal: number }> = {};
    for (const c of costs) {
      const g = (groups[c.category] ||= { rows: [], subtotal: 0 });
      g.rows.push(c);
      g.subtotal += Number(c.amount || 0);
    }
    return Object.entries(groups)
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.subtotal - a.subtotal);
  }, [costs]);

  // ---- Mutations --------------------------------------------------------
  const addCost = useMutation({
    mutationFn: async (payload: CostForm) => {
      const parsed = costSchema.parse(payload);
      const insert = {
        project_code: parsed.project_code,
        cost_date: parsed.cost_date,
        category: parsed.category,
        party_type: parsed.party_type,
        party_name: parsed.party_name || null,
        work_description: parsed.work_description,
        quantity: parsed.quantity ? Number(parsed.quantity) : null,
        unit: parsed.unit || null,
        rate: parsed.rate ? Number(parsed.rate) : null,
        amount: parsed.amount,
        amount_paid: parsed.amount_paid,
        payment_mode: parsed.payment_mode || null,
        reference_no: parsed.reference_no || null,
        notes: parsed.notes || null,
      };
      const { error } = await supabase.from("construction_costs").insert(insert);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cost entry saved");
      setAddOpen(false);
      setForm(emptyForm(selectedProject));
      qc.invalidateQueries({ queryKey: ["construction-costs", selectedProject] });
    },
    onError: (e: any) => {
      if (e instanceof z.ZodError) toast.error(e.issues[0]?.message ?? "Validation error");
      else toast.error(e?.message ?? "Failed to save cost");
    },
  });

  const deleteCost = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("construction_costs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cost entry deleted");
      qc.invalidateQueries({ queryKey: ["construction-costs", selectedProject] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete"),
  });

  const saveBudget = useMutation({
    mutationFn: async (payload: {
      approved_budget: number;
      progress_percent: number;
      notes: string | null;
    }) => {
      const { error } = await supabase
        .from("construction_project_budgets")
        .upsert({ project_code: selectedProject, ...payload }, { onConflict: "project_code" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Budget & progress updated");
      qc.invalidateQueries({ queryKey: ["construction-budget", selectedProject] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save budget"),
  });

  // ---- Table columns ---------------------------------------------------
  const columns: Column<Cost>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (r) => r.cost_date,
      cell: (r) => <span className="tabular-nums">{fmtDate(r.cost_date)}</span>,
    },
    {
      key: "cat",
      header: "Category",
      sortValue: (r) => r.category,
      cell: (r) => <span>{r.category}</span>,
    },
    {
      key: "party",
      header: "Vendor / Contractor",
      cell: (r) => (
        <div className="text-sm">
          <div>{r.party_name || <span className="text-muted-foreground">—</span>}</div>
          <div className="text-[11px] text-muted-foreground">{r.party_type}</div>
        </div>
      ),
    },
    { key: "desc", header: "Work Description", cell: (r) => <span>{r.work_description}</span> },
    {
      key: "qty",
      header: "Qty × Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {r.quantity != null ? `${r.quantity} ${r.unit ?? ""}` : "—"}
          {r.rate != null ? ` @ ${fmtPKR(r.rate)}` : ""}
        </span>
      ),
    },
    {
      key: "amt",
      header: "Amount",
      align: "right",
      sortValue: (r) => Number(r.amount) || 0,
      cell: (r) => <span className="tabular-nums font-medium">{fmtPKR(r.amount)}</span>,
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      sortValue: (r) => Number(r.amount_paid) || 0,
      cell: (r) => {
        const paid = Number(r.amount_paid);
        const bal = Number(r.amount) - paid;
        return (
          <div className="text-right">
            <div className="tabular-nums">{fmtPKR(paid)}</div>
            <div
              className={cn("text-[11px]", bal > 0 ? "text-amber-600" : "text-muted-foreground")}
            >
              {bal > 0 ? `${fmtPKR(bal)} due` : "settled"}
            </div>
          </div>
        );
      },
    },
    {
      key: "mode",
      header: "Mode",
      cell: (r) => <span className="text-sm">{r.payment_mode || "—"}</span>,
    },
    {
      key: "ref",
      header: "Ref #",
      cell: (r) => <span className="font-mono text-xs">{r.reference_no || "—"}</span>,
    },
    {
      key: "act",
      header: "",
      align: "right",
      cell: (r) => (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label={`Delete cost from ${fmtDate(r.cost_date)}`}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this cost entry?</AlertDialogTitle>
              <AlertDialogDescription>
                {fmtDate(r.cost_date)} · {r.category} · {fmtPKR(r.amount)}
                <br />
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteCost.mutate(r.id)}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ),
    },
  ];

  // ---- Print report -----------------------------------------------------
  const openPrintReport = () => {
    const proj = projects.find((p) => p.project_code === selectedProject);
    if (!proj) return toast.error("Select a project first");
    const w = window.open("", "_blank", "width=1000,height=1000");
    if (!w) return toast.error("Popup blocked");

    const grandTotal = totalSpent;
    const sections = byCategory
      .map(({ category, rows, subtotal }) => {
        const items = rows
          .map(
            (r) => `<tr>
            <td>${fmtDate(r.cost_date)}</td>
            <td>${escapeHtml(r.party_type)}${r.party_name ? " · " + escapeHtml(r.party_name) : ""}</td>
            <td>${escapeHtml(r.work_description)}</td>
            <td>${r.quantity != null ? `${r.quantity} ${escapeHtml(r.unit ?? "")}` : ""}</td>
            <td class="num">${r.rate != null ? fmtPKR(r.rate) : ""}</td>
            <td class="num">${fmtPKR(r.amount)}</td>
            <td class="num">${fmtPKR(r.amount_paid)}</td>
            <td>${escapeHtml(r.payment_mode ?? "")}</td>
            <td>${escapeHtml(r.reference_no ?? "")}</td>
          </tr>`,
          )
          .join("");
        return `<section class="cat">
          <h2>${escapeHtml(category)} <span class="sub">${fmtPKR(subtotal)}</span></h2>
          <table>
            <thead><tr>
              <th>Date</th><th>Party</th><th>Description</th><th>Qty</th>
              <th class="num">Rate</th><th class="num">Amount</th>
              <th class="num">Paid</th><th>Mode</th><th>Ref #</th>
            </tr></thead>
            <tbody>${items}</tbody>
          </table>
        </section>`;
      })
      .join("");

    w.document.write(`<!doctype html><html><head><meta charset="utf-8" />
      <title>Construction Cost Statement — ${escapeHtml(proj.project_name)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 24px; color: #111; }
        h1 { margin: 0 0 4px; font-size: 20px; }
        .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
        .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 8px 0 24px; font-size: 12px; }
        .totals .box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
        .totals span { color: #555; }
        .totals b { display: block; font-size: 16px; margin-top: 2px; }
        .cat { margin-bottom: 20px; page-break-inside: avoid; }
        .cat h2 { font-size: 14px; background: #f3f4f6; padding: 6px 10px; margin: 0 0 6px; border-left: 3px solid #111; display: flex; justify-content: space-between; }
        .sub { font-weight: 500; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border-bottom: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; vertical-align: top; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .over { color: #b91c1c; }
        @media print { body { margin: 12mm; } .noprint { display: none; } }
      </style></head><body>
      <h1>Construction Cost Statement</h1>
      <div class="meta">${escapeHtml(proj.project_code)} · ${escapeHtml(proj.project_name)}<br/>Generated ${new Date().toLocaleString()}</div>
      <div class="totals">
        <div class="box"><span>Approved Budget</span><b>${fmtPKR(approvedBudget)}</b></div>
        <div class="box"><span>Total Spent</span><b>${fmtPKR(grandTotal)}</b></div>
        <div class="box"><span>Remaining</span><b class="${remaining < 0 ? "over" : ""}">${fmtPKR(remaining)}</b></div>
        <div class="box"><span>Budget Used</span><b class="${usedPct > 90 ? "over" : ""}">${usedPct.toFixed(1)}%</b></div>
      </div>
      ${sections || "<p><em>No cost entries recorded for this project.</em></p>"}
      <button class="noprint" onclick="window.print()" style="margin-top:16px;padding:8px 14px;">Print</button>
      </body></html>`);
    w.document.close();
  };

  // ---- Render -----------------------------------------------------------
  if (isMobile) return <MobileConstruction />;

  return (
    <div>
      <PageHeader
        title="Construction"
        description="Per-project construction budgets, costs and payments"
        actions={
          <>
            <Button variant="outline" onClick={openPrintReport} disabled={!selectedProject}>
              <Printer className="h-4 w-4" />
              <span>Print Statement</span>
            </Button>
            <Dialog
              open={addOpen}
              onOpenChange={(o) => {
                setAddOpen(o);
                if (o) setForm(emptyForm(selectedProject));
              }}
            >
              <DialogTrigger asChild>
                <Button disabled={!selectedProject}>
                  <Plus className="h-4 w-4" />
                  <span>Add Cost</span>
                </Button>
              </DialogTrigger>
              <CostFormDialog
                form={form}
                setForm={setForm}
                projects={projects}
                onSubmit={() => addCost.mutate(form)}
                submitting={addCost.isPending}
              />
            </Dialog>
          </>
        }
      />

      {/* Project selector */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px]">
            <Label htmlFor="project" className="text-xs">
              Project
            </Label>
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger id="project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.project_code} value={p.project_code}>
                    {p.project_code} · {p.project_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedProject && (
            <BudgetEditor
              key={selectedProject}
              budget={budget ?? null}
              onSave={(payload) => saveBudget.mutate(payload)}
              saving={saveBudget.isPending}
            />
          )}
        </div>
      </Card>

      {/* Dashboard */}
      {selectedProject && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
          <SummaryCard label="Approved Budget" value={fmtPKR(approvedBudget)} />
          <SummaryCard
            label="Total Spent"
            value={fmtPKR(totalSpent)}
            hint={`Paid ${fmtPKR(totalPaid)} · Due ${fmtPKR(Math.max(0, totalSpent - totalPaid))}`}
          />
          <SummaryCard
            label="Remaining Budget"
            value={fmtPKR(remaining)}
            tone={remaining < 0 ? "danger" : "default"}
          />
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Budget Used</div>
            <div className="mt-1 flex items-center gap-2">
              <div
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  usedPct > 90 && "text-destructive",
                )}
              >
                {usedPct.toFixed(1)}%
              </div>
              {usedPct > 90 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-xs font-medium"
                  role="status"
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {usedPct > 100 ? "Over budget" : "Nearing budget limit"}
                </span>
              )}
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  usedPct > 90 ? "bg-destructive" : "bg-primary",
                )}
                style={{ width: `${Math.min(100, usedPct)}%` }}
                role="progressbar"
                aria-valuenow={Math.round(usedPct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={
                  usedPct > 100
                    ? `Budget used ${usedPct.toFixed(1)} percent — over budget`
                    : usedPct > 90
                      ? `Budget used ${usedPct.toFixed(1)} percent — nearing budget limit`
                      : `Budget used ${usedPct.toFixed(1)} percent`
                }
              />
            </div>
            <div className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">
              Construction Progress
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{progressPct.toFixed(1)}%</div>
            <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
          </Card>
        </div>
      )}

      {/* Category report */}
      {selectedProject && byCategory.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Cost Report by Category</h2>
            <span className="text-xs text-muted-foreground">
              Grand Total {fmtPKR(totalSpent)}
              {approvedBudget > 0 && (
                <>
                  {" "}
                  · vs Budget {fmtPKR(approvedBudget)} · {usedPct.toFixed(1)}%
                </>
              )}
            </span>
          </div>
          <ul className="space-y-2">
            {byCategory.map((b) => {
              const pct = totalSpent > 0 ? (b.subtotal / totalSpent) * 100 : 0;
              return (
                <li
                  key={b.category}
                  className="grid grid-cols-[minmax(140px,180px)_1fr_120px_60px] items-center gap-3 text-sm"
                >
                  <span className="truncate">{b.category}</span>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-right">{fmtPKR(b.subtotal)}</span>
                  <span className="tabular-nums text-right text-muted-foreground">
                    {pct.toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Cost table */}
      {!selectedProject ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Select a project to view construction costs.
        </Card>
      ) : isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading costs…</Card>
      ) : costs.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={HardHat}
            title="No cost entries yet"
            description="Log the first labor, material, or contractor cost for this project to build up a construction ledger."
            action={
              <Button
                onClick={() => {
                  setForm(emptyForm(selectedProject));
                  setAddOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Cost
              </Button>
            }
          />
        </Card>
      ) : (
        <DataTable
          rows={costs}
          columns={columns}
          rowKey={(r) => r.id}
          searchKeys={[
            "work_description",
            "category",
            "party_name",
            "reference_no",
            "payment_mode",
          ]}
        />
      )}
    </div>
  );
}

// ---- Sub components ------------------------------------------------------

function SummaryCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger";
}) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function BudgetEditor({
  budget,
  onSave,
  saving,
}: {
  budget: Budget | null;
  onSave: (p: { approved_budget: number; progress_percent: number; notes: string | null }) => void;
  saving: boolean;
}) {
  const [approved, setApproved] = useState(String(budget?.approved_budget ?? ""));
  const [progress, setProgress] = useState(String(budget?.progress_percent ?? ""));

  useEffect(() => {
    setApproved(String(budget?.approved_budget ?? ""));
    setProgress(String(budget?.progress_percent ?? ""));
  }, [budget]);

  const submit = () => {
    const a = Number(approved);
    const p = Number(progress);
    if (!Number.isFinite(a) || a < 0) return toast.error("Enter a valid approved budget");
    if (!Number.isFinite(p) || p < 0 || p > 100)
      return toast.error("Progress must be between 0 and 100");
    onSave({ approved_budget: a, progress_percent: p, notes: null });
  };

  return (
    <>
      <div>
        <Label htmlFor="approved" className="text-xs">
          Approved Budget (PKR)
        </Label>
        <Input
          id="approved"
          type="number"
          min="0"
          step="0.01"
          className="w-44"
          value={approved}
          onChange={(e) => setApproved(e.target.value)}
          placeholder="0.00"
        />
      </div>
      <div>
        <Label htmlFor="progress" className="text-xs">
          Construction Progress %
        </Label>
        <Input
          id="progress"
          type="number"
          min="0"
          max="100"
          step="0.1"
          className="w-36"
          value={progress}
          onChange={(e) => setProgress(e.target.value)}
          placeholder="0"
        />
      </div>
      <Button variant="outline" onClick={submit} disabled={saving} className="min-h-11">
        <Save className="h-4 w-4" />
        <span>Save</span>
      </Button>
    </>
  );
}

function CostFormDialog({
  form,
  setForm,
  projects,
  onSubmit,
  submitting,
}: {
  form: CostForm;
  setForm: (f: CostForm) => void;
  projects: { project_code: string; project_name: string }[];
  onSubmit: () => void;
  submitting: boolean;
}) {
  const update = <K extends keyof CostForm>(k: K, v: CostForm[K]) => setForm({ ...form, [k]: v });

  // Auto amount from qty × rate when both present and amount is empty/auto.
  const autoAmount = useMemo(() => {
    const q = Number(form.quantity);
    const r = Number(form.rate);
    if (Number.isFinite(q) && Number.isFinite(r) && q > 0 && r > 0) return (q * r).toFixed(2);
    return "";
  }, [form.quantity, form.rate]);

  const applyAuto = () => {
    if (autoAmount) update("amount", autoAmount);
  };

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add Construction Cost</DialogTitle>
        <DialogDescription>
          Record a vendor or contractor bill with any payment made against it.
        </DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <div>
          <Label htmlFor="c_project">Project *</Label>
          <Select value={form.project_code} onValueChange={(v) => update("project_code", v)}>
            <SelectTrigger id="c_project">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.project_code} value={p.project_code}>
                  {p.project_code} · {p.project_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="c_date">Date *</Label>
          <Input
            id="c_date"
            type="date"
            required
            value={form.cost_date}
            onChange={(e) => update("cost_date", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="c_cat">Cost Category *</Label>
          <Select value={form.category} onValueChange={(v) => update("category", v)}>
            <SelectTrigger id="c_cat">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="c_ptype">Party Type *</Label>
          <Select
            value={form.party_type}
            onValueChange={(v) => update("party_type", v as "Vendor" | "Contractor")}
          >
            <SelectTrigger id="c_ptype">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PARTY_TYPES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="c_pname">{form.party_type} Name</Label>
          <Input
            id="c_pname"
            value={form.party_name}
            onChange={(e) => update("party_name", e.target.value)}
            placeholder={`Name of ${form.party_type.toLowerCase()}`}
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="c_desc">Work Description *</Label>
          <Input
            id="c_desc"
            required
            value={form.work_description}
            onChange={(e) => update("work_description", e.target.value)}
            placeholder="e.g. Grey structure of 1st floor slab"
          />
        </div>

        <div>
          <Label htmlFor="c_qty">Quantity</Label>
          <Input
            id="c_qty"
            type="number"
            step="0.001"
            min="0"
            value={form.quantity}
            onChange={(e) => update("quantity", e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <Label htmlFor="c_unit">Unit</Label>
          <Select
            value={form.unit || "__none__"}
            onValueChange={(v) => update("unit", v === "__none__" ? "" : v)}
          >
            <SelectTrigger id="c_unit">
              <SelectValue placeholder="Unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None —</SelectItem>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="c_rate">Rate (PKR)</Label>
          <Input
            id="c_rate"
            type="number"
            step="0.01"
            min="0"
            value={form.rate}
            onChange={(e) => update("rate", e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <Label htmlFor="c_amt">Amount (PKR) *</Label>
          <div className="flex gap-2">
            <Input
              id="c_amt"
              type="number"
              step="0.01"
              min="0"
              required
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
              placeholder="0.00"
            />
            {autoAmount && form.amount !== autoAmount && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 whitespace-nowrap"
                onClick={applyAuto}
              >
                = {autoAmount}
              </Button>
            )}
          </div>
        </div>

        <div>
          <Label htmlFor="c_paid">Amount Paid (PKR)</Label>
          <Input
            id="c_paid"
            type="number"
            step="0.01"
            min="0"
            value={form.amount_paid}
            onChange={(e) => update("amount_paid", e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <Label htmlFor="c_mode">Payment Mode</Label>
          <Select
            value={form.payment_mode || "__none__"}
            onValueChange={(v) => update("payment_mode", v === "__none__" ? "" : v)}
          >
            <SelectTrigger id="c_mode">
              <SelectValue placeholder="Select mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None —</SelectItem>
              {PAYMENT_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="c_ref">Reference No</Label>
          <Input
            id="c_ref"
            value={form.reference_no}
            onChange={(e) => update("reference_no", e.target.value)}
            placeholder="Bill / invoice / cheque number"
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="c_notes">Notes</Label>
          <Textarea
            id="c_notes"
            rows={3}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="Any additional context"
          />
        </div>

        <DialogFooter className="sm:col-span-2">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? "Saving…" : "Save Cost"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
