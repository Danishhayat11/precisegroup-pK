import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Phone,
  MessageCircle,
  Pencil,
  ArrowRightCircle,
  CalendarClock,
  Search,
  X,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@/lib/router-compat";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";
import { toastError } from "@/lib/friendlyError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, statusTone } from "@/components/StatusBadge";

import { fmtPKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Lead, LeadStage } from "@/pages/LeadsCRM";
import { LEAD_STAGES } from "@/pages/LeadsCRM";

const SOURCES = [
  "Walk-in",
  "Phone Call",
  "WhatsApp",
  "Referral",
  "Facebook",
  "Instagram",
  "Zameen.com",
  "OLX",
  "Banner/Hoarding",
  "Other",
] as const;

const UNIT_TYPES = ["Apartment", "Shop", "Office", "Plot", "Other"] as const;

const STAGE_TONE: Record<LeadStage, string> = {
  "New Inquiry": "bg-blue-500/15 text-blue-700 border-blue-500/30",
  "Site Visit Scheduled": "bg-amber-500/15 text-amber-700 border-amber-500/30",
  Negotiation: "bg-purple-500/15 text-purple-700 border-purple-500/30",
  "Booking Done": "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  Lost: "bg-destructive/15 text-destructive border-destructive/30",
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const normalizeWa = (n: string) => n.replace(/\D/g, "").replace(/^0/, "92");

type Form = {
  full_name: string;
  mobile: string;
  whatsapp: string;
  cnic: string;
  email: string;
  source: string;
  interested_unit_type: string;
  budget_min: string;
  budget_max: string;
  follow_up_date: string;
  notes: string;
  stage: LeadStage;
};

const emptyForm = (): Form => ({
  full_name: "",
  mobile: "",
  whatsapp: "",
  cnic: "",
  email: "",
  source: "Walk-in",
  interested_unit_type: "",
  budget_min: "",
  budget_max: "",
  follow_up_date: "",
  notes: "",
  stage: "New Inquiry",
});

export function MobileLeadsCRM() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { companyId } = useAuth();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Form>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [stageSheet, setStageSheet] = useState<Lead | null>(null);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["crm_leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const today = todayISO();
  const followUps = useMemo(
    () =>
      leads.filter(
        (l) =>
          l.follow_up_date &&
          l.follow_up_date <= today &&
          l.stage !== "Booking Done" &&
          l.stage !== "Lost",
      ),
    [leads, today],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    const digits = q.replace(/\D/g, "");
    return leads.filter((l) => {
      if (l.full_name.toLowerCase().includes(q)) return true;
      if (digits && [l.mobile, l.whatsapp ?? ""].some((v) => v.replace(/\D/g, "").includes(digits)))
        return true;
      return false;
    });
  }, [leads, search]);

  const stageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: LeadStage }) => {
      const { error } = await supabase
        .from("crm_leads")
        .update({ stage })
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["crm_leads"] });
      const prev = qc.getQueryData<Lead[]>(["crm_leads"]) ?? [];
      qc.setQueryData<Lead[]>(
        ["crm_leads"],
        prev.map((l) =>
          l.id === id ? { ...l, stage, stage_entered_at: new Date().toISOString() } : l,
        ),
      );
      return { prev };
    },
    onSuccess: (_d, v) => {
      toast.success(`Moved to "${v.stage}"`);
      setStageSheet(null);
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["crm_leads"], ctx.prev);
      toastError(e, "Couldn't update stage");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["crm_leads"] }),
  });

  const saveMutation = useMutation({
    mutationFn: async (f: Form) => {
      const toNum = (s: string) => (s && Number.isFinite(Number(s)) ? Number(s) : null);
      const payload = {
        full_name: f.full_name.trim(),
        mobile: f.mobile.trim(),
        whatsapp: f.whatsapp.trim() || null,
        cnic: f.cnic.trim() || null,
        email: f.email.trim() || null,
        source: f.source,
        interested_unit_type: f.interested_unit_type || null,
        budget_min: toNum(f.budget_min),
        budget_max: toNum(f.budget_max),
        follow_up_date: f.follow_up_date || null,
        notes: f.notes.trim() || null,
        stage: f.stage,
      };
      if (!payload.full_name) throw new Error("Name is required");
      if (!/^(?:\+?92|0)3\d{9}$/.test(payload.mobile))
        throw new Error("Enter a valid PK mobile (03xxxxxxxxx)");
      if (editingId) {
        const { error } = await supabase
          .from("crm_leads")
          .update(payload)
          .eq("id", editingId)
          .eq("company_id", companyId!);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("crm_leads").insert(withCompany(payload, companyId!));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Lead updated" : "Lead added");
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm());
      qc.invalidateQueries({ queryKey: ["crm_leads"] });
    },
    onError: (e: any) => toastError(e, "Couldn't save lead"),
  });

  const openEdit = (l: Lead) => {
    setEditingId(l.id);
    setForm({
      full_name: l.full_name,
      mobile: l.mobile,
      whatsapp: l.whatsapp ?? "",
      cnic: l.cnic ?? "",
      email: l.email ?? "",
      source: l.source,
      interested_unit_type: l.interested_unit_type ?? "",
      budget_min: l.budget_min == null ? "" : String(l.budget_min),
      budget_max: l.budget_max == null ? "" : String(l.budget_max),
      follow_up_date: l.follow_up_date ?? "",
      notes: l.notes ?? "",
      stage: (l.stage as LeadStage) ?? "New Inquiry",
    });
    setFormOpen(true);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const convert = (l: Lead) => {
    try {
      sessionStorage.setItem(
        "crm_convert_lead",
        JSON.stringify({
          id: l.id,
          full_name: l.full_name,
          mobile: l.mobile,
          cnic: l.cnic,
          project_code: l.interested_project_code,
          unit_type: l.interested_unit_type,
        }),
      );
    } catch {
      /* noop */
    }
    nav(`/bookings?fromLead=${l.id}`);
  };

  return (
    <div className="pb-24">
      <header
        // iOS frosted-header pattern: translucent surface + backdrop-blur
        // ONLY when the browser supports backdrop-filter. Without that
        // guard, `backdrop-blur` over an already-opaque background creates
        // a stacking context that iOS Safari renders as a faint smear along
        // the bottom border. Falling back to a solid `bg-background` keeps
        // contrast on browsers without backdrop-filter.
        className={[
          "sticky top-0 z-20 px-4 pt-4 pb-3",
          "border-b border-border/60",
          "bg-background",
          "supports-[backdrop-filter]:bg-background/80",
          "supports-[backdrop-filter]:backdrop-blur-xl",
          "supports-[backdrop-filter]:backdrop-saturate-150",
        ].join(" ")}
      >
        {/* H1 uses the primary token pair; tracking-tight matches the iOS
            large-title feel without sacrificing WCAG AA contrast. */}
        <h1 className="text-2xl font-bold tracking-tight text-foreground mb-3 leading-tight">
          Leads
        </h1>
        <div className="relative">
          {/* Search glyph. `text-muted-foreground` washes out over the
              translucent header on some iOS renders; `text-foreground/60`
              keeps a token-driven color while guaranteeing ≥ 4.5:1 against
              both light and dark backgrounds. `pointer-events-none` so it
              never intercepts taps on the input. */}
          <Search
            className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/60 pointer-events-none"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or mobile"
            className="pl-10 h-11 text-base placeholder:text-muted-foreground"
            inputMode="search"
            aria-label="Search leads by name or mobile"
          />
        </div>
      </header>

      {followUps.length > 0 && (
        <section className="px-4 pt-4" aria-label="Today's follow-ups">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="h-4 w-4 text-destructive" />
            <h2 className="text-sm font-bold">Today's Follow-ups ({followUps.length})</h2>
          </div>
          <div className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-2 snap-x">
            {followUps.map((l) => (
              <button
                key={l.id}
                onClick={() => openEdit(l)}
                className="snap-start shrink-0 w-64 text-left rounded-xl border-2 border-destructive/40 bg-destructive/5 p-3 min-h-24"
              >
                <div className="font-bold truncate">{l.full_name}</div>
                <div className="text-xs text-muted-foreground truncate">{l.mobile}</div>
                <div className="text-xs mt-1 text-destructive font-semibold">
                  Due: {l.follow_up_date}
                </div>
                <div className="mt-1">
                  <StatusBadge label={l.stage} tone={statusTone(l.stage)} />
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="px-4 pt-4 space-y-3" aria-label="Leads list">
        {isLoading && (
          <div className="py-8 grid place-items-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm">
            {search ? "No leads match your search." : "No leads yet. Tap + to add one."}
          </div>
        )}
        {filtered.map((l) => (
          <LeadCard
            key={l.id}
            lead={l}
            onEdit={() => openEdit(l)}
            onStage={() => setStageSheet(l)}
            onConvert={() => convert(l)}
          />
        ))}
      </section>

      <button
        onClick={openAdd}
        aria-label="Add lead"
        className="fixed bottom-6 right-4 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg grid place-items-center active:scale-95 transition"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
      >
        <Plus className="h-6 w-6" />
      </button>

      {stageSheet && (
        <StageSheet
          lead={stageSheet}
          pending={stageMutation.isPending}
          onClose={() => setStageSheet(null)}
          onPick={(s) => stageMutation.mutate({ id: stageSheet.id, stage: s })}
        />
      )}

      {formOpen && (
        <LeadFormSheet
          form={form}
          setForm={setForm}
          isEdit={!!editingId}
          saving={saveMutation.isPending}
          onClose={() => {
            setFormOpen(false);
            setEditingId(null);
            setForm(emptyForm());
          }}
          onSave={() => saveMutation.mutate(form)}
        />
      )}
    </div>
  );
}

function LeadCard({
  lead,
  onEdit,
  onStage,
  onConvert,
}: {
  lead: Lead;
  onEdit: () => void;
  onStage: () => void;
  onConvert: () => void;
}) {
  const today = todayISO();
  const isOverdue =
    lead.follow_up_date &&
    lead.follow_up_date <= today &&
    lead.stage !== "Booking Done" &&
    lead.stage !== "Lost";
  const budget =
    lead.budget_min || lead.budget_max
      ? `PKR ${fmtPKR(lead.budget_min ?? 0)}${lead.budget_max ? ` – ${fmtPKR(lead.budget_max)}` : "+"}`
      : null;
  const waNum = lead.whatsapp || lead.mobile;

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-bold text-base truncate">{lead.full_name}</div>
          <a href={`tel:${lead.mobile}`} className="text-sm text-primary font-medium tabular-nums">
            {lead.mobile}
          </a>
        </div>
        <button
          type="button"
          onClick={onStage}
          aria-label={`Change stage from ${lead.stage}`}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold min-h-11 min-w-11",
            STAGE_TONE[lead.stage as LeadStage],
          )}
        >
          {lead.stage}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="text-[10px]">
          {lead.source}
        </Badge>
        {lead.interested_unit_type && (
          <span className="text-muted-foreground">{lead.interested_unit_type}</span>
        )}
        {budget && <span className="font-medium">{budget}</span>}
      </div>

      {lead.follow_up_date && (
        <div
          className={cn(
            "text-xs flex items-center gap-1",
            isOverdue ? "text-destructive font-semibold" : "text-muted-foreground",
          )}
        >
          <CalendarClock className="h-3 w-3" />
          Follow-up: {lead.follow_up_date}
        </div>
      )}

      <div className="flex items-center gap-1 pt-1 border-t">
        <ActionBtn href={`tel:${lead.mobile}`} label="Call">
          <Phone className="h-5 w-5" />
        </ActionBtn>
        <ActionBtn href={`https://wa.me/${normalizeWa(waNum)}`} label="WhatsApp" external>
          <MessageCircle className="h-5 w-5 text-emerald-600" />
        </ActionBtn>
        <ActionBtn onClick={onEdit} label="Edit">
          <Pencil className="h-5 w-5" />
        </ActionBtn>
        <ActionBtn onClick={onConvert} label="Convert to booking">
          <ArrowRightCircle className="h-5 w-5 text-primary" />
        </ActionBtn>
      </div>
    </div>
  );
}

function ActionBtn({
  href,
  onClick,
  label,
  external,
  children,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    "flex-1 min-h-11 grid place-items-center rounded-lg hover:bg-muted active:bg-muted/80";
  if (href) {
    return (
      <a
        href={href}
        aria-label={label}
        className={cls}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cls}>
      {children}
    </button>
  );
}

function StageSheet({
  lead,
  pending,
  onClose,
  onPick,
}: {
  lead: Lead;
  pending: boolean;
  onClose: () => void;
  onPick: (s: LeadStage) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Change stage"
    >
      <div
        className="w-full bg-background rounded-t-2xl p-4 pb-8 space-y-3 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 2rem)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Move</div>
            <div className="font-bold truncate">{lead.full_name}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-h-11 min-w-11 grid place-items-center"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2">
          {LEAD_STAGES.map((s) => {
            const active = s === lead.stage;
            return (
              <button
                key={s}
                type="button"
                disabled={active || pending}
                onClick={() => onPick(s)}
                className={cn(
                  "w-full min-h-14 rounded-xl border-2 px-4 py-3 text-left font-bold flex items-center justify-between",
                  STAGE_TONE[s],
                  active && "opacity-60 cursor-not-allowed ring-2 ring-offset-2 ring-current",
                )}
              >
                <span>{s}</span>
                {active && <span className="text-xs">Current</span>}
                {!active && <ChevronRight className="h-5 w-5" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LeadFormSheet({
  form,
  setForm,
  isEdit,
  saving,
  onClose,
  onSave,
}: {
  form: Form;
  setForm: (f: Form) => void;
  isEdit: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-background">
        <button
          onClick={onClose}
          aria-label="Close"
          className="min-h-11 min-w-11 grid place-items-center"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="font-bold">{isEdit ? "Edit Lead" : "Add Lead"}</h2>
        <div className="w-11" />
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <Label htmlFor="fn">Full Name *</Label>
          <Input
            id="fn"
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            className="h-11"
          />
        </div>
        <div>
          <Label htmlFor="mob">Mobile *</Label>
          <Input
            id="mob"
            type="tel"
            inputMode="numeric"
            pattern="[0-9+]*"
            value={form.mobile}
            onChange={(e) => {
              const v = e.target.value;
              // Auto-copy to WhatsApp if empty or matches previous mobile
              const wa = !form.whatsapp || form.whatsapp === form.mobile ? v : form.whatsapp;
              setForm({ ...form, mobile: v, whatsapp: wa });
            }}
            placeholder="03xxxxxxxxx"
            className="h-11"
          />
        </div>
        <div>
          <Label htmlFor="wa">WhatsApp</Label>
          <Input
            id="wa"
            type="tel"
            inputMode="numeric"
            value={form.whatsapp}
            onChange={(e) => set("whatsapp", e.target.value)}
            placeholder="Same as mobile"
            className="h-11"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Auto-copied from mobile — edit if different.
          </p>
        </div>
        <div>
          <Label htmlFor="cnic">CNIC</Label>
          <Input
            id="cnic"
            inputMode="numeric"
            value={form.cnic}
            onChange={(e) => set("cnic", e.target.value)}
            placeholder="12345-1234567-1"
            className="h-11"
          />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            className="h-11"
          />
        </div>
        <div>
          <Label>Source</Label>
          <select
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
            className="h-11 w-full rounded-md border bg-background px-3"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Interested Unit Type</Label>
          <select
            value={form.interested_unit_type}
            onChange={(e) => set("interested_unit_type", e.target.value)}
            className="h-11 w-full rounded-md border bg-background px-3"
          >
            <option value="">—</option>
            {UNIT_TYPES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="bmin">Budget Min</Label>
            <Input
              id="bmin"
              type="number"
              inputMode="numeric"
              value={form.budget_min}
              onChange={(e) => set("budget_min", e.target.value)}
              className="h-11"
            />
          </div>
          <div>
            <Label htmlFor="bmax">Budget Max</Label>
            <Input
              id="bmax"
              type="number"
              inputMode="numeric"
              value={form.budget_max}
              onChange={(e) => set("budget_max", e.target.value)}
              className="h-11"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="fud">Follow-up Date</Label>
          <Input
            id="fud"
            type="date"
            value={form.follow_up_date}
            onChange={(e) => set("follow_up_date", e.target.value)}
            className="h-11"
          />
        </div>
        <div>
          <Label>Stage</Label>
          <select
            value={form.stage}
            onChange={(e) => set("stage", e.target.value as LeadStage)}
            className="h-11 w-full rounded-md border bg-background px-3"
          >
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
      </div>

      <footer
        className="border-t p-4 bg-background sticky bottom-0"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 1rem)" }}
      >
        <Button onClick={onSave} disabled={saving} className="w-full min-h-12 text-base font-bold">
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEdit ? "Save Changes" : "Add Lead"}
        </Button>
      </footer>
    </div>
  );
}
