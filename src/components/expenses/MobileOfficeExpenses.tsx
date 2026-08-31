import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  Wallet,
  Home,
  Zap,
  Flame,
  Wifi,
  Phone,
  Fuel,
  Printer as PrinterIcon,
  Package,
  Megaphone,
  Scale,
  Landmark,
  Wrench,
  Users,
  HardHat,
  HardHatIcon,
  Coffee,
  Car,
  UserCheck,
  Utensils,
  MoreHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtPKR } from "@/lib/format";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "Rent",
  "Electricity",
  "Gas",
  "Internet",
  "Phone",
  "Fuel/Transport",
  "Printing/Stationery",
  "Office Supplies",
  "Marketing/Advertising",
  "Legal/Professional Fee",
  "Bank Charges",
  "Maintenance",
  "Salaries",
  "Construction Material",
  "Labour",
  "Food/Refreshment",
  "Side Visits",
  "G8 Visit During Transfer",
  "Guest Entertainment",
  "Other",
] as const;

const PAID_BY = [
  "Cash in Hand",
  "Bank - HBL",
  "Bank - Meezan",
  "Bank - UBL",
  "Petty Cash",
] as const;

const CAT_ICON: Record<string, { Icon: any; tone: string }> = {
  Rent: { Icon: Home, tone: "bg-blue-500/15 text-blue-600" },
  Electricity: { Icon: Zap, tone: "bg-amber-500/15 text-amber-600" },
  Gas: { Icon: Flame, tone: "bg-orange-500/15 text-orange-600" },
  Internet: { Icon: Wifi, tone: "bg-sky-500/15 text-sky-600" },
  Phone: { Icon: Phone, tone: "bg-emerald-500/15 text-emerald-600" },
  "Fuel/Transport": { Icon: Fuel, tone: "bg-red-500/15 text-red-600" },
  "Printing/Stationery": { Icon: PrinterIcon, tone: "bg-indigo-500/15 text-indigo-600" },
  "Office Supplies": { Icon: Package, tone: "bg-purple-500/15 text-purple-600" },
  "Marketing/Advertising": { Icon: Megaphone, tone: "bg-pink-500/15 text-pink-600" },
  "Legal/Professional Fee": { Icon: Scale, tone: "bg-slate-500/15 text-slate-600" },
  "Bank Charges": { Icon: Landmark, tone: "bg-cyan-500/15 text-cyan-600" },
  Maintenance: { Icon: Wrench, tone: "bg-yellow-500/15 text-yellow-600" },
  Salaries: { Icon: Users, tone: "bg-teal-500/15 text-teal-600" },
  "Construction Material": { Icon: HardHatIcon ?? HardHat, tone: "bg-stone-500/15 text-stone-600" },
  Labour: { Icon: UserCheck, tone: "bg-lime-500/15 text-lime-600" },
  "Food/Refreshment": { Icon: Utensils, tone: "bg-rose-500/15 text-rose-600" },
  "Side Visits": { Icon: Car, tone: "bg-fuchsia-500/15 text-fuchsia-600" },
  "G8 Visit During Transfer": { Icon: Car, tone: "bg-violet-500/15 text-violet-600" },
  "Guest Entertainment": { Icon: Coffee, tone: "bg-amber-500/15 text-amber-700" },
  Other: { Icon: MoreHorizontal, tone: "bg-muted text-muted-foreground" },
};

type Expense = {
  id: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  paid_by: string;
  notes: string | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

export function MobileOfficeExpenses() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["office_expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("office_expenses")
        .select("id,expense_date,category,description,amount,paid_by,notes")
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Expense[];
    },
  });

  const monthStr = todayISO().slice(0, 7);
  const monthRows = useMemo(
    () => rows.filter((r) => r.expense_date.startsWith(monthStr)),
    [rows, monthStr],
  );
  const monthTotal = useMemo(
    () => monthRows.reduce((s, r) => s + Number(r.amount || 0), 0),
    [monthRows],
  );
  const breakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of monthRows) map[r.category] = (map[r.category] ?? 0) + Number(r.amount || 0);
    return Object.entries(map)
      .map(([cat, amt]) => ({ cat, amt, pct: monthTotal ? (amt / monthTotal) * 100 : 0 }))
      .sort((a, b) => b.amt - a.amt);
  }, [monthRows, monthTotal]);

  return (
    <div className="pb-24">
      <div className="px-4 pt-3 pb-4 space-y-3">
        <div>
          <h1 className="text-2xl font-bold">Office Expenses</h1>
          <p className="text-sm text-muted-foreground">Track spending across categories</p>
        </div>

        {/* Monthly summary */}
        <div className="rounded-2xl border bg-card overflow-hidden">
          <button
            onClick={() => setSummaryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            aria-expanded={summaryOpen}
          >
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                This month
              </div>
              <div className="text-xl font-bold tabular-nums">PKR {fmtPKR(monthTotal)}</div>
            </div>
            {summaryOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
          {summaryOpen && (
            <div className="px-4 pb-4 space-y-2 border-t pt-3">
              {breakdown.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No expenses this month yet.
                </p>
              )}
              {breakdown.map(({ cat, amt, pct }) => {
                const meta = CAT_ICON[cat] ?? CAT_ICON.Other;
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <span
                      className={cn(
                        "h-8 w-8 rounded-full grid place-items-center shrink-0",
                        meta.tone,
                      )}
                    >
                      <meta.Icon className="h-4 w-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm truncate">{cat}</span>
                        <span className="text-sm font-semibold tabular-nums">
                          PKR {fmtPKR(amt)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">{pct.toFixed(0)}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Expense list */}
      <div className="px-4 space-y-2">
        {isLoading ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center">
            <Wallet className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="font-medium">No expenses yet</p>
            <p className="text-sm text-muted-foreground">
              Tap the + button to add your first expense.
            </p>
          </div>
        ) : (
          rows.map((r) => {
            const meta = CAT_ICON[r.category] ?? CAT_ICON.Other;
            return (
              <div key={r.id} className="rounded-2xl border bg-card p-3 flex items-center gap-3">
                <span
                  className={cn("h-10 w-10 rounded-xl grid place-items-center shrink-0", meta.tone)}
                >
                  <meta.Icon className="h-5 w-5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{r.expense_date}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 border text-[10px] font-medium truncate",
                        meta.tone,
                      )}
                    >
                      {r.category}
                    </span>
                  </div>
                  <p className="text-sm font-medium truncate mt-0.5">{r.description}</p>
                </div>
                <span className="text-sm font-bold tabular-nums shrink-0">
                  PKR {fmtPKR(r.amount)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setAddOpen(true)}
        aria-label="Add expense"
        className="fixed z-40 right-4 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg grid place-items-center active:scale-95 transition"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)" }}
      >
        <Plus className="h-6 w-6" />
      </button>

      {addOpen && (
        <MobileExpenseForm
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            qc.invalidateQueries({ queryKey: ["office_expenses"] });
          }}
        />
      )}
    </div>
  );
}

function MobileExpenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState<string>("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<(typeof PAID_BY)[number]>("Cash in Hand");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!category) throw new Error("Select a category");
      if (!description.trim()) throw new Error("Description is required");
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount");
      const { error } = await supabase.from("office_expenses").insert({
        expense_date: date,
        category,
        description: description.trim(),
        amount: amt,
        paid_by: paidBy,
        notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense saved");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save expense"),
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in"
      role="dialog"
      aria-label="Add expense"
    >
      <div className="flex items-center justify-between px-4 h-14 border-b">
        <button
          onClick={onClose}
          aria-label="Close"
          className="min-h-11 min-w-11 -ml-2 grid place-items-center"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="font-semibold">Add Expense</h2>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="d">Date</Label>
            <Input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="a">Amount (PKR)</Label>
            <Input
              id="a"
              type="number"
              inputMode="decimal"
              placeholder="0"
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
          <Label htmlFor="desc">Description</Label>
          <Input
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was this for?"
          />
        </div>

        <div>
          <Label>Paid from</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {PAID_BY.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPaidBy(p)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-sm text-left transition",
                  paidBy === p ? "border-primary bg-primary/5" : "bg-card",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="n">Notes (optional)</Label>
          <Textarea id="n" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            "Save Expense"
          )}
        </Button>
      </div>
    </div>
  );
}
