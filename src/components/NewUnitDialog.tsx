/**
 * NewUnitDialog — quick-add a unit (Shop / Office / Apartment / Other) into
 * the currently active project. Standard value is derived automatically as
 * size_sqft × base_rate.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";
import { useActiveProject } from "@/lib/activeProject";
import { fmtPKR } from "@/lib/format";

const UNIT_TYPES = ["Shop", "Office", "Apartment", "House", "Plot", "Other"] as const;
type UnitType = (typeof UNIT_TYPES)[number];

export function NewUnitDialog({
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { companyId } = useAuth();
  const { activeProject, projects } = useActiveProject();

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (v: boolean) => {
    controlledOnOpenChange?.(v);
    if (controlledOpen === undefined) setUncontrolledOpen(v);
  };

  const [saving, setSaving] = useState(false);
  type NUErrors = {
    project_code?: string;
    unit_no?: string;
    size_sqft?: string;
    base_rate?: string;
  };
  const [errors, setErrors] = useState<NUErrors>({});
  const [form, setForm] = useState({
    project_code: activeProject?.project_code ?? "",
    unit_no: "",
    unit_type: "Apartment" as UnitType,
    floor: "",
    size_sqft: "",
    base_rate: "",
    notes: "",
  });

  // Keep project synced with the app-wide active project whenever it changes
  // (unless the user explicitly picks a different one inside the dialog).
  useEffect(() => {
    if (!open) {
      setForm((f) => ({ ...f, project_code: activeProject?.project_code ?? f.project_code }));
    }
  }, [activeProject, open]);

  const standardValue = useMemo(() => {
    const size = Number(form.size_sqft) || 0;
    const rate = Number(form.base_rate) || 0;
    return size * rate;
  }, [form.size_sqft, form.base_rate]);

  const reset = () => {
    setForm({
      project_code: activeProject?.project_code ?? "",
      unit_no: "",
      unit_type: "Apartment",
      floor: "",
      size_sqft: "",
      base_rate: "",
      notes: "",
    });
    setErrors({});
  };

  const projectForCode = projects.find((p) => p.project_code === form.project_code);

  const submit = async () => {
    const code = form.project_code.trim().toUpperCase();
    const unitNo = form.unit_no.trim();
    const size = Number(form.size_sqft);
    const rate = Number(form.base_rate);

    const nextErrors: NUErrors = {};
    if (!code) nextErrors.project_code = "Pick a project.";
    if (unitNo.length < 1) nextErrors.unit_no = "Unit number is required (e.g. 101, S-12).";
    if (!(size > 0)) nextErrors.size_sqft = "Size (sqft) must be greater than 0.";
    if (!(rate > 0)) nextErrors.base_rate = "Base rate must be greater than 0.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      const firstMsg =
        nextErrors.project_code ??
        nextErrors.unit_no ??
        nextErrors.size_sqft ??
        nextErrors.base_rate;
      toast({
        variant: "destructive",
        title: "Please fix the highlighted fields",
        description: firstMsg,
      });
      return;
    }
    setErrors({});
    const unit_id = `${code}-${unitNo}`.toUpperCase().replace(/\s+/g, "");

    setSaving(true);
    const { error } = await supabase.from("units").insert(
      withCompany(
        {
          unit_id,
          project_code: code,
          project_name: projectForCode?.project_name ?? null,
          unit_no: unitNo,
          unit_type: form.unit_type,
          floor: form.floor.trim() || null,
          size_sqft: size,
          base_rate: rate,
          standard_value: size * rate,
          status: "Available",
          notes: form.notes.trim() || null,
        },
        companyId!,
      ) as any,
    );
    setSaving(false);

    if (error) {
      const isDup = error.message.includes("duplicate");
      if (isDup) setErrors({ unit_no: `Unit "${unit_id}" already exists in this project.` });
      toast({
        variant: "destructive",
        title: "Could not add unit",
        description: isDup ? `Unit "${unit_id}" already exists in this project.` : error.message,
      });
      return;
    }
    toast({
      title: "Unit added",
      description: `${unit_id} · ${form.unit_type} · ${fmtPKR(size * rate)}`,
    });
    await qc.invalidateQueries({ queryKey: ["units"] });
    reset();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New unit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a new unit</DialogTitle>
          <DialogDescription>
            Register a Shop, Office, Apartment, House, or Plot into a project. Standard value
            auto-calculates from size × base rate.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nu-project">Project</Label>
              <Select
                value={form.project_code}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, project_code: v }));
                  if (errors.project_code)
                    setErrors((prev) => ({ ...prev, project_code: undefined }));
                }}
              >
                <SelectTrigger
                  id="nu-project"
                  aria-invalid={!!errors.project_code}
                  aria-describedby={errors.project_code ? "nu-project-err" : undefined}
                >
                  <SelectValue placeholder="Choose project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground">No projects yet.</div>
                  ) : (
                    projects.map((p) => (
                      <SelectItem key={p.project_code} value={p.project_code}>
                        <span className="font-mono text-xs mr-2">{p.project_code}</span>
                        {p.project_name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {errors.project_code && (
                <p id="nu-project-err" className="text-[11px] text-destructive">
                  {errors.project_code}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nu-type">Type</Label>
              <Select
                value={form.unit_type}
                onValueChange={(v) => setForm((f) => ({ ...f, unit_type: v as UnitType }))}
              >
                <SelectTrigger id="nu-type">
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nu-no">Unit no.</Label>
              <Input
                id="nu-no"
                placeholder="e.g. 101, S-12, GF-4"
                value={form.unit_no}
                onChange={(e) => {
                  setForm((f) => ({ ...f, unit_no: e.target.value }));
                  if (errors.unit_no) setErrors((prev) => ({ ...prev, unit_no: undefined }));
                }}
                className="font-mono"
                maxLength={20}
                aria-invalid={!!errors.unit_no}
                aria-describedby={errors.unit_no ? "nu-no-err" : undefined}
              />
              {errors.unit_no ? (
                <p id="nu-no-err" className="text-[11px] text-destructive">
                  {errors.unit_no}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Will be stored as{" "}
                  <span className="font-mono">
                    {form.project_code || "CODE"}-{form.unit_no || "…"}
                  </span>
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nu-floor">Floor</Label>
              <Input
                id="nu-floor"
                placeholder="e.g. Ground, 1st, 4"
                value={form.floor}
                onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))}
                maxLength={30}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nu-size">Size (sqft)</Label>
              <Input
                id="nu-size"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="e.g. 1200"
                value={form.size_sqft}
                onChange={(e) => {
                  setForm((f) => ({ ...f, size_sqft: e.target.value }));
                  if (errors.size_sqft) setErrors((prev) => ({ ...prev, size_sqft: undefined }));
                }}
                aria-invalid={!!errors.size_sqft}
                aria-describedby={errors.size_sqft ? "nu-size-err" : undefined}
              />
              {errors.size_sqft && (
                <p id="nu-size-err" className="text-[11px] text-destructive">
                  {errors.size_sqft}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nu-rate">Base rate (PKR / sqft)</Label>
              <Input
                id="nu-rate"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="e.g. 8500"
                value={form.base_rate}
                onChange={(e) => {
                  setForm((f) => ({ ...f, base_rate: e.target.value }));
                  if (errors.base_rate) setErrors((prev) => ({ ...prev, base_rate: undefined }));
                }}
                aria-invalid={!!errors.base_rate}
                aria-describedby={errors.base_rate ? "nu-rate-err" : undefined}
              />
              {errors.base_rate && (
                <p id="nu-rate-err" className="text-[11px] text-destructive">
                  {errors.base_rate}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Standard value</span>
            <span className="font-medium tabular-nums">{fmtPKR(standardValue)}</span>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="nu-notes">Notes</Label>
            <Textarea
              id="nu-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              maxLength={1000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
