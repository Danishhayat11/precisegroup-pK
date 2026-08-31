import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError, friendlyError } from "@/lib/friendlyError";
import { z } from "zod";
import {
  KanbanSquare,
  LayoutList,
  Plus,
  Phone,
  MessageCircle,
  Trash2,
  Pencil,
  ArrowRightCircle,
  Users,
  CalendarClock,
  Search,
  Download,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@/lib/router-compat";
import { notifyAssignee } from "@/lib/notifyAssignee";
import { useAuth } from "@/lib/auth";
import { useLiveAnnouncer } from "@/hooks/useLiveAnnouncer";
import { withCompany } from "@/lib/companyScope";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileLeadsCRM } from "@/components/crm/MobileLeadsCRM";

// ---- Domain constants ---------------------------------------------------
export const LEAD_STAGES = [
  "New Inquiry",
  "Site Visit Scheduled",
  "Negotiation",
  "Booking Done",
  "Lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

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

// Pakistan mobile: 03xx-xxxxxxx OR +923xx-xxxxxxx (10-13 digits after normalisation).
const PK_MOBILE_RE = /^(?:\+?92|0)3\d{9}$/;
// Pakistan CNIC: 13 digits, optionally with dashes as xxxxx-xxxxxxx-x.
const PK_CNIC_RE = /^(?:\d{13}|\d{5}-\d{7}-\d)$/;

export type Lead = {
  id: string;
  full_name: string;
  mobile: string;
  whatsapp: string | null;
  cnic: string | null;
  email: string | null;
  source: string;
  interested_project_code: string | null;
  interested_unit_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  notes: string | null;
  assigned_to: string | null;
  follow_up_date: string | null;
  stage: string;
  stage_entered_at: string;
  converted_booking_id: string | null;
  created_at: string;
  updated_at: string;
};

const leadSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(1, "Full name is required")
      .max(120, "Keep under 120 characters"),
    mobile: z.string().trim().regex(PK_MOBILE_RE, "Enter a Pakistan mobile (03xxxxxxxxx)"),
    whatsapp: z
      .string()
      .trim()
      .max(20)
      .regex(PK_MOBILE_RE, "Enter a Pakistan mobile (03xxxxxxxxx)")
      .optional()
      .or(z.literal("")),
    cnic: z
      .string()
      .trim()
      .max(20)
      .regex(PK_CNIC_RE, "Enter a 13-digit CNIC (e.g. 12345-1234567-1)")
      .optional()
      .or(z.literal("")),
    email: z
      .string()
      .trim()
      .email("Enter a valid email address")
      .max(200)
      .optional()
      .or(z.literal("")),
    source: z.string().refine((v) => (SOURCES as readonly string[]).includes(v), "Select a source"),
    interested_project_code: z.string().trim().max(50).optional().or(z.literal("")),
    interested_unit_type: z.string().trim().max(30).optional().or(z.literal("")),
    budget_min: z
      .string()
      .optional()
      .refine(
        (s) => !s || (Number.isFinite(Number(s)) && Number(s) >= 0),
        "Enter a positive number",
      ),
    budget_max: z
      .string()
      .optional()
      .refine(
        (s) => !s || (Number.isFinite(Number(s)) && Number(s) >= 0),
        "Enter a positive number",
      ),
    notes: z
      .string()
      .trim()
      .max(2000, "Keep notes under 2000 characters")
      .optional()
      .or(z.literal("")),
    assigned_to: z.string().optional(),
    follow_up_date: z
      .string()
      .optional()
      .refine((s) => !s || !Number.isNaN(new Date(s).getTime()), "Enter a valid date"),
    stage: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.budget_min && v.budget_max) {
      const lo = Number(v.budget_min);
      const hi = Number(v.budget_max);
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi < lo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["budget_max"],
          message: "Maximum budget must be greater than or equal to minimum",
        });
      }
    }
  });

type LeadForm = {
  full_name: string;
  mobile: string;
  whatsapp: string;
  cnic: string;
  email: string;
  source: string;
  interested_project_code: string;
  interested_unit_type: string;
  budget_min: string;
  budget_max: string;
  notes: string;
  assigned_to: string;
  follow_up_date: string;
  stage: LeadStage;
};

const emptyForm = (): LeadForm => ({
  full_name: "",
  mobile: "",
  whatsapp: "",
  cnic: "",
  email: "",
  source: "Walk-in",
  interested_project_code: "",
  interested_unit_type: "",
  budget_min: "",
  budget_max: "",
  notes: "",
  assigned_to: "",
  follow_up_date: "",
  stage: "New Inquiry",
});

const daysBetween = (iso: string): number => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
};

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function LeadsCRM() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { companyId } = useAuth();
  const isMobile = useIsMobile();
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all"); // "all" | "unassigned" | employee id
  const [followUpFrom, setFollowUpFrom] = useState<string>("");
  const [followUpTo, setFollowUpTo] = useState<string>("");
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LeadForm>(emptyForm());
  const [dragging, setDragging] = useState<string | null>(null);

  const closeDialog = () => {
    setDialogMode(null);
    setEditingId(null);
    setForm(emptyForm());
  };

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

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-crm"],
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("project_code, project_name")
        .order("project_name");
      return (data ?? []) as { project_code: string; project_name: string }[];
    },
  });

  const { data: staff = [] } = useQuery({
    queryKey: ["staff-for-crm"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select("id, full_name, employee_id, mobile")
        .order("full_name");
      return (data ?? []) as {
        id: string;
        full_name: string;
        employee_id: string | null;
        mobile: string | null;
      }[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return leads.filter((l) => {
      if (q) {
        const nameHit = l.full_name.toLowerCase().includes(q);
        const phoneHit =
          digits.length > 0
            ? [l.mobile, l.whatsapp ?? ""].some((v) => v.replace(/\D/g, "").includes(digits))
            : [l.mobile, l.whatsapp ?? ""].some((v) => v.toLowerCase().includes(q));
        const otherHit = [
          l.cnic ?? "",
          l.email ?? "",
          l.interested_project_code ?? "",
          l.notes ?? "",
        ].some((v) => v.toLowerCase().includes(q));
        if (!nameHit && !phoneHit && !otherHit) return false;
      }
      if (projectFilter !== "all" && (l.interested_project_code ?? "") !== projectFilter)
        return false;
      if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
      if (assigneeFilter === "unassigned") {
        if (l.assigned_to) return false;
      } else if (assigneeFilter !== "all") {
        if (l.assigned_to !== assigneeFilter) return false;
      }
      if (followUpFrom || followUpTo) {
        if (!l.follow_up_date) return false;
        if (followUpFrom && l.follow_up_date < followUpFrom) return false;
        if (followUpTo && l.follow_up_date > followUpTo) return false;
      }
      return true;
    });
  }, [leads, search, projectFilter, sourceFilter, assigneeFilter, followUpFrom, followUpTo]);

  const activeFilterCount =
    (projectFilter !== "all" ? 1 : 0) +
    (sourceFilter !== "all" ? 1 : 0) +
    (assigneeFilter !== "all" ? 1 : 0) +
    (followUpFrom || followUpTo ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setProjectFilter("all");
    setSourceFilter("all");
    setAssigneeFilter("all");
    setFollowUpFrom("");
    setFollowUpTo("");
  };

  const followUpDue = useMemo(() => {
    const today = todayISO();
    return leads.filter(
      (l) =>
        l.follow_up_date &&
        l.follow_up_date <= today &&
        l.stage !== "Booking Done" &&
        l.stage !== "Lost",
    );
  }, [leads]);

  const openEdit = (l: Lead) => {
    setEditingId(l.id);
    setForm({
      full_name: l.full_name,
      mobile: l.mobile,
      whatsapp: l.whatsapp ?? "",
      cnic: l.cnic ?? "",
      email: l.email ?? "",
      source: l.source,
      interested_project_code: l.interested_project_code ?? "",
      interested_unit_type: l.interested_unit_type ?? "",
      budget_min: l.budget_min == null ? "" : String(l.budget_min),
      budget_max: l.budget_max == null ? "" : String(l.budget_max),
      notes: l.notes ?? "",
      assigned_to: l.assigned_to ?? "",
      follow_up_date: l.follow_up_date ?? "",
      stage: (l.stage as LeadStage) ?? "New Inquiry",
    });
    setDialogMode("edit");
  };

  const buildPayload = (f: LeadForm) => {
    const parsed = leadSchema.parse(f);
    const toNum = (s?: string) => {
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    return {
      full_name: parsed.full_name,
      mobile: parsed.mobile,
      whatsapp: parsed.whatsapp || null,
      cnic: parsed.cnic || null,
      email: parsed.email || null,
      source: parsed.source,
      interested_project_code: parsed.interested_project_code || null,
      interested_unit_type: parsed.interested_unit_type || null,
      budget_min: toNum(parsed.budget_min),
      budget_max: toNum(parsed.budget_max),
      notes: parsed.notes || null,
      assigned_to: parsed.assigned_to || null,
      follow_up_date: parsed.follow_up_date || null,
      stage: parsed.stage,
    };
  };

  const resolveAssignee = (assignedTo: string | null) => {
    if (!assignedTo) return null;
    const s = staff.find((x) => x.id === assignedTo);
    if (!s) return { id: assignedTo, fullName: null, email: null, mobile: null };
    return { id: s.id, fullName: s.full_name, email: null, mobile: s.mobile ?? null };
  };

  // ---- Optimistic-update helpers ----------------------------------------
  // Every write mutation follows the same 3-phase contract:
  //   onMutate  → cancel in-flight refetches, snapshot cache, patch cache
  //   onError   → roll back to the snapshot and surface the error
  //   onSettled → invalidate to reconcile with the server (temp ids, timestamps)
  const leadsKey = ["crm_leads"] as const;
  const snapshotLeads = () => qc.getQueryData<Lead[]>(leadsKey) ?? [];
  const writeLeads = (next: Lead[]) => qc.setQueryData<Lead[]>(leadsKey, next);
  const rollback = (prev: Lead[] | undefined) => {
    if (prev) qc.setQueryData<Lead[]>(leadsKey, prev);
  };

  // Build a temporary Lead row from a form so the Kanban/Table can render it
  // immediately, before the server assigns a real id.
  const draftLeadFromForm = (f: LeadForm): Lead => {
    const p = buildPayload(f);
    const now = new Date().toISOString();
    return {
      id: `temp-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`,
      full_name: p.full_name,
      mobile: p.mobile,
      whatsapp: p.whatsapp,
      cnic: p.cnic,
      email: p.email,
      source: p.source,
      interested_project_code: p.interested_project_code,
      interested_unit_type: p.interested_unit_type,
      budget_min: p.budget_min,
      budget_max: p.budget_max,
      notes: p.notes,
      assigned_to: p.assigned_to,
      follow_up_date: p.follow_up_date,
      stage: p.stage,
      stage_entered_at: now,
      converted_booking_id: null,
      created_at: now,
      updated_at: now,
    };
  };

  const addMutation = useMutation({
    mutationFn: async (f: LeadForm) => {
      const payload = buildPayload(f);
      const { data, error } = await supabase
        .from("crm_leads")
        .insert(withCompany(payload, companyId!))
        .select("id")
        .single();
      if (error) throw error;
      return { id: data?.id as string, payload };
    },
    onMutate: async (f) => {
      await qc.cancelQueries({ queryKey: leadsKey });
      const previous = snapshotLeads();
      const draft = draftLeadFromForm(f);
      writeLeads([draft, ...previous]);
      return { previous, tempId: draft.id };
    },
    onSuccess: (res, f, ctx) => {
      // Swap the temp row for one carrying the real id so subsequent edits target the right row.
      if (ctx?.tempId) {
        const current = snapshotLeads();
        writeLeads(current.map((l) => (l.id === ctx.tempId ? { ...l, id: res.id } : l)));
      }
      toast.success("Lead added");
      notifyAssignee({
        event: "created",
        leadId: res.id,
        leadName: f.full_name,
        stage: f.stage,
        assignee: resolveAssignee(f.assigned_to || null),
      });
      closeDialog();
    },
    onError: (e: any, _f, ctx) => {
      rollback(ctx?.previous);
      if (e instanceof z.ZodError) toast.error(e.issues[0]?.message ?? "Validation error");
      else toastError(e, "Couldn't add lead");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: leadsKey });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, f }: { id: string; f: LeadForm }) => {
      const payload = buildPayload(f);
      const { error } = await supabase
        .from("crm_leads")
        .update(payload)
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onMutate: async ({ id, f }) => {
      await qc.cancelQueries({ queryKey: leadsKey });
      const previous = snapshotLeads();
      const draft = draftLeadFromForm(f);
      writeLeads(
        previous.map((l) =>
          l.id === id
            ? {
                ...l,
                ...draft,
                id,
                created_at: l.created_at,
                converted_booking_id: l.converted_booking_id,
                stage_entered_at:
                  l.stage === draft.stage ? l.stage_entered_at : draft.stage_entered_at,
                updated_at: new Date().toISOString(),
              }
            : l,
        ),
      );
      return { previous };
    },
    onSuccess: (_d, v) => {
      toast.success("Lead updated");
      notifyAssignee({
        event: "updated",
        leadId: v.id,
        leadName: v.f.full_name,
        stage: v.f.stage,
        assignee: resolveAssignee(v.f.assigned_to || null),
      });
      closeDialog();
    },
    onError: (e: any, v, ctx) => {
      rollback(ctx?.previous);
      if (e instanceof z.ZodError) toast.error(e.issues[0]?.message ?? "Validation error");
      else toastError(e, "Couldn't update lead", { retry: () => updateMutation.mutate(v) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: leadsKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("crm_leads")
        .delete()
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: leadsKey });
      const previous = snapshotLeads();
      writeLeads(previous.filter((l) => l.id !== id));
      return { previous };
    },
    onSuccess: () => {
      toast.success("Lead deleted");
    },
    onError: (e: any, id, ctx) => {
      rollback(ctx?.previous);
      toastError(e, "Couldn't delete lead", { retry: () => deleteMutation.mutate(id) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: leadsKey });
    },
  });

  // Screen-reader announcement channel for stage changes and conversions.
  // Sonner toasts announce via their own live region, but that region is
  // shared with unrelated notifications and can be missed. `useLiveAnnouncer`
  // gives us a dedicated pair of live regions with a per-channel FIFO
  // queue + dedupe window so rapid successive stage changes (drag-drop
  // through multiple columns, retried mutations, Undo+redo bursts) can
  // never coalesce, cut each other off mid-sentence, or double-read.
  //   - polite  → ordinary stage moves and reverts
  //   - assertive → conversion to Booking Done + errors
  const { politeText: srMessage, assertiveText: srUrgent, announce } = useLiveAnnouncer();

  const stageMutation = useMutation({
    mutationFn: async ({
      id,
      stage,
    }: {
      id: string;
      stage: LeadStage;
      prevStage?: LeadStage;
      silent?: boolean;
    }) => {
      const { error } = await supabase
        .from("crm_leads")
        .update({ stage })
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: leadsKey });
      const previous = snapshotLeads();
      const now = new Date().toISOString();
      writeLeads(
        previous.map((l) =>
          l.id === id ? { ...l, stage, stage_entered_at: now, updated_at: now } : l,
        ),
      );
      // Cache the pre-mutation lead so onSuccess can still notify with fresh details.
      const leadAtMutate = previous.find((l) => l.id === id) ?? null;
      return { previous, leadAtMutate };
    },
    onSuccess: (_d, v, ctx) => {
      const lead = ctx?.leadAtMutate ?? leads.find((l) => l.id === v.id) ?? null;
      const leadName = lead?.full_name ?? "Lead";
      if (v.silent) {
        toast.success(`Reverted to "${v.stage}"`);
        announce(`${leadName} reverted to stage ${v.stage}.`);
        return;
      }
      const canUndo = v.prevStage && v.prevStage !== v.stage;
      toast.success(
        `Moved to "${v.stage}"`,
        canUndo
          ? {
              action: {
                label: "Undo",
                onClick: () =>
                  stageMutation.mutate({ id: v.id, stage: v.prevStage!, silent: true }),
              },
              duration: 8000,
            }
          : undefined,
      );

      if (v.stage === "Booking Done") {
        announce(
          `${leadName} converted to Booking Done. Booking can now be created from this lead.`,
          true,
        );
      } else {
        announce(`${leadName} moved to stage ${v.stage}.`);
      }

      if (lead) {
        notifyAssignee({
          event: v.stage === "Booking Done" ? "converted" : "updated",
          leadId: lead.id,
          leadName: lead.full_name,
          stage: v.stage,
          assignee: resolveAssignee(lead.assigned_to),
        });
      }
    },
    onError: (e: any, _v, ctx) => {
      rollback(ctx?.previous);
      const { title } = toastError(e, "Couldn't update stage");
      announce(`Stage update failed: ${title}`, true);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: leadsKey });
    },
  });

  // Which lead currently has an in-flight stage mutation. Used to disable
  // stage controls and render a spinner so users get consistent feedback
  // while the network request is pending (the cache is already updated
  // optimistically, so this is the only signal that work is still in flight).
  const mutatingLeadId = stageMutation.isPending ? (stageMutation.variables?.id ?? null) : null;

  // Confirmation state for stage changes (drag + Select + Lost).
  //
  // Focus restoration
  // -----------------
  // A stage change can originate from three surfaces: (a) a Kanban drop
  // handler, (b) the per-card stage Select, (c) the Table row Select.
  // None of these is naturally a Radix `AlertDialogTrigger`, so we
  // reproduce the trigger contract manually: capture the exact HTML
  // element that had focus when the confirmation was requested, then
  // return focus to that element on close via
  // `onCloseAutoFocus`. This matches AlertDialogTrigger's guarantee
  // — focus goes back to the control the user actually operated —
  // for the drag flow too, where the dragged card is the "trigger".
  const [pendingStage, setPendingStage] = useState<{
    id: string;
    prev: LeadStage;
    next: LeadStage;
    leadName: string;
  } | null>(null);
  const stageTriggerRef = useRef<HTMLElement | null>(null);

  const requestStageChange = (lead: Lead, next: LeadStage) => {
    const prev = lead.stage as LeadStage;
    if (prev === next) return;
    // Capture the currently focused element BEFORE React commits the
    // open state — by the time the dialog mounts, the originating
    // Select portal has unmounted and moved focus to <body>.
    const active =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    stageTriggerRef.current = active && active !== document.body ? active : null;
    setPendingStage({ id: lead.id, prev, next, leadName: lead.full_name });
  };

  const projectNameOf = (code: string | null) =>
    projects.find((p) => p.project_code === code)?.project_name ?? code ?? "—";
  const staffNameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "—";

  const [pendingConvert, setPendingConvert] = useState<Lead | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const convertToBooking = (l: Lead) => {
    setConvertError(null);
    setPendingConvert(l);
  };

  const performConvert = async (l: Lead) => {
    // Guard: block repeat activations (Retry click, Enter/Space) while in-flight.
    if (converting) return;
    setConverting(true);
    setConvertError(null);
    try {
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
        /* storage full — fall back to query param */
      }
      setPendingConvert(null);
      navigate(`/bookings?fromLead=${l.id}`);
    } catch (e: any) {
      const { title } = toastError(e, "Couldn't open the booking form");
      setConvertError(title);
    } finally {
      setConverting(false);
    }
  };

  const exportCSV = () => {
    if (filtered.length === 0) {
      toast.info("No leads to export");
      return;
    }
    const headers = [
      "Full Name",
      "Mobile",
      "WhatsApp",
      "CNIC",
      "Email",
      "Source",
      "Project",
      "Unit Type",
      "Budget Min",
      "Budget Max",
      "Assignee",
      "Stage",
      "Days in Stage",
      "Follow-up Date",
      "Notes",
      "Created At",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = filtered.map((l) =>
      [
        l.full_name,
        l.mobile,
        l.whatsapp ?? "",
        l.cnic ?? "",
        l.email ?? "",
        l.source,
        projectNameOf(l.interested_project_code),
        l.interested_unit_type ?? "",
        l.budget_min ?? "",
        l.budget_max ?? "",
        staffNameOf(l.assigned_to),
        l.stage,
        daysBetween(l.stage_entered_at),
        l.follow_up_date ?? "",
        (l.notes ?? "").replace(/\s+/g, " ").trim(),
        l.created_at.slice(0, 10),
      ]
        .map(esc)
        .join(","),
    );
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} lead${filtered.length === 1 ? "" : "s"}`);
  };

  if (isMobile) return <MobileLeadsCRM />;

  return (
    <div>
      {/* Screen-reader-only live regions for stage transitions. Kept
          outside PageHeader so route re-renders don't unmount them
          mid-announcement. `polite` for ordinary moves, `assertive`
          for conversions and errors. `sr-only` hides them visually
          while remaining discoverable to assistive tech. */}
      <div aria-live="polite" aria-atomic="true" role="status" className="sr-only">
        {srMessage}
      </div>
      <div aria-live="assertive" aria-atomic="true" role="alert" className="sr-only">
        {srUrgent}
      </div>
      <PageHeader
        title="Leads & CRM"
        description="Pipeline of prospective buyers, follow-ups, and lead-to-booking conversion"
        actions={
          <div className="flex items-center gap-2">
            <div
              role="radiogroup"
              aria-label="View mode"
              className="inline-flex rounded-md border overflow-hidden"
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                const next: "kanban" | "table" =
                  e.key === "Home"
                    ? "kanban"
                    : e.key === "End"
                      ? "table"
                      : view === "kanban"
                        ? "table"
                        : "kanban";
                setView(next);
                const el = e.currentTarget.querySelector<HTMLButtonElement>(
                  `[data-view="${next}"]`,
                );
                el?.focus();
              }}
            >
              <Button
                type="button"
                variant={view === "kanban" ? "default" : "ghost"}
                size="sm"
                className="rounded-none min-h-11 min-w-11"
                onClick={() => setView("kanban")}
                role="radio"
                aria-checked={view === "kanban"}
                tabIndex={view === "kanban" ? 0 : -1}
                data-view="kanban"
                aria-label="Kanban view"
              >
                <KanbanSquare className="h-4 w-4" />
                <span className="hidden sm:inline">Kanban</span>
              </Button>
              <Button
                type="button"
                variant={view === "table" ? "default" : "ghost"}
                size="sm"
                className="rounded-none min-h-11 min-w-11"
                onClick={() => setView("table")}
                role="radio"
                aria-checked={view === "table"}
                tabIndex={view === "table" ? 0 : -1}
                data-view="table"
                aria-label="Table view"
              >
                <LayoutList className="h-4 w-4" />
                <span className="hidden sm:inline">Table</span>
              </Button>
            </div>
            {view === "table" && (
              <Button
                type="button"
                variant="outline"
                onClick={exportCSV}
                disabled={filtered.length === 0}
                aria-label="Export leads as CSV"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export CSV</span>
              </Button>
            )}
            <Button
              onClick={() => {
                setForm(emptyForm());
                setEditingId(null);
                setDialogMode("add");
              }}
            >
              <Plus className="h-4 w-4" />
              <span>Add Lead</span>
            </Button>
          </div>
        }
      />

      {/* Summary strip */}
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label="Total Leads"
          value={String(leads.length)}
        />
        <SummaryCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Follow-ups Due"
          value={String(followUpDue.length)}
          tone={followUpDue.length > 0 ? "danger" : "default"}
        />
        <SummaryCard
          icon={<ArrowRightCircle className="h-4 w-4" />}
          label="Booked from Leads"
          value={String(leads.filter((l) => l.stage === "Booking Done").length)}
        />
      </div>

      {/* Search + filters */}
      <Card className="p-3 mb-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="relative lg:col-span-2">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              aria-label="Search leads by name or phone"
              placeholder="Search by name, phone, CNIC, email, project…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lead-filter-project" className="sr-only">
              Project
            </Label>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger id="lead-filter-project" aria-label="Filter by project">
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
          </div>
          <div>
            <Label htmlFor="lead-filter-source" className="sr-only">
              Source
            </Label>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger id="lead-filter-source" aria-label="Filter by source">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="lead-filter-assignee" className="sr-only">
              Assignee
            </Label>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger id="lead-filter-assignee" aria-label="Filter by assignee">
                <SelectValue placeholder="All assignees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 lg:col-span-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Follow-up range
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="date"
                aria-label="Follow-up from"
                value={followUpFrom}
                onChange={(e) => setFollowUpFrom(e.target.value)}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                aria-label="Follow-up to"
                value={followUpTo}
                onChange={(e) => setFollowUpTo(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>
        </div>
        {(activeFilterCount > 0 || search) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Showing {filtered.length} of {leads.length} leads
              {activeFilterCount > 0
                ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active`
                : ""}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 text-xs"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading leads…</Card>
      ) : view === "kanban" ? (
        <KanbanBoard
          leads={filtered}
          dragging={dragging}
          setDragging={setDragging}
          onMoveStage={(id, stage) => {
            const lead = leads.find((l) => l.id === id);
            if (lead) requestStageChange(lead, stage);
          }}
          onEdit={openEdit}
          onDelete={(id) => deleteMutation.mutate(id)}
          onConvert={convertToBooking}
          projectNameOf={projectNameOf}
          mutatingLeadId={mutatingLeadId}
        />
      ) : (
        <LeadsTable
          leads={filtered}
          onEdit={openEdit}
          onDelete={(id) => deleteMutation.mutate(id)}
          onConvert={convertToBooking}
          onStageChange={(id, stage) => {
            const lead = leads.find((l) => l.id === id);
            if (lead) requestStageChange(lead, stage);
          }}
          projectNameOf={projectNameOf}
          staffNameOf={staffNameOf}
          onAdd={() => {
            setForm(emptyForm());
            setEditingId(null);
            setDialogMode("add");
          }}
          mutatingLeadId={mutatingLeadId}
        />
      )}

      <Dialog
        open={dialogMode !== null}
        onOpenChange={(o) => {
          if (!o) {
            addMutation.reset();
            updateMutation.reset();
            closeDialog();
          }
        }}
      >
        <LeadFormDialog
          mode={dialogMode ?? "add"}
          form={form}
          setForm={setForm}
          projects={projects}
          staff={staff}
          submitting={addMutation.isPending || updateMutation.isPending}
          submitError={
            (dialogMode === "edit" ? updateMutation.error : addMutation.error) as Error | null
          }
          onSubmit={() => {
            addMutation.reset();
            updateMutation.reset();
            if (dialogMode === "edit" && editingId) {
              updateMutation.mutate({ id: editingId, f: form });
            } else {
              addMutation.mutate(form);
            }
          }}
        />
      </Dialog>

      <AlertDialog
        open={pendingStage !== null}
        onOpenChange={(o) => {
          if (!o) setPendingStage(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            // Override Radix's default focus-return (which restores to
            // whatever had focus at open — usually <body> because the
            // originating Select portal had already unmounted). Instead
            // route focus back to the exact control captured in
            // `requestStageChange`, matching AlertDialogTrigger's
            // contract regardless of how the confirmation was opened.
            const target = stageTriggerRef.current;
            if (target && document.contains(target)) {
              e.preventDefault();
              target.focus({ preventScroll: false });
            }
            stageTriggerRef.current = null;
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingStage?.next === "Lost"
                ? `Mark "${pendingStage?.leadName}" as Lost?`
                : `Move "${pendingStage?.leadName}" to ${pendingStage?.next}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStage ? (
                <>
                  Current stage: <strong>{pendingStage.prev}</strong> →{" "}
                  <strong>{pendingStage.next}</strong>.
                  {pendingStage.next === "Lost"
                    ? " Lost leads stop appearing in follow-ups. You can undo this from the toast."
                    : " You can undo this from the toast right after."}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                pendingStage?.next === "Lost"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => {
                if (!pendingStage) return;
                stageMutation.mutate({
                  id: pendingStage.id,
                  stage: pendingStage.next,
                  prevStage: pendingStage.prev,
                });
                setPendingStage(null);
              }}
            >
              {pendingStage?.next === "Lost" ? "Mark Lost" : "Confirm move"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConvertToBookingDialog
        lead={pendingConvert}
        projectNameOf={projectNameOf}
        onCancel={() => {
          setConvertError(null);
          setPendingConvert(null);
        }}
        onConfirm={performConvert}
        converting={converting}
        error={convertError}
      />
    </div>
  );
}

// ---- Sub components ------------------------------------------------------

function SummaryCard({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <Card className={cn("p-4", tone === "danger" && "border-destructive/40")}>
      <div
        className={cn(
          "flex items-center gap-2 text-xs uppercase tracking-wide",
          tone === "danger" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
    </Card>
  );
}

// ---- Kanban --------------------------------------------------------------

function KanbanBoard({
  leads,
  dragging,
  setDragging,
  onMoveStage,
  onEdit,
  onDelete,
  onConvert,
  projectNameOf,
  mutatingLeadId,
}: {
  leads: Lead[];
  dragging: string | null;
  setDragging: (id: string | null) => void;
  onMoveStage: (id: string, stage: LeadStage) => void;
  onEdit: (l: Lead) => void;
  onDelete: (id: string) => void;
  onConvert: (l: Lead) => void;
  projectNameOf: (code: string | null) => string;
  mutatingLeadId: string | null;
}) {
  const grouped = useMemo(() => {
    const map = new Map<LeadStage, Lead[]>();
    for (const s of LEAD_STAGES) map.set(s, []);
    for (const l of leads) {
      const s = (LEAD_STAGES as readonly string[]).includes(l.stage)
        ? (l.stage as LeadStage)
        : "New Inquiry";
      map.get(s)!.push(l);
    }
    return map;
  }, [leads]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2" role="list" aria-label="Leads pipeline">
      {LEAD_STAGES.map((stage) => (
        <KanbanColumn
          key={stage}
          stage={stage}
          leads={grouped.get(stage) ?? []}
          dragging={dragging}
          onDropLead={(id) => {
            const lead = leads.find((l) => l.id === id);
            if (lead && lead.stage !== stage) onMoveStage(id, stage);
            setDragging(null);
          }}
          onMoveStage={onMoveStage}
          onDragStart={setDragging}
          onDragEnd={() => setDragging(null)}
          onEdit={onEdit}
          onDelete={onDelete}
          onConvert={onConvert}
          projectNameOf={projectNameOf}
          mutatingLeadId={mutatingLeadId}
        />
      ))}
    </div>
  );
}

function KanbanColumn({
  stage,
  leads,
  dragging,
  onDropLead,
  onMoveStage,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  onConvert,
  projectNameOf,
  mutatingLeadId,
}: {
  stage: LeadStage;
  leads: Lead[];
  dragging: string | null;
  onDropLead: (id: string) => void;
  onMoveStage: (id: string, stage: LeadStage) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onEdit: (l: Lead) => void;
  onDelete: (id: string) => void;
  onConvert: (l: Lead) => void;
  projectNameOf: (code: string | null) => string;
  mutatingLeadId: string | null;
}) {
  const [over, setOver] = useState(false);
  const total = leads.reduce((s, l) => s + Number(l.budget_max ?? l.budget_min ?? 0), 0);

  return (
    <section role="listitem" aria-label={`${stage} column`} className="w-72 shrink-0 flex flex-col">
      <header className="flex items-center justify-between px-1 mb-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          {stage}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                tabIndex={0}
                aria-label={`${leads.length} lead${leads.length === 1 ? "" : "s"} in ${stage}`}
                className="min-h-5 px-2 py-0.5 text-xs leading-tight tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {leads.length}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {leads.length} lead{leads.length === 1 ? "" : "s"} in {stage}
            </TooltipContent>
          </Tooltip>
        </h2>
        {total > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">{fmtPKR(total)}</span>
        )}
      </header>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!over) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const id = e.dataTransfer.getData("text/plain") || dragging;
          if (id) onDropLead(id);
        }}
        className={cn(
          "flex-1 rounded-lg border-2 border-dashed p-2 min-h-[200px] space-y-2 transition-colors bg-muted/30",
          over ? "border-primary bg-primary/5" : "border-transparent",
        )}
      >
        {leads.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No leads</p>
        ) : (
          leads.map((l) => (
            <LeadCard
              key={l.id}
              lead={l}
              onDragStart={() => onDragStart(l.id)}
              onDragEnd={onDragEnd}
              onEdit={() => onEdit(l)}
              onDelete={() => onDelete(l.id)}
              onConvert={() => onConvert(l)}
              onMoveStage={(next: LeadStage) => onMoveStage(l.id, next)}
              projectNameOf={projectNameOf}
              isMutating={mutatingLeadId === l.id}
            />
          ))
        )}
      </div>
    </section>
  );
}

function LeadCard({
  lead,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  onConvert,
  onMoveStage,
  projectNameOf,
  isMutating,
}: {
  lead: Lead;
  onDragStart: () => void;
  onDragEnd: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onConvert: () => void;
  onMoveStage: (next: LeadStage) => void;
  projectNameOf: (code: string | null) => string;
  isMutating: boolean;
}) {
  const stageDays = daysBetween(lead.stage_entered_at);
  const isDueSoon =
    lead.follow_up_date &&
    lead.follow_up_date <= todayISO() &&
    lead.stage !== "Booking Done" &&
    lead.stage !== "Lost";
  const converted = lead.stage === "Booking Done";
  const budget = lead.budget_max ?? lead.budget_min;

  // Keyboard-accessible stage navigation: previous / next stage in the
  // pipeline. Complements the Select (which is keyboard-accessible too)
  // and drag-and-drop (which is not).
  const stageIndex = (LEAD_STAGES as readonly LeadStage[]).indexOf(lead.stage as LeadStage);
  const prevStage = stageIndex > 0 ? LEAD_STAGES[stageIndex - 1] : null;
  const nextStage =
    stageIndex >= 0 && stageIndex < LEAD_STAGES.length - 1 ? LEAD_STAGES[stageIndex + 1] : null;

  return (
    <Card
      draggable={!converted}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "p-3.5 sm:p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow",
        isDueSoon && "ring-1 ring-destructive/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium leading-tight truncate">{lead.full_name}</div>
          {(() => {
            const projectName = projectNameOf(lead.interested_project_code);
            const subtitle = `${projectName}${lead.interested_unit_type ? ` · ${lead.interested_unit_type}` : ""}`;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    tabIndex={0}
                    aria-label={subtitle}
                    className="mt-0.5 text-xs leading-snug text-muted-foreground truncate rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {subtitle}
                  </div>
                </TooltipTrigger>
                <TooltipContent>{subtitle}</TooltipContent>
              </Tooltip>
            );
          })()}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              tabIndex={0}
              aria-label={`In ${lead.stage} for ${stageDays} day${stageDays === 1 ? "" : "s"}`}
              className="shrink-0 border-foreground/25 px-2 py-0.5 text-xs leading-tight whitespace-nowrap focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {stageDays}d in stage
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            In {lead.stage} for {stageDays} day{stageDays === 1 ? "" : "s"}
          </TooltipContent>
        </Tooltip>
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs leading-snug sm:mt-2 sm:gap-y-1">
        <dt className="text-muted-foreground">Phone</dt>
        <dd className="text-right tabular-nums truncate">{lead.mobile}</dd>
        <dt className="text-muted-foreground">Budget</dt>
        <dd className="text-right tabular-nums truncate">{budget ? fmtPKR(budget) : "—"}</dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd className="text-right truncate">{lead.source}</dd>
        {lead.follow_up_date && (
          <>
            <dt className={cn("text-muted-foreground", isDueSoon && "text-destructive")}>
              Follow-up
            </dt>
            <dd
              className={cn("text-right tabular-nums", isDueSoon && "text-destructive font-medium")}
            >
              {fmtDate(lead.follow_up_date)}
            </dd>
          </>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label={`Call ${lead.full_name}`}
        >
          <a href={`tel:${lead.mobile}`}>
            <Phone className="h-3.5 w-3.5" />
          </a>
        </Button>
        {lead.whatsapp || lead.mobile ? (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label={`WhatsApp ${lead.full_name}`}
          >
            <a
              href={`https://wa.me/${(lead.whatsapp || lead.mobile).replace(/[^\d]/g, "").replace(/^0/, "92")}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          onClick={onEdit}
          aria-label={`Edit ${lead.full_name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <DeleteLeadButton name={lead.full_name} onConfirm={onDelete} compact />
        {/* Stage controls + Convert wrap to their own full-width row on mobile so
            the fixed-width Select and the Convert button never overlap the icons
            or each other at narrow widths. On sm+ they sit inline via ml-auto. */}
        <div
          className={cn(
            "mt-2 flex w-full basis-full items-center gap-1 sm:mt-0 sm:ml-auto sm:w-auto sm:basis-auto sm:flex-nowrap",
            isMutating && "opacity-70",
          )}
          aria-busy={isMutating || undefined}
        >
          {!converted && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11 shrink-0 hover:bg-accent hover:text-accent-foreground active:scale-[0.96] transition-transform"
                onClick={() => prevStage && onMoveStage(prevStage)}
                disabled={!prevStage || isMutating}
                aria-label={
                  prevStage
                    ? `Move ${lead.full_name} back to ${prevStage}`
                    : `${lead.full_name} is already in the first stage`
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11 shrink-0 hover:bg-accent hover:text-accent-foreground active:scale-[0.96] transition-transform"
                onClick={() => nextStage && onMoveStage(nextStage)}
                disabled={!nextStage || isMutating}
                aria-label={
                  nextStage
                    ? `Advance ${lead.full_name} to ${nextStage}`
                    : `${lead.full_name} is already in the last stage`
                }
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Select
                value={lead.stage}
                onValueChange={(v) => {
                  const next = v as LeadStage;
                  if (next !== lead.stage) onMoveStage(next);
                }}
                disabled={isMutating}
              >
                <SelectTrigger
                  className={cn(
                    "min-h-[48px] min-w-0 flex-1 text-xs transition-colors sm:min-h-11 sm:w-[140px] sm:flex-none",
                    "hover:bg-accent hover:text-accent-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-ring",
                    "data-[state=open]:ring-2 data-[state=open]:ring-ring data-[state=open]:border-ring data-[state=open]:bg-accent",
                    "active:bg-accent active:scale-[0.98]",
                    "disabled:cursor-wait disabled:opacity-100",
                  )}
                  aria-label={
                    isMutating
                      ? `Updating stage for ${lead.full_name}…`
                      : `Move ${lead.full_name} to another stage. Currently ${lead.stage}.`
                  }
                >
                  <span className="flex items-center gap-1.5 min-w-0 flex-1">
                    {isMutating && (
                      <Loader2
                        className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STAGES.map((s) => (
                    <SelectItem
                      key={s}
                      value={s}
                      className="min-h-[44px] py-2.5 text-sm sm:min-h-9 sm:py-1.5 sm:text-xs"
                    >
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {converted ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="secondary"
                  tabIndex={0}
                  aria-label="Converted to a booking"
                  className="shrink-0 px-2 py-0.5 text-xs leading-tight whitespace-nowrap focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Booked
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Converted to a booking</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 text-xs px-3 shrink-0"
              onClick={onConvert}
            >
              <ArrowRightCircle className="h-3.5 w-3.5" />
              Convert
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function DeleteLeadButton({
  name,
  onConfirm,
  compact = false,
}: {
  name: string;
  onConfirm: () => void;
  compact?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label={`Delete lead ${name}`}
        >
          <Trash2 className={cn("text-destructive", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
          <AlertDialogDescription>
            {name} will be removed from the pipeline. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---- Table view ----------------------------------------------------------

function LeadsTable({
  leads,
  onEdit,
  onDelete,
  onConvert,
  onStageChange,
  projectNameOf,
  staffNameOf,
  onAdd,
  mutatingLeadId,
}: {
  leads: Lead[];
  onEdit: (l: Lead) => void;
  onDelete: (id: string) => void;
  onConvert: (l: Lead) => void;
  onStageChange: (id: string, stage: LeadStage) => void;
  projectNameOf: (code: string | null) => string;
  staffNameOf: (id: string | null) => string;
  onAdd?: () => void;
  mutatingLeadId: string | null;
}) {
  if (leads.length === 0) {
    return (
      <Card className="p-0">
        <EmptyState
          icon={UserPlus}
          title="No leads yet"
          description="Capture your first inquiry to start tracking follow-ups and conversions to bookings."
          action={
            onAdd ? (
              <Button onClick={onAdd}>
                <Plus className="h-4 w-4 mr-1" /> Add Lead
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Phone</th>
              <th className="text-left px-3 py-2">Interested</th>
              <th className="text-right px-3 py-2">Budget</th>
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">Assigned</th>
              <th className="text-left px-3 py-2">Follow-up</th>
              <th className="text-left px-3 py-2">Stage</th>
              <th className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const isDue =
                l.follow_up_date &&
                l.follow_up_date <= todayISO() &&
                l.stage !== "Booking Done" &&
                l.stage !== "Lost";
              const budget = l.budget_max ?? l.budget_min;
              const isMutating = mutatingLeadId === l.id;
              return (
                <tr
                  key={l.id}
                  className={cn("border-t hover:bg-muted/30", isMutating && "opacity-70")}
                  aria-busy={isMutating || undefined}
                >
                  <td className="px-3 py-2 font-medium">{l.full_name}</td>
                  <td className="px-3 py-2 tabular-nums">{l.mobile}</td>
                  <td className="px-3 py-2">
                    <div className="truncate max-w-[180px]">
                      {projectNameOf(l.interested_project_code)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {l.interested_unit_type || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {budget ? fmtPKR(budget) : "—"}
                  </td>
                  <td className="px-3 py-2">{l.source}</td>
                  <td className="px-3 py-2 text-xs">{staffNameOf(l.assigned_to)}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-xs tabular-nums",
                      isDue && "text-destructive font-medium",
                    )}
                  >
                    {l.follow_up_date ? fmtDate(l.follow_up_date) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={l.stage}
                      onValueChange={(v) => onStageChange(l.id, v as LeadStage)}
                      disabled={isMutating}
                    >
                      <SelectTrigger
                        aria-label={
                          isMutating
                            ? `Updating stage for ${l.full_name}…`
                            : `Move ${l.full_name} to another stage. Currently ${l.stage}.`
                        }
                        className={cn(
                          "min-h-[44px] w-[160px] text-xs transition-colors sm:min-h-9",
                          "hover:bg-accent hover:text-accent-foreground",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-ring",
                          "data-[state=open]:ring-2 data-[state=open]:ring-ring data-[state=open]:border-ring data-[state=open]:bg-accent",
                          "active:bg-accent active:scale-[0.98]",
                          "disabled:cursor-wait disabled:opacity-100",
                        )}
                      >
                        <span className="flex items-center gap-1.5 min-w-0 flex-1">
                          {isMutating && (
                            <Loader2
                              className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                          <SelectValue />
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_STAGES.map((s) => (
                          <SelectItem
                            key={s}
                            value={s}
                            className="min-h-[44px] py-2.5 sm:min-h-9 sm:py-1.5"
                          >
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {l.stage !== "Booking Done" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onConvert(l)}
                        className="min-h-11 text-xs"
                      >
                        <ArrowRightCircle className="h-3.5 w-3.5" />
                        Convert
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11"
                      onClick={() => onEdit(l)}
                      aria-label={`Edit ${l.full_name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <DeleteLeadButton name={l.full_name} onConfirm={() => onDelete(l.id)} compact />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Form dialog ---------------------------------------------------------

function LeadFormDialog({
  mode,
  form,
  setForm,
  projects,
  staff,
  onSubmit,
  submitting,
  submitError,
}: {
  mode: "add" | "edit";
  form: LeadForm;
  setForm: (f: LeadForm) => void;
  projects: { project_code: string; project_name: string }[];
  staff: { id: string; full_name: string; employee_id: string | null }[];
  onSubmit: () => void;
  submitting: boolean;
  submitError: Error | null;
}) {
  const update = <K extends keyof LeadForm>(k: K, v: LeadForm[K]) => {
    setForm({ ...form, [k]: v });
    // Clear the specific field's error as soon as the user edits it, so
    // stale messages disappear immediately instead of waiting for blur.
    if (errors[k])
      setErrors((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
  };
  const isEdit = mode === "edit";

  type FieldKey = keyof LeadForm;
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [attempted, setAttempted] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Order matters: used to focus the FIRST invalid field on submit.
  const fieldOrder: FieldKey[] = [
    "full_name",
    "mobile",
    "whatsapp",
    "cnic",
    "email",
    "source",
    "stage",
    "interested_project_code",
    "interested_unit_type",
    "budget_min",
    "budget_max",
    "assigned_to",
    "follow_up_date",
    "notes",
  ];

  const runValidation = (f: LeadForm): Partial<Record<FieldKey, string>> => {
    const result = leadSchema.safeParse(f);
    if (result.success) return {};
    const map: Partial<Record<FieldKey, string>> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] as FieldKey | undefined;
      if (key && !map[key]) map[key] = issue.message;
    }
    return map;
  };

  const validateField = (k: FieldKey) => {
    const all = runValidation(form);
    setErrors((prev) => ({ ...prev, [k]: all[k] }));
  };

  const errId = (k: FieldKey) => `${k}-error`;
  const descProps = (k: FieldKey) =>
    errors[k] ? { "aria-invalid": true as const, "aria-describedby": errId(k) } : {};

  const FieldError = ({ k }: { k: FieldKey }) =>
    errors[k] ? (
      <p id={errId(k)} role="alert" className="mt-1 text-xs text-destructive">
        {errors[k]}
      </p>
    ) : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Guard against Enter-in-input re-submits while a mutation is in flight.
    if (submitting) return;
    setAttempted(true);
    const all = runValidation(form);
    setErrors(all);
    if (Object.keys(all).length > 0) {
      // Focus the first invalid field in visual order.
      const first = fieldOrder.find((k) => all[k]);
      if (first && formRef.current) {
        const el = formRef.current.querySelector<HTMLElement>(`#${first}`);
        el?.focus();
      }
      return;
    }
    onSubmit();
  };

  const errorCount = Object.values(errors).filter(Boolean).length;

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit Lead" : "Add Lead"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update contact and follow-up details."
            : "Record a new prospective buyer inquiry."}
        </DialogDescription>
      </DialogHeader>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        {attempted && errorCount > 0 && (
          <div
            role="alert"
            aria-live="polite"
            className="sm:col-span-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              {errorCount === 1
                ? "Please fix the highlighted field before saving."
                : `Please fix the ${errorCount} highlighted fields before saving.`}
            </p>
          </div>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor="full_name">Full Name *</Label>
          <Input
            id="full_name"
            required
            value={form.full_name}
            onChange={(e) => update("full_name", e.target.value)}
            onBlur={() => validateField("full_name")}
            placeholder="e.g. Ahmed Khan"
            {...descProps("full_name")}
          />
          <FieldError k="full_name" />
        </div>
        <div>
          <Label htmlFor="mobile">Mobile *</Label>
          <Input
            id="mobile"
            required
            inputMode="tel"
            value={form.mobile}
            onChange={(e) => update("mobile", e.target.value)}
            onBlur={() => validateField("mobile")}
            placeholder="03001234567"
            {...descProps("mobile")}
          />
          <FieldError k="mobile" />
        </div>
        <div>
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input
            id="whatsapp"
            inputMode="tel"
            value={form.whatsapp}
            onChange={(e) => update("whatsapp", e.target.value)}
            onBlur={() => validateField("whatsapp")}
            placeholder="Optional"
            {...descProps("whatsapp")}
          />
          <FieldError k="whatsapp" />
        </div>
        <div>
          <Label htmlFor="cnic">CNIC</Label>
          <Input
            id="cnic"
            value={form.cnic}
            onChange={(e) => update("cnic", e.target.value)}
            onBlur={() => validateField("cnic")}
            placeholder="12345-1234567-1"
            {...descProps("cnic")}
          />
          <FieldError k="cnic" />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            onBlur={() => validateField("email")}
            placeholder="Optional"
            {...descProps("email")}
          />
          <FieldError k="email" />
        </div>
        <div>
          <Label htmlFor="source">Source *</Label>
          <Select value={form.source} onValueChange={(v) => update("source", v)}>
            <SelectTrigger id="source" {...descProps("source")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError k="source" />
        </div>
        <div>
          <Label htmlFor="stage">Stage</Label>
          <Select value={form.stage} onValueChange={(v) => update("stage", v as LeadStage)}>
            <SelectTrigger id="stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="interested_project_code">Interested Project</Label>
          <Select
            value={form.interested_project_code || "__none__"}
            onValueChange={(v) => update("interested_project_code", v === "__none__" ? "" : v)}
          >
            <SelectTrigger id="interested_project_code">
              <SelectValue placeholder="No project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None —</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.project_code} value={p.project_code}>
                  {p.project_code} · {p.project_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="interested_unit_type">Interested Unit Type</Label>
          <Select
            value={form.interested_unit_type || "__none__"}
            onValueChange={(v) => update("interested_unit_type", v === "__none__" ? "" : v)}
          >
            <SelectTrigger id="interested_unit_type">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Any —</SelectItem>
              {UNIT_TYPES.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="budget_min">Budget Min (PKR)</Label>
          <Input
            id="budget_min"
            type="number"
            min="0"
            inputMode="decimal"
            value={form.budget_min}
            onChange={(e) => update("budget_min", e.target.value)}
            onBlur={() => {
              validateField("budget_min");
              validateField("budget_max");
            }}
            placeholder="0"
            {...descProps("budget_min")}
          />
          <FieldError k="budget_min" />
        </div>
        <div>
          <Label htmlFor="budget_max">Budget Max (PKR)</Label>
          <Input
            id="budget_max"
            type="number"
            min="0"
            inputMode="decimal"
            value={form.budget_max}
            onChange={(e) => update("budget_max", e.target.value)}
            onBlur={() => validateField("budget_max")}
            placeholder="0"
            {...descProps("budget_max")}
          />
          <FieldError k="budget_max" />
        </div>
        <div>
          <Label htmlFor="assigned_to">Assigned To</Label>
          <Select
            value={form.assigned_to || "__none__"}
            onValueChange={(v) => update("assigned_to", v === "__none__" ? "" : v)}
          >
            <SelectTrigger id="assigned_to">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Unassigned —</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="follow_up_date">Follow-up Date</Label>
          <Input
            id="follow_up_date"
            type="date"
            value={form.follow_up_date}
            onChange={(e) => update("follow_up_date", e.target.value)}
            onBlur={() => validateField("follow_up_date")}
            {...descProps("follow_up_date")}
          />
          <FieldError k="follow_up_date" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            onBlur={() => validateField("notes")}
            placeholder="Preferences, next actions, context…"
            {...descProps("notes")}
          />
          <FieldError k="notes" />
        </div>
        {submitError && (
          <div
            role="alert"
            aria-live="assertive"
            className="sm:col-span-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-medium">Couldn't {isEdit ? "update" : "save"} lead</p>
              <p className="mt-1 text-xs">
                {friendlyError(submitError, `Couldn't ${isEdit ? "update" : "save"} lead`).title}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 min-w-11 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
              disabled={submitting}
              onClick={() => formRef.current?.requestSubmit()}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}
        <DialogFooter className="sm:col-span-2">
          <Button type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? (isEdit ? "Updating…" : "Saving…") : isEdit ? "Update Lead" : "Save Lead"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

// ---- Convert to Booking confirmation ------------------------------------

function ConvertToBookingDialog({
  lead,
  projectNameOf,
  onCancel,
  onConfirm,
  converting,
  error,
}: {
  lead: Lead | null;
  projectNameOf: (code: string | null) => string;
  onCancel: () => void;
  onConfirm: (l: Lead) => void;
  converting: boolean;
  error: string | null;
}) {
  // Per-field validation — surface the exact reason each pre-fill value
  // is unusable so the user knows which lead field to fix, rather than
  // just seeing a generic "missing data" banner.
  type ConvertIssue = { field: "Mobile" | "CNIC"; message: string };
  const issues: ConvertIssue[] = [];
  if (lead) {
    const mobile = lead.mobile?.trim() ?? "";
    if (!mobile) issues.push({ field: "Mobile", message: "Mobile is required to open a booking." });
    else if (!PK_MOBILE_RE.test(mobile))
      issues.push({
        field: "Mobile",
        message: "Mobile must be a valid Pakistan number (03xxxxxxxxx).",
      });

    const cnic = lead.cnic?.trim() ?? "";
    if (!cnic) issues.push({ field: "CNIC", message: "CNIC is required to open a booking." });
    else if (!PK_CNIC_RE.test(cnic))
      issues.push({ field: "CNIC", message: "CNIC must be 13 digits (e.g. 12345-1234567-1)." });
  }
  const issueByField = (f: ConvertIssue["field"]) => issues.find((i) => i.field === f);
  const blocked = issues.length > 0;

  return (
    <Dialog
      open={lead !== null}
      onOpenChange={(o) => {
        if (!o && !converting) onCancel();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert lead to booking?</DialogTitle>
          <DialogDescription>
            Review the fields that will pre-fill the New Booking form. You can edit anything on the
            next screen before saving.
          </DialogDescription>
        </DialogHeader>

        {lead && (
          <>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Full name</dt>
              <dd className="col-span-2 font-medium">{lead.full_name}</dd>

              <dt className="text-muted-foreground">Mobile</dt>
              <dd
                className={cn(
                  "col-span-2 tabular-nums",
                  issueByField("Mobile") && "text-destructive",
                )}
              >
                {lead.mobile?.trim() || "— missing —"}
                {issueByField("Mobile") && (
                  <p role="alert" className="mt-0.5 text-xs font-normal">
                    {issueByField("Mobile")!.message}
                  </p>
                )}
              </dd>

              <dt className="text-muted-foreground">CNIC</dt>
              <dd
                className={cn(
                  "col-span-2 tabular-nums",
                  issueByField("CNIC") && "text-destructive",
                )}
              >
                {lead.cnic?.trim() || "— missing —"}
                {issueByField("CNIC") && (
                  <p role="alert" className="mt-0.5 text-xs font-normal">
                    {issueByField("CNIC")!.message}
                  </p>
                )}
              </dd>

              <dt className="text-muted-foreground">Project</dt>
              <dd className="col-span-2">{projectNameOf(lead.interested_project_code)}</dd>

              <dt className="text-muted-foreground">Unit type</dt>
              <dd className="col-span-2">{lead.interested_unit_type || "—"}</dd>
            </dl>

            {blocked && (
              <div
                role="alert"
                aria-live="polite"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">
                    Fix {issues.length === 1 ? "1 field" : `${issues.length} fields`} before
                    converting
                  </p>
                  <p className="mt-1 text-xs">
                    Edit the lead to correct {issues.map((i) => i.field).join(" and ")}, then try
                    Convert again.
                  </p>
                </div>
              </div>
            )}

            {error && !blocked && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <div className="flex-1">
                  <p className="font-medium">Couldn't open booking form</p>
                  <p className="mt-1 text-xs">{error}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11 min-w-11 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={converting || !lead}
                  onClick={() => lead && onConfirm(lead)}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  Retry
                </Button>
              </div>
            )}

            {converting && (
              <p
                className="flex items-center gap-2 text-xs text-muted-foreground"
                aria-live="polite"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Preparing booking form…
              </p>
            )}
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={converting}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={blocked || !lead || converting}
            aria-busy={converting}
            onClick={() => lead && onConfirm(lead)}
          >
            {converting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRightCircle className="h-4 w-4" aria-hidden="true" />
            )}
            {converting ? "Opening…" : "Continue to booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
