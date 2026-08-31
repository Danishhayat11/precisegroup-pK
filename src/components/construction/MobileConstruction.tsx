import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  X,
  Loader2,
  HardHat,
  ChevronDown,
  ChevronUp,
  Layers,
  Wrench,
  Zap,
  Brush,
  DoorOpen,
  Grid3x3,
  Palette,
  Move,
  Battery,
  Camera,
  Trees,
  PenTool,
  Ruler,
  Users,
  UserCheck,
  Truck,
  MoreHorizontal,
  Home,
  Building2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtPKR } from "@/lib/format";
import { cn } from "@/lib/utils";

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

const PAYMENT_MODES = ["Cash", "Online Transfer", "Cheque", "Bank Draft", "Credit"] as const;

const CAT_ICON: Record<string, { Icon: any; tone: string }> = {
  "Land Cost": { Icon: Home, tone: "bg-emerald-500/15 text-emerald-600" },
  Foundation: { Icon: Layers, tone: "bg-stone-500/15 text-stone-700" },
  "Structure/RCC": { Icon: Building2, tone: "bg-slate-500/15 text-slate-700" },
  Brickwork: { Icon: Grid3x3, tone: "bg-orange-500/15 text-orange-600" },
  Plumbing: { Icon: Wrench, tone: "bg-sky-500/15 text-sky-600" },
  Electrical: { Icon: Zap, tone: "bg-amber-500/15 text-amber-600" },
  Finishing: { Icon: Brush, tone: "bg-purple-500/15 text-purple-600" },
  "Doors/Windows": { Icon: DoorOpen, tone: "bg-yellow-500/15 text-yellow-700" },
  "Tiles/Flooring": { Icon: Grid3x3, tone: "bg-teal-500/15 text-teal-600" },
  Paint: { Icon: Palette, tone: "bg-pink-500/15 text-pink-600" },
  Elevator: { Icon: Move, tone: "bg-indigo-500/15 text-indigo-600" },
  Generator: { Icon: Battery, tone: "bg-lime-500/15 text-lime-700" },
  "CCTV/Security": { Icon: Camera, tone: "bg-red-500/15 text-red-600" },
  Landscaping: { Icon: Trees, tone: "bg-green-500/15 text-green-600" },
  "Architecture Fee": { Icon: PenTool, tone: "bg-fuchsia-500/15 text-fuchsia-600" },
  "Engineering Fee": { Icon: Ruler, tone: "bg-cyan-500/15 text-cyan-600" },
  "Labour (Daily)": { Icon: Users, tone: "bg-blue-500/15 text-blue-600" },
  "Labour (Contract)": { Icon: UserCheck, tone: "bg-violet-500/15 text-violet-600" },
  "Equipment Rental": { Icon: Truck, tone: "bg-rose-500/15 text-rose-600" },
  Other: { Icon: MoreHorizontal, tone: "bg-muted text-muted-foreground" },
};

type Cost = {
  id: string;
  project_code: string;
  cost_date: string;
  category: string;
  party_type: "Vendor" | "Contractor";
  party_name: string | null;
  work_description: string;
  amount: number;
  amount_paid: number;
  payment_mode: string | null;
  reference_no: string | null;
  notes: string | null;
};

type Budget = { project_code: string; approved_budget: number; progress_percent: number };

const todayISO = () => new Date().toISOString().slice(0, 10);

export function MobileConstruction() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-construction"],
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("project_code, project_name")
        .order("project_name");
      return (data ?? []) as { project_code: string; project_name: string }[];
    },
  });

  useEffect(() => {
    if (!selected && projects.length) setSelected(projects[0].project_code);
  }, [projects, selected]);

  const { data: budget } = useQuery({
    queryKey: ["construction-budget", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data } = await supabase
        .from("construction_project_budgets")
        .select("*")
        .eq("project_code", selected)
        .maybeSingle();
      return (data ?? null) as Budget | null;
    },
  });

  const { data: costs = [], isLoading } = useQuery({
    queryKey: ["construction-costs", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data } = await supabase
        .from("construction_costs")
        .select("*")
        .eq("project_code", selected)
        .order("cost_date", { ascending: false })
        .order("created_at", { ascending: false });
      return (data ?? []) as Cost[];
    },
  });

  const totalSpent = useMemo(() => costs.reduce((s, r) => s + Number(r.amount || 0), 0), [costs]);
  const approvedBudget = Number(budget?.approved_budget ?? 0);
  const usedPct = approvedBudget > 0 ? Math.min((totalSpent / approvedBudget) * 100, 100) : 0;
  const barTone =
    usedPct >= 80 ? "bg-destructive" : usedPct >= 60 ? "bg-amber-500" : "bg-emerald-500";
  const progressPct = Number(budget?.progress_percent ?? 0);

  const projectName = projects.find((p) => p.project_code === selected)?.project_name ?? selected;

  return (
    <div className="pb-24">
      <div className="px-4 pt-3 pb-3">
        <h1 className="text-2xl font-bold">Construction</h1>
        <p className="text-sm text-muted-foreground">Project budget & cost tracking</p>
      </div>

      {/* Project chips */}
      <div className="px-4 pb-3 overflow-x-auto no-scrollbar">
        <div className="flex gap-2 min-w-max">
          {projects.length === 0 && (
            <span className="text-sm text-muted-foreground py-2">No projects</span>
          )}
          {projects.map((p) => {
            const active = p.project_code === selected;
            return (
              <button
                key={p.project_code}
                onClick={() => setSelected(p.project_code)}
                className={cn(
                  "h-11 px-4 rounded-full border text-sm font-medium whitespace-nowrap transition",
                  active ? "bg-primary text-primary-foreground border-primary" : "bg-card",
                )}
              >
                {p.project_name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Budget card */}
      {selected && (
        <div className="px-4 space-y-3">
          <div className="rounded-2xl border bg-card p-4 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {projectName}
              </div>
              <div className="text-xl font-bold tabular-nums mt-1">
                PKR {fmtPKR(totalSpent)}{" "}
                <span className="text-sm font-normal text-muted-foreground">spent of</span> PKR{" "}
                {fmtPKR(approvedBudget)}
              </div>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full transition-all", barTone)}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {usedPct.toFixed(1)}% of budget used
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-4 flex items-center gap-4">
            <ProgressRing pct={progressPct} />
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Construction Progress
              </div>
              <div className="text-lg font-semibold">{progressPct}% complete</div>
            </div>
          </div>
        </div>
      )}

      {/* Cost list */}
      <div className="px-4 pt-4 space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recent Costs
        </h2>
        {isLoading ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : costs.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center">
            <HardHat className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="font-medium">No cost entries yet</p>
            <p className="text-sm text-muted-foreground">Tap + to add your first cost.</p>
          </div>
        ) : (
          costs.map((c) => {
            const meta = CAT_ICON[c.category] ?? CAT_ICON.Other;
            const open = expanded === c.id;
            return (
              <div key={c.id} className="rounded-2xl border bg-card overflow-hidden">
                <button
                  onClick={() => setExpanded(open ? null : c.id)}
                  className="w-full p-3 flex items-center gap-3 text-left"
                  aria-expanded={open}
                >
                  <span
                    className={cn(
                      "h-10 w-10 rounded-xl grid place-items-center shrink-0",
                      meta.tone,
                    )}
                  >
                    <meta.Icon className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground">
                      {c.cost_date} · {c.category}
                    </div>
                    <p className="text-sm font-medium truncate">{c.party_name ?? "—"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold tabular-nums">PKR {fmtPKR(c.amount)}</div>
                    {open ? (
                      <ChevronUp className="h-4 w-4 ml-auto mt-1 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 ml-auto mt-1 text-muted-foreground" />
                    )}
                  </div>
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-1 space-y-1 border-t text-sm">
                    <Row label="Work" value={c.work_description} />
                    <Row
                      label="Party"
                      value={`${c.party_type}${c.party_name ? ` · ${c.party_name}` : ""}`}
                    />
                    {c.payment_mode && <Row label="Mode" value={c.payment_mode} />}
                    {c.reference_no && <Row label="Ref" value={c.reference_no} />}
                    <Row label="Paid" value={`PKR ${fmtPKR(c.amount_paid)}`} />
                    {c.notes && <Row label="Notes" value={c.notes} />}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <button
        onClick={() => setAddOpen(true)}
        aria-label="Add cost entry"
        disabled={!selected}
        className="fixed z-40 right-4 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg grid place-items-center active:scale-95 transition disabled:opacity-50"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)" }}
      >
        <Plus className="h-6 w-6" />
      </button>

      {addOpen && selected && (
        <MobileCostForm
          projectCode={selected}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            qc.invalidateQueries({ queryKey: ["construction-costs", selected] });
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 pt-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground w-20 shrink-0">
        {label}
      </span>
      <span className="text-sm flex-1 break-words">{value}</span>
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="shrink-0">
      <circle cx="40" cy="40" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 40 40)"
      />
      <text x="40" y="45" textAnchor="middle" className="fill-foreground text-sm font-semibold">
        {clamped.toFixed(0)}%
      </text>
    </svg>
  );
}

function MobileCostForm({
  projectCode,
  onClose,
  onSaved,
}: {
  projectCode: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [costDate, setCostDate] = useState(todayISO());
  const [category, setCategory] = useState("");
  const [partyType, setPartyType] = useState<"Vendor" | "Contractor">("Vendor");
  const [partyName, setPartyName] = useState("");
  const [work, setWork] = useState("");
  const [amount, setAmount] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [mode, setMode] = useState<string>("");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!category) throw new Error("Select a category");
      if (!work.trim()) throw new Error("Work description is required");
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount");
      const paid = Number(amountPaid || "0");
      const { error } = await supabase.from("construction_costs").insert({
        project_code: projectCode,
        cost_date: costDate,
        category,
        party_type: partyType,
        party_name: partyName.trim() || null,
        work_description: work.trim(),
        amount: amt,
        amount_paid: paid,
        payment_mode: mode || null,
        reference_no: ref.trim() || null,
        notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cost entry saved");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save cost"),
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in"
      role="dialog"
      aria-label="Add cost"
    >
      <div className="flex items-center justify-between px-4 h-14 border-b">
        <button
          onClick={onClose}
          aria-label="Close"
          className="min-h-11 min-w-11 -ml-2 grid place-items-center"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="font-semibold">Add Cost</h2>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cd">Date</Label>
            <Input
              id="cd"
              type="date"
              value={costDate}
              onChange={(e) => setCostDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="am">Amount (PKR)</Label>
            <Input
              id="am"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label>Category</Label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {CATEGORIES.map((c) => {
              const meta = CAT_ICON[c] ?? CAT_ICON.Other;
              const active = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-xl border p-2 flex flex-col items-center gap-1 min-h-[76px] text-center transition",
                    active ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "bg-card",
                  )}
                >
                  <span className={cn("h-8 w-8 rounded-lg grid place-items-center", meta.tone)}>
                    <meta.Icon className="h-4 w-4" />
                  </span>
                  <span className="text-[10px] leading-tight line-clamp-2">{c}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>Party Type</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {(["Vendor", "Contractor"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPartyType(p)}
                className={cn(
                  "h-11 rounded-xl border text-sm font-medium transition",
                  partyType === p ? "border-primary bg-primary/5" : "bg-card",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="pn">Vendor / Contractor Name</Label>
          <Input id="pn" value={partyName} onChange={(e) => setPartyName(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="wd">Work Description</Label>
          <Textarea id="wd" rows={3} value={work} onChange={(e) => setWork(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ap">Amount Paid</Label>
            <Input
              id="ap"
              type="number"
              inputMode="decimal"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="rf">Reference</Label>
            <Input id="rf" value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Payment Mode</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {PAYMENT_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "h-11 rounded-xl border text-sm transition",
                  mode === m ? "border-primary bg-primary/5" : "bg-card",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="nt">Notes</Label>
          <Textarea id="nt" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div
        className="px-4 pt-3 border-t bg-background"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <Button
          className="w-full h-14 text-base font-semibold"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Saving…
            </>
          ) : (
            "Save Cost Entry"
          )}
        </Button>
      </div>
    </div>
  );
}
