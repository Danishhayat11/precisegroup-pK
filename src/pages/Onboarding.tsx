/**
 * 3-step onboarding wizard for freshly bootstrapped companies.
 *
 * Step 1: create the first Project
 * Step 2: create the first Unit under that project
 * Step 3: prompt to add a first Booking (or skip) — we hand off to
 *         /bookings for the booking itself since it has its own detailed form.
 *
 * The wizard is admin-only. Any non-admin lands here → redirect to /dashboard.
 * Finishing (or skipping) calls the `mark_onboarding_complete` RPC and the
 * user is dropped into /dashboard.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useNavigate, Navigate } from "@/lib/router-compat";
import { withCompany } from "@/lib/companyScope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { toastError } from "@/lib/friendlyError";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { CheckCircle2, ChevronRight, Building2, Sparkles, ArrowRight } from "lucide-react";

const STEPS = ["Project", "Unit", "Review", "Booking"] as const;
type StepIdx = 0 | 1 | 2 | 3;

const UNIT_TYPES = ["Apartment", "Shop", "Office", "House", "Plot", "Other"] as const;
type UnitType = (typeof UNIT_TYPES)[number];

// localStorage key scoped per company so multiple orgs on one browser don't collide.
const draftKey = (companyId: string) => `onboarding-draft:${companyId}`;

type Draft = {
  step: StepIdx;
  project: { project_code: string; project_name: string; location: string; total_units: string };
  unit: { unit_no: string; unit_type: UnitType; size_sqft: string; base_rate: string };
};

const emptyProject = () => ({ project_code: "", project_name: "", location: "", total_units: "" });
const emptyUnit = () => ({
  unit_no: "",
  unit_type: "Apartment" as UnitType,
  size_sqft: "",
  base_rate: "",
});

// A draft is "meaningful" (worth resuming) if the user has advanced past step 1
// or typed anything into project/unit fields. An empty {step:0, ...} is ignored.
const isMeaningfulDraft = (d: Partial<Draft> | null | undefined): d is Draft => {
  if (!d || typeof d !== "object") return false;
  if (d.step === 1 || d.step === 2 || d.step === 3) return true;
  const p = d.project ?? ({} as Draft["project"]);
  const u = d.unit ?? ({} as Draft["unit"]);
  const anyProject = !!(p.project_code || p.project_name || p.location || p.total_units);
  const anyUnit = !!(u.unit_no || u.size_sqft || u.base_rate);
  return anyProject || anyUnit;
};

export default function Onboarding() {
  const { user, loading, companyId, companyName, isAdmin, onboardingCompleted, refreshCompany } =
    useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<StepIdx>(0);
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState(emptyProject);
  const [unit, setUnit] = useState(emptyUnit);
  // Gates the save effect until after the user has decided about any pending draft.
  const hydratedRef = useRef(false);
  // Draft found in storage that the user hasn't yet chosen to resume or discard.
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  // After the user resumes, remember which step was restored so we can show a
  // dismissible confirmation banner ("Draft restored — Step 2: Unit").
  const [restoredStep, setRestoredStep] = useState<StepIdx | null>(null);

  // Peek at persisted draft once companyId is known. If it's meaningful, hold it
  // and prompt the user; otherwise start a fresh session immediately.
  useEffect(() => {
    if (!companyId) return;
    if (hydratedRef.current || pendingDraft) return;
    if (typeof window === "undefined") {
      hydratedRef.current = true;
      return;
    }
    let parsed: Partial<Draft> | null = null;
    try {
      const raw = window.localStorage.getItem(draftKey(companyId));
      if (raw) parsed = JSON.parse(raw) as Partial<Draft>;
    } catch {
      /* corrupt draft — ignore and start fresh */
    }
    if (isMeaningfulDraft(parsed)) {
      setPendingDraft({
        step: parsed.step ?? 0,
        project: { ...emptyProject(), ...(parsed.project ?? {}) },
        unit: { ...emptyUnit(), ...(parsed.unit ?? {}) },
      });
    } else {
      hydratedRef.current = true;
    }
  }, [companyId, pendingDraft]);

  // Persist draft on every change once hydrated.
  useEffect(() => {
    if (!companyId) return;
    if (!hydratedRef.current) return;
    if (typeof window === "undefined") return;
    try {
      const draft: Draft = { step, project, unit };
      window.localStorage.setItem(draftKey(companyId), JSON.stringify(draft));
    } catch {
      /* storage full / disabled — drafts just won't persist */
    }
  }, [companyId, step, project, unit]);

  const clearDraft = () => {
    if (!companyId || typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(draftKey(companyId));
    } catch {
      /* ignore */
    }
  };

  // Prerequisites guard: verify against the database what the highest step is
  // the user is actually allowed to be on. Step 1 requires a saved project,
  // step 2 requires a saved unit. Any attempt to jump ahead (via a stale draft,
  // a manipulated localStorage entry, or a future step-nav affordance) is
  // clamped down to the earliest incomplete step.
  const verifyMaxAllowedStep = async (target: StepIdx): Promise<StepIdx> => {
    if (!companyId || target === 0) return 0;
    const { count: projectCount, error: pErr } = await supabase
      .from("projects")
      .select("project_code", { count: "exact", head: true })
      .eq("company_id", companyId);
    if (pErr || !projectCount || projectCount < 1) return 0;
    if (target === 1) return 1;
    const { count: unitCount, error: uErr } = await supabase
      .from("units")
      .select("unit_id", { count: "exact", head: true })
      .eq("company_id", companyId);
    if (uErr || !unitCount || unitCount < 1) return 1;
    // Steps 2 (Review) and 3 (Booking) both only need a saved unit.
    return target === 2 ? 2 : 3;
  };

  const resumeDraft = async () => {
    if (!pendingDraft || busy) return;
    const requested = pendingDraft.step;
    setBusy(true);
    const allowed = await verifyMaxAllowedStep(requested);
    setBusy(false);
    setProject(pendingDraft.project);
    setUnit(pendingDraft.unit);
    setStep(allowed);
    setPendingDraft(null);
    setRestoredStep(allowed);
    hydratedRef.current = true;
    if (allowed < requested) {
      const missing = allowed === 0 ? "project" : "unit";
      toast.warning(
        `Resumed on Step ${allowed + 1} — please save your ${missing} before continuing to Step ${requested + 1}.`,
      );
    }
  };

  const discardDraft = () => {
    clearDraft();
    setPendingDraft(null);
    setRestoredStep(null);
    hydratedRef.current = true;
  };

  // Guard against jump-ahead navigation: if the component ever finds itself
  // on a step past what the DB supports (e.g. someone edits localStorage or
  // deletes the seed project mid-wizard), snap back to the earliest
  // incomplete step. Only runs after initial hydration so we don't fight the
  // resume-draft flow.
  useEffect(() => {
    if (!companyId || !hydratedRef.current) return;
    if (step === 0) return;
    let cancelled = false;
    void (async () => {
      const allowed = await verifyMaxAllowedStep(step);
      if (cancelled) return;
      if (allowed < step) {
        setStep(allowed);
        const missing = allowed === 0 ? "project" : "unit";
        toast.warning(`Please save your ${missing} first.`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, step]);

  // Inline field errors — cleared on edit, populated on submit / save failure.
  type ProjectField = "project_code" | "project_name" | "location" | "total_units";
  type UnitField = "unit_no" | "unit_type" | "size_sqft" | "base_rate";
  const [projectErrors, setProjectErrors] = useState<Partial<Record<ProjectField, string>>>({});
  const [unitErrors, setUnitErrors] = useState<Partial<Record<UnitField, string>>>({});

  const setProjectField = <K extends ProjectField>(k: K, v: string) => {
    setProject((p) => ({ ...p, [k]: v }));
    setProjectErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };
  const setUnitField = <K extends UnitField>(k: K, v: string) => {

    setUnit((u) => ({ ...u, [k]: v as any }));
    setUnitErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  // Non-admins never see the wizard.
  if (!isAdmin || onboardingCompleted) return <Navigate to="/dashboard" replace />;

  const progressPct = ((step + 1) / STEPS.length) * 100;

  const finish = async (message: string) => {
    setBusy(true);

    const { error } = await (supabase.rpc as any)("mark_onboarding_complete");
    setBusy(false);
    if (error) {
      toastError(error, "Couldn't complete setup", { retry: () => void finish(message) });
      return;
    }
    clearDraft();
    await refreshCompany();
    toast.success(message);
    navigate("/dashboard");
  };

  const validateProject = (): {
    errs: Partial<Record<ProjectField, string>>;
    code: string;
    name: string;
  } => {
    const code = project.project_code.trim().toUpperCase();
    const name = project.project_name.trim();
    const errs: Partial<Record<ProjectField, string>> = {};
    if (!code) errs.project_code = "Project code is required";
    else if (!/^[A-Z0-9]{2,10}$/.test(code))
      errs.project_code = "Use 2–10 letters or digits (e.g. MA, MH)";
    if (!name) errs.project_name = "Project name is required";
    else if (name.length < 2) errs.project_name = "Must be at least 2 characters";
    if (project.total_units.trim()) {
      const n = Number(project.total_units);
      if (!Number.isInteger(n) || n < 1) errs.total_units = "Must be a whole number of 1 or more";
    }
    return { errs, code, name };
  };

  const saveProject = async () => {
    if (busy) return;
    const { errs, code, name } = validateProject();
    setProjectErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("projects").insert(
      withCompany(
        {
          project_code: code,
          project_name: name,
          project_type: "Residential",
          location: project.location.trim() || null,
          status: "Active",
          notes: project.total_units ? `Planned total units: ${project.total_units}` : null,
        },
        companyId!,

      ) as any,
    );
    setBusy(false);
    if (error) {
      const isDup = error.code === "23505" || error.message.toLowerCase().includes("duplicate");
      const inline = isDup ? `Project code "${code}" already exists` : null;
      if (inline) {
        setProjectErrors((e) => ({ ...e, project_code: inline }));
      }
      toastError(error, isDup ? inline! : "Couldn't create project", {
        retry: () => void saveProject(),
      });
      return;
    }
    setProject((p) => ({ ...p, project_code: code }));
    toast.success(`Project ${code} created`);
    setStep(1);
  };

  const validateUnit = (): {
    errs: Partial<Record<UnitField, string>>;
    unitNo: string;
    size: number;
    rate: number;
  } => {
    const unitNo = unit.unit_no.trim();
    const size = Number(unit.size_sqft);
    const rate = Number(unit.base_rate);
    const errs: Partial<Record<UnitField, string>> = {};
    if (!unitNo) errs.unit_no = "Unit ID is required";
    else if (!/^[A-Za-z0-9-]{1,20}$/.test(unitNo))
      errs.unit_no = "Use letters, digits or dashes only (max 20)";
    if (!unit.size_sqft.trim()) errs.size_sqft = "Size is required";
    else if (!(size > 0)) errs.size_sqft = "Must be greater than 0";
    if (!unit.base_rate.trim()) errs.base_rate = "Base price is required";
    else if (!(rate > 0)) errs.base_rate = "Must be greater than 0";
    return { errs, unitNo, size, rate };
  };

  const saveUnit = async () => {
    if (busy) return;
    const code = project.project_code.trim().toUpperCase();
    const { errs, unitNo, size, rate } = validateUnit();
    setUnitErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    const unit_id = `${code}-${unitNo}`.toUpperCase().replace(/\s+/g, "");
    setBusy(true);
    const { error } = await supabase.from("units").insert(
      withCompany(
        {
          unit_id,
          project_code: code,
          project_name: project.project_name.trim(),
          unit_no: unitNo,
          unit_type: unit.unit_type,
          size_sqft: size,
          base_rate: rate,
          standard_value: size * rate,
          status: "Available",
        },
        companyId!,

      ) as any,
    );
    setBusy(false);
    if (error) {
      const isDup = error.code === "23505" || error.message.toLowerCase().includes("duplicate");
      const inline = isDup ? `Unit "${unit_id}" already exists` : null;
      if (inline) setUnitErrors((e) => ({ ...e, unit_no: inline }));
      toastError(error, isDup ? inline! : "Couldn't add unit", { retry: () => void saveUnit() });
      return;
    }
    toast.success(`Unit ${unit_id} added`);
    setStep(2);
  };

  const variants: Variants = {
    initial: { opacity: 0, y: 15, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, y: -15, scale: 0.98, transition: { duration: 0.2 } },
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-6">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />

      <div className="w-full max-w-[640px] relative z-10 py-10">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="h-16 w-16 rounded-[20px] bg-primary text-primary-foreground shadow-2xl shadow-primary/20 flex items-center justify-center mb-6">
            <Building2 className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {companyName ?? "Your Workspace"}
          </h1>
          <p className="text-muted-foreground mt-3 text-[15px] max-w-[85%] mx-auto leading-relaxed">
            Let's get your enterprise set up. We'll configure your first project and unit in under
            two minutes.
          </p>
        </div>

        {/* Progress Timeline */}
        <div className="mb-10 max-w-sm mx-auto">
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-muted rounded-full" />
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 bg-primary rounded-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }}
            />
            {STEPS.map((label, i) => {
              const active = i === step;
              const completed = i < step;
              return (
                <div key={label} className="relative z-10 flex flex-col items-center gap-2">
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 shadow-sm ${
                      active
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110"
                        : completed
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {completed ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-wider font-semibold absolute -bottom-5 whitespace-nowrap transition-colors duration-300 ${
                      active || completed ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {pendingDraft && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <div
              role="alertdialog"
              className="rounded-3xl p-6 bg-primary/5 border border-primary/20 backdrop-blur-md"
            >
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-[14px] bg-primary/15 grid place-items-center text-primary shrink-0">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-base">Resume where you left off?</h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                    We saved your progress on{" "}
                    <strong className="text-foreground font-medium">
                      Step {pendingDraft.step + 1} — {STEPS[pendingDraft.step]}
                    </strong>
                    {pendingDraft.project.project_code
                      ? ` for project ${pendingDraft.project.project_code}`
                      : ""}
                    . Continue with those details, or start fresh.
                  </p>
                  <div className="flex flex-wrap gap-2.5 mt-5">
                    <Button onClick={resumeDraft} className="rounded-full shadow-md min-h-11 px-6">
                      Resume onboarding
                    </Button>
                    <Button
                      variant="outline"
                      onClick={discardDraft}
                      className="rounded-full bg-background/50 backdrop-blur-sm min-h-11 px-6"
                    >
                      Start over
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {!pendingDraft && restoredStep !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mb-6"
          >
            <div
              role="status"
              className="rounded-2xl p-4 bg-primary/5 border border-primary/20 backdrop-blur-md flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm font-medium">
                  Draft restored — Step {restoredStep + 1}: {STEPS[restoredStep]}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRestoredStep(null)}
                className="min-h-11 px-4 rounded-full"
              >
                Dismiss
              </Button>
            </div>
          </motion.div>
        )}

        <div className="bg-card/60 border border-border/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[32px] overflow-hidden backdrop-blur-xl relative">
          <AnimatePresence mode="wait">
            {step === 0 && !pendingDraft && (
              <motion.div
                key="step-0"
                variants={variants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="p-8 sm:p-10 space-y-8"
              >
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Create your first project</h2>
                  <p className="text-muted-foreground mt-2 text-sm">
                    A project acts as the master container for your units, bookings, and payments.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label
                      htmlFor="p-code"
                      className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      Project Code *
                    </Label>
                    <Input
                      id="p-code"
                      placeholder="e.g. MA"
                      value={project.project_code}
                      onChange={(e) =>
                        setProjectField("project_code", e.target.value.toUpperCase())
                      }
                      maxLength={10}
                      required
                      aria-invalid={!!projectErrors.project_code}
                      className="min-h-12 rounded-xl bg-muted/50 border-border/60 font-mono text-base focus-visible:ring-primary/20 focus-visible:bg-background transition-all"
                    />
                    {projectErrors.project_code && (
                      <p className="text-[11px] text-destructive mt-1 font-medium">
                        {projectErrors.project_code}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="p-name"
                      className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      Project Name *
                    </Label>
                    <Input
                      id="p-name"
                      placeholder="e.g. Manal Arcade"
                      value={project.project_name}
                      onChange={(e) => setProjectField("project_name", e.target.value)}
                      required
                      aria-invalid={!!projectErrors.project_name}
                      className="min-h-12 rounded-xl bg-muted/50 border-border/60 text-base focus-visible:ring-primary/20 focus-visible:bg-background transition-all"
                    />
                    {projectErrors.project_name && (
                      <p className="text-[11px] text-destructive mt-1 font-medium">
                        {projectErrors.project_name}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="p-location"
                      className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      Location
                    </Label>
                    <Input
                      id="p-location"
                      placeholder="City / Area"
                      value={project.location}
                      onChange={(e) => setProjectField("location", e.target.value)}
                      className="min-h-12 rounded-xl bg-muted/50 border-border/60 text-base focus-visible:ring-primary/20 focus-visible:bg-background transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="p-units"
                      className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      Total Units
                    </Label>
                    <Input
                      id="p-units"
                      type="number"
                      min={1}
                      placeholder="e.g. 48"
                      value={project.total_units}
                      onChange={(e) => setProjectField("total_units", e.target.value)}
                      aria-invalid={!!projectErrors.total_units}
                      className="min-h-12 rounded-xl bg-muted/50 border-border/60 text-base focus-visible:ring-primary/20 focus-visible:bg-background transition-all"
                    />
                    {projectErrors.total_units && (
                      <p className="text-[11px] text-destructive mt-1 font-medium">
                        {projectErrors.total_units}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-border/50">
                  <Button
                    onClick={saveProject}
                    disabled={busy}
                    className="rounded-full min-h-12 px-8 font-semibold shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all hover:-translate-y-0.5"
                  >
                    {busy ? "Saving..." : "Continue"} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 1 && !pendingDraft && (
              <motion.div
                key="step-1"
                variants={variants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="p-8 sm:p-10 space-y-8"
              >
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Configure a unit</h2>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Adding a unit for{" "}
                    <span className="font-mono text-foreground font-medium bg-muted px-1.5 py-0.5 rounded">
                      {project.project_code}
                    </span>{" "}
                    — {project.project_name}.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label
                      htmlFor="u-no"
                      className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      Unit ID *
                    </Label>
                    <Input
                      id="u-no"
                      placeholder="e.g. 101"
                      value={unit.unit_no}
                      onChange={(e) => setUnitField("unit_no", e.target.value)}
                      required
                      aria-invalid={!!unitErrors.unit_no}
                      className="min-h-12 rounded-xl bg-muted/50 border-border/60 font-mono text-base focus-visible:ring-primary/20 focus-visible:bg-background transition-all"
                    />
                    {unitErrors.unit_no && (
                      <p className="text-[11px] text-destructive mt-1 font-medium">
                        {unitErrors.unit_no}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="u-type"
                      className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      Type *
                    </Label>
                    <Select
                      value={unit.unit_type}
                      onValueChange={(v) => setUnit((u) => ({ ...u, unit_type: v as UnitType }))}
                    >
                      <SelectTrigger
                        id="u-type"
                        className="min-h-12 rounded-xl bg-muted/50 border-border/60 focus:ring-primary/20"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {UNIT_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="rounded-lg">
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="u-size"
                      className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      Size (sqft) *
                    </Label>
                    <Input
                      id="u-size"
                      type="number"
                      min={1}
                      value={unit.size_sqft}
                      onChange={(e) => setUnitField("size_sqft", e.target.value)}
                      required
                      aria-invalid={!!unitErrors.size_sqft}
                      className="min-h-12 rounded-xl bg-muted/50 border-border/60 text-base focus-visible:ring-primary/20 focus-visible:bg-background transition-all"
                    />
                    {unitErrors.size_sqft && (
                      <p className="text-[11px] text-destructive mt-1 font-medium">
                        {unitErrors.size_sqft}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="u-rate"
                      className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
                    >
                      Base price / sqft (PKR) *
                    </Label>
                    <Input
                      id="u-rate"
                      type="number"
                      min={1}
                      value={unit.base_rate}
                      onChange={(e) => setUnitField("base_rate", e.target.value)}
                      required
                      aria-invalid={!!unitErrors.base_rate}
                      className="min-h-12 rounded-xl bg-muted/50 border-border/60 text-base focus-visible:ring-primary/20 focus-visible:bg-background transition-all"
                    />
                    {unitErrors.base_rate && (
                      <p className="text-[11px] text-destructive mt-1 font-medium">
                        {unitErrors.base_rate}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border/50">
                  <Button
                    variant="ghost"
                    onClick={() => setStep(0)}
                    disabled={busy}
                    className="rounded-full px-6"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={saveUnit}
                    disabled={busy}
                    className="rounded-full min-h-12 px-8 font-semibold shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all hover:-translate-y-0.5"
                  >
                    {busy ? "Saving..." : "Continue"} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 2 && !pendingDraft && (
              <motion.div
                key="step-2"
                variants={variants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="p-8 sm:p-10 space-y-8"
              >
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Review details</h2>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Everything looks good? You can go back to make changes if needed.
                  </p>
                </div>

                <div className="space-y-6">
                  {/* Project Summary */}
                  <div className="bg-muted/30 rounded-2xl p-5 border border-border/50 relative overflow-hidden group">
                    <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setStep(0)}
                        disabled={busy}
                        className="min-h-11 px-4 rounded-full text-xs"
                      >
                        Edit
                      </Button>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5" /> Project
                    </div>
                    <div className="grid grid-cols-2 gap-y-4 text-sm">
                      <div>
                        <span className="text-muted-foreground block mb-1 text-[11px] uppercase tracking-wider">
                          Code
                        </span>
                        <span className="font-mono font-medium">{project.project_code || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-1 text-[11px] uppercase tracking-wider">
                          Name
                        </span>
                        <span className="font-medium">{project.project_name || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-1 text-[11px] uppercase tracking-wider">
                          Location
                        </span>
                        <span>{project.location.trim() || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-1 text-[11px] uppercase tracking-wider">
                          Units
                        </span>
                        <span>{project.total_units.trim() || "—"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Unit Summary */}
                  <div className="bg-muted/30 rounded-2xl p-5 border border-border/50 relative overflow-hidden group">
                    <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setStep(1)}
                        disabled={busy}
                        className="min-h-11 px-4 rounded-full text-xs"
                      >
                        Edit
                      </Button>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Unit Profile
                    </div>
                    <div className="grid grid-cols-2 gap-y-4 text-sm">
                      <div>
                        <span className="text-muted-foreground block mb-1 text-[11px] uppercase tracking-wider">
                          Unit ID
                        </span>
                        <span className="font-mono font-medium">
                          {project.project_code && unit.unit_no
                            ? `${project.project_code.toUpperCase()}-${unit.unit_no.trim().toUpperCase()}`.replace(
                                /\s+/g,
                                "",
                              )
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-1 text-[11px] uppercase tracking-wider">
                          Type
                        </span>
                        <span className="font-medium">{unit.unit_type}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-1 text-[11px] uppercase tracking-wider">
                          Size
                        </span>
                        <span>
                          {unit.size_sqft ? `${Number(unit.size_sqft).toLocaleString()} sqft` : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-1 text-[11px] uppercase tracking-wider">
                          Base Rate
                        </span>
                        <span>
                          {unit.base_rate
                            ? `PKR ${Number(unit.base_rate).toLocaleString()} / sqft`
                            : "—"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-border/50 flex justify-between items-center">
                      <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        Standard Value
                      </span>
                      <span className="font-bold text-lg text-primary">
                        {unit.size_sqft && unit.base_rate
                          ? `PKR ${(Number(unit.size_sqft) * Number(unit.base_rate)).toLocaleString()}`
                          : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border/50">
                  <Button
                    variant="ghost"
                    onClick={() => setStep(1)}
                    disabled={busy}
                    className="rounded-full px-6"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={() => setStep(3)}
                    disabled={busy}
                    className="rounded-full min-h-12 px-8 font-semibold shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all hover:-translate-y-0.5 bg-[var(--primary)]"
                    style={{
                      background:
                        "linear-gradient(180deg, color-mix(in oklab, var(--primary) 90%, #fff 10%) 0%, var(--primary) 100%)", // allow-raw-color: needs white for mix
                    }}
                  >
                    Looks perfect <Sparkles className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 3 && !pendingDraft && (
              <motion.div
                key="step-3"
                variants={variants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="p-8 sm:p-10 space-y-8 text-center"
              >
                <div className="mx-auto w-20 h-20 rounded-full bg-success/10 text-success flex items-center justify-center mb-6">
                  <Sparkles className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">You're ready to launch</h2>
                  <p className="text-muted-foreground mt-3 text-[15px] leading-relaxed max-w-[90%] mx-auto">
                    Your workspace is successfully set up. You can immediately log your first
                    booking, or skip to explore the dashboard.
                  </p>
                </div>

                <div className="bg-muted/40 rounded-3xl p-6 border border-border/60 text-left">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-primary" /> First Booking
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    A booking captures buyer details, commission structures, adjustments, and an
                    installment plan. If you choose to add one now, we'll take you straight to the
                    Booking CRM.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                  <Button
                    variant="ghost"
                    onClick={() => setStep(2)}
                    disabled={busy}
                    className="absolute left-8 bottom-10 hidden sm:flex rounded-full px-6"
                  >
                    Back
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full sm:w-auto rounded-full min-h-12 px-8 bg-background/50 backdrop-blur-md border-border/60"
                    onClick={() => finish("Setup complete! Welcome to your Dashboard.")}
                    disabled={busy}
                  >
                    Skip for now
                  </Button>
                  <Button
                    className="w-full sm:w-auto rounded-full min-h-12 px-8 font-semibold shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all hover:-translate-y-0.5"
                    onClick={async () => {
                      await finish("Setup complete! Let's add your first booking.");
                      navigate("/bookings");
                    }}
                    disabled={busy}
                  >
                    Add First Booking <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
