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
import { CheckCircle2, ChevronRight, Building2 } from "lucide-react";

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
      .select("id", { count: "exact", head: true })
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

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-2xl px-4 py-8 lg:py-14">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-6">
          <div className="h-9 w-9 rounded-xl bg-primary/15 grid place-items-center text-primary">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="font-semibold">{companyName ?? "Your workspace"}</div>
            <div className="text-xs text-muted-foreground">Let's get you set up</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs mb-2">
            <div className="font-medium">
              Step {step + 1} of {STEPS.length}
              <span className="text-muted-foreground"> — {STEPS[step]}</span>
            </div>
            <div className="text-muted-foreground">{Math.round(progressPct)}%</div>
          </div>
          <div
            className="h-2 rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={step + 1}
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
          >
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <ol className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={
                  "flex items-center gap-1.5 " + (i <= step ? "text-foreground font-medium" : "")
                }
              >
                {i < step ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                ) : (
                  <span
                    className={
                      "h-4 w-4 rounded-full grid place-items-center text-[10px] " +
                      (i === step ? "bg-primary text-primary-foreground" : "bg-muted")
                    }
                  >
                    {i + 1}
                  </span>
                )}
                {label}
              </li>
            ))}
          </ol>
        </div>

        {pendingDraft && (
          <Card
            role="alertdialog"
            aria-labelledby="resume-title"
            aria-describedby="resume-desc"
            className="p-5 lg:p-6 mb-4 border-primary/40 bg-primary/5"
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/15 grid place-items-center text-primary shrink-0">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 id="resume-title" className="font-semibold">
                  Resume where you left off?
                </h2>
                <p id="resume-desc" className="text-sm text-muted-foreground mt-1">
                  We saved your progress on{" "}
                  <span className="font-medium text-foreground">
                    Step {pendingDraft.step + 1} — {STEPS[pendingDraft.step]}
                  </span>
                  {pendingDraft.project.project_code ? (
                    <>
                      {" "}
                      for project{" "}
                      <span className="font-mono text-foreground">
                        {pendingDraft.project.project_code}
                      </span>
                    </>
                  ) : null}
                  . Continue with those details, or start fresh.
                </p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button size="sm" className="min-h-11" onClick={resumeDraft}>
                    Resume onboarding
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-11" onClick={discardDraft}>
                    Start over
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {!pendingDraft && restoredStep !== null && (
          <Card
            role="status"
            aria-live="polite"
            className="p-4 lg:p-5 mb-4 border-primary/30 bg-primary/5"
          >
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/15 grid place-items-center text-primary shrink-0">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0 text-sm">
                <div className="font-medium">
                  Draft restored — you're back on{" "}
                  <span className="text-primary">
                    Step {restoredStep + 1}: {STEPS[restoredStep]}
                  </span>
                  .
                </div>
                <p className="text-muted-foreground mt-1">
                  Your saved details are filled in below. Changes are saved automatically as you
                  continue.
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-9 -mr-2"
                onClick={() => setRestoredStep(null)}
                aria-label="Dismiss draft restored notice"
              >
                Dismiss
              </Button>
            </div>
          </Card>
        )}

        <Card className="p-6 lg:p-8">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold">Add your first project</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  A project groups units, bookings and payments together.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="p-code">
                    Project code{" "}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Input
                    id="p-code"
                    placeholder="e.g. MA"
                    value={project.project_code}
                    onChange={(e) => setProjectField("project_code", e.target.value.toUpperCase())}
                    maxLength={10}
                    required
                    aria-invalid={!!projectErrors.project_code}
                    aria-describedby={projectErrors.project_code ? "p-code-err" : undefined}
                    className="min-h-11 font-mono"
                  />
                  {projectErrors.project_code && (
                    <p id="p-code-err" role="alert" className="text-xs text-destructive">
                      {projectErrors.project_code}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-name">
                    Project name{" "}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Input
                    id="p-name"
                    placeholder="e.g. Manal Arcade"
                    value={project.project_name}
                    onChange={(e) => setProjectField("project_name", e.target.value)}
                    required
                    aria-invalid={!!projectErrors.project_name}
                    aria-describedby={projectErrors.project_name ? "p-name-err" : undefined}
                    className="min-h-11"
                  />
                  {projectErrors.project_name && (
                    <p id="p-name-err" role="alert" className="text-xs text-destructive">
                      {projectErrors.project_name}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-location">
                    Location{" "}
                    <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="p-location"
                    placeholder="City / area"
                    value={project.location}
                    onChange={(e) => setProjectField("location", e.target.value)}
                    className="min-h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-units">
                    Total units{" "}
                    <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="p-units"
                    type="number"
                    min={1}
                    placeholder="e.g. 48"
                    value={project.total_units}
                    onChange={(e) => setProjectField("total_units", e.target.value)}
                    aria-invalid={!!projectErrors.total_units}
                    aria-describedby={projectErrors.total_units ? "p-units-err" : undefined}
                    className="min-h-11"
                  />
                  {projectErrors.total_units && (
                    <p id="p-units-err" role="alert" className="text-xs text-destructive">
                      {projectErrors.total_units}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Button size="lg" className="min-h-11" onClick={saveProject} disabled={busy}>
                  {busy ? "Saving…" : "Continue"}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold">Add your first unit</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Under project <span className="font-mono">{project.project_code}</span> —{" "}
                  {project.project_name}
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="u-no">
                    Unit ID{" "}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Input
                    id="u-no"
                    placeholder="e.g. 101"
                    value={unit.unit_no}
                    onChange={(e) => setUnitField("unit_no", e.target.value)}
                    required
                    aria-invalid={!!unitErrors.unit_no}
                    aria-describedby={unitErrors.unit_no ? "u-no-err" : undefined}
                    className="min-h-11 font-mono"
                  />
                  {unitErrors.unit_no && (
                    <p id="u-no-err" role="alert" className="text-xs text-destructive">
                      {unitErrors.unit_no}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="u-type">
                    Type{" "}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Select
                    value={unit.unit_type}
                    onValueChange={(v) => setUnit((u) => ({ ...u, unit_type: v as UnitType }))}
                  >
                    <SelectTrigger id="u-type" className="min-h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="u-size">
                    Size (sqft){" "}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Input
                    id="u-size"
                    type="number"
                    min={1}
                    value={unit.size_sqft}
                    onChange={(e) => setUnitField("size_sqft", e.target.value)}
                    required
                    aria-invalid={!!unitErrors.size_sqft}
                    aria-describedby={unitErrors.size_sqft ? "u-size-err" : undefined}
                    className="min-h-11"
                  />
                  {unitErrors.size_sqft && (
                    <p id="u-size-err" role="alert" className="text-xs text-destructive">
                      {unitErrors.size_sqft}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="u-rate">
                    Base price / sqft (PKR){" "}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Input
                    id="u-rate"
                    type="number"
                    min={1}
                    value={unit.base_rate}
                    onChange={(e) => setUnitField("base_rate", e.target.value)}
                    required
                    aria-invalid={!!unitErrors.base_rate}
                    aria-describedby={unitErrors.base_rate ? "u-rate-err" : undefined}
                    className="min-h-11"
                  />
                  {unitErrors.base_rate && (
                    <p id="u-rate-err" role="alert" className="text-xs text-destructive">
                      {unitErrors.base_rate}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep(0)} disabled={busy}>
                  Back
                </Button>
                <Button size="lg" className="min-h-11" onClick={saveUnit} disabled={busy}>
                  {busy ? "Saving…" : "Continue"}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold">Review your setup</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Confirm the details below before finishing. You can go back to edit anything.
                </p>
              </div>

              <section
                aria-labelledby="review-project"
                className="rounded-xl border border-border overflow-hidden"
              >
                <header className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                  <h2 id="review-project" className="text-sm font-semibold">
                    Project
                  </h2>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-9 -mr-2"
                    onClick={() => setStep(0)}
                    disabled={busy}
                  >
                    Edit
                  </Button>
                </header>
                <dl className="divide-y divide-border text-sm">
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                    <dt className="text-muted-foreground">Code</dt>
                    <dd className="col-span-2 font-mono">{project.project_code || "—"}</dd>
                  </div>
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                    <dt className="text-muted-foreground">Name</dt>
                    <dd className="col-span-2">{project.project_name || "—"}</dd>
                  </div>
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                    <dt className="text-muted-foreground">Location</dt>
                    <dd className="col-span-2">
                      {project.location.trim() || (
                        <span className="text-muted-foreground">Not set</span>
                      )}
                    </dd>
                  </div>
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                    <dt className="text-muted-foreground">Total units</dt>
                    <dd className="col-span-2">
                      {project.total_units.trim() || (
                        <span className="text-muted-foreground">Not set</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                aria-labelledby="review-unit"
                className="rounded-xl border border-border overflow-hidden"
              >
                <header className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                  <h2 id="review-unit" className="text-sm font-semibold">
                    First unit
                  </h2>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-9 -mr-2"
                    onClick={() => setStep(1)}
                    disabled={busy}
                  >
                    Edit
                  </Button>
                </header>
                <dl className="divide-y divide-border text-sm">
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                    <dt className="text-muted-foreground">Unit ID</dt>
                    <dd className="col-span-2 font-mono">
                      {project.project_code && unit.unit_no
                        ? `${project.project_code.toUpperCase()}-${unit.unit_no.trim().toUpperCase()}`.replace(
                            /\s+/g,
                            "",
                          )
                        : "—"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                    <dt className="text-muted-foreground">Type</dt>
                    <dd className="col-span-2">{unit.unit_type}</dd>
                  </div>
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                    <dt className="text-muted-foreground">Size</dt>
                    <dd className="col-span-2">
                      {unit.size_sqft ? `${Number(unit.size_sqft).toLocaleString()} sqft` : "—"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                    <dt className="text-muted-foreground">Base price</dt>
                    <dd className="col-span-2">
                      {unit.base_rate
                        ? `PKR ${Number(unit.base_rate).toLocaleString()} / sqft`
                        : "—"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                    <dt className="text-muted-foreground">Standard value</dt>
                    <dd className="col-span-2 font-medium">
                      {unit.size_sqft && unit.base_rate
                        ? `PKR ${(Number(unit.size_sqft) * Number(unit.base_rate)).toLocaleString()}`
                        : "—"}
                    </dd>
                  </div>
                </dl>
              </section>

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>
                  Back
                </Button>
                <Button size="lg" className="min-h-11" onClick={() => setStep(3)} disabled={busy}>
                  Looks good — continue
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold">Add your first booking</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  You can add your first booking now, or skip and do it later from the Bookings
                  page.
                </p>
              </div>
              <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                Bookings capture buyer details, dealer commission, adjustments and installment plan.
                It's a detailed form — we'll drop you into it now.
              </div>
              <div role="note" className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                <p className="font-medium text-foreground">What does “Skip” do?</p>
                <ul className="mt-2 space-y-1.5 text-muted-foreground list-disc pl-5">
                  <li>
                    <span className="text-foreground font-medium">Marks setup complete</span> — the
                    wizard won't reappear on future logins and you go straight to your Dashboard.
                  </li>
                  <li>
                    You can add bookings anytime from the{" "}
                    <span className="font-medium text-foreground">Bookings</span> page.
                  </li>
                  <li>
                    <span className="text-foreground font-medium">Finish &amp; add booking</span>{" "}
                    also marks setup complete, then takes you to the Bookings form so you can enter
                    one now.
                  </li>
                </ul>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>
                  Back
                </Button>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => finish("Setup complete — you can add a booking anytime")}
                    disabled={busy}
                  >
                    Skip for now
                  </Button>
                  <Button
                    size="lg"
                    className="min-h-11"
                    onClick={async () => {
                      await finish("Setup complete — let's add your first booking");
                      navigate("/bookings");
                    }}
                    disabled={busy}
                  >
                    Finish & add booking
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
