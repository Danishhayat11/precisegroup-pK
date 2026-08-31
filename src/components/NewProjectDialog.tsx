import { useState } from "react";
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

type ProjectType = "Residential" | "Commercial" | "Mixed-Use";

const STATUS_OPTIONS = ["Planning", "Active", "On Hold", "Completed"] as const;

export function NewProjectDialog({
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  /** Custom trigger element. Falls back to the default "New project" button. */
  trigger?: React.ReactNode;
  /** Optional controlled open state (for parents that open the dialog from a menu item). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { companyId } = useAuth();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (v: boolean) => {
    controlledOnOpenChange?.(v);
    if (controlledOpen === undefined) setUncontrolledOpen(v);
  };
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ project_code?: string; project_name?: string }>({});
  const [form, setForm] = useState({
    project_code: "",
    project_name: "",
    project_type: "Residential" as ProjectType,
    location: "",
    status: "Planning",
    start_date: "",
    expected_completion_date: "",
    notes: "",
  });

  const reset = () => {
    setForm({
      project_code: "",
      project_name: "",
      project_type: "Residential",
      location: "",
      status: "Planning",
      start_date: "",
      expected_completion_date: "",
      notes: "",
    });
    setErrors({});
  };

  const submit = async () => {
    const code = form.project_code.trim().toUpperCase();
    const name = form.project_name.trim();
    const nextErrors: { project_code?: string; project_name?: string } = {};
    if (!/^[A-Z0-9]{2,10}$/.test(code)) {
      nextErrors.project_code = "Use 2–10 letters/digits, e.g. MA, MH, XH.";
    }
    if (name.length < 2) {
      nextErrors.project_name = "Project name is required.";
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast({
        variant: "destructive",
        title: "Please fix the highlighted fields",
        description: nextErrors.project_code ?? nextErrors.project_name,
      });
      return;
    }
    setErrors({});
    setSaving(true);
    const { error } = await supabase.from("projects").insert(
      withCompany(
        {
          project_code: code,
          project_name: name,
          project_type: form.project_type,
          location: form.location.trim() || null,
          status: form.status || null,
          start_date: form.start_date || null,
          expected_completion_date: form.expected_completion_date || null,
          notes: form.notes.trim() || null,
        },
        companyId!,
      ) as any,
    );
    setSaving(false);
    if (error) {
      const isDup = error.message.includes("duplicate");
      if (isDup) setErrors({ project_code: `Project code "${code}" already exists.` });
      toast({
        variant: "destructive",
        title: "Could not create project",
        description: isDup ? `Project code "${code}" already exists.` : error.message,
      });
      return;
    }
    toast({ title: "Project created", description: `${code} — ${name}` });
    await qc.invalidateQueries({ queryKey: ["projects"] });
    await qc.invalidateQueries({ queryKey: ["active-project", "projects"] });
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
            New project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a new project</DialogTitle>
          <DialogDescription>
            Register a Residential, Commercial, or Mixed-Use project. The project code is used as
            the prefix for booking IDs (e.g.{" "}
            <span className="font-mono">BK-{form.project_code || "CODE"}-00001</span>).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="np-code">Project code</Label>
              <Input
                id="np-code"
                placeholder="e.g. MA"
                value={form.project_code}
                onChange={(e) => {
                  setForm((f) => ({ ...f, project_code: e.target.value.toUpperCase() }));
                  if (errors.project_code)
                    setErrors((prev) => ({ ...prev, project_code: undefined }));
                }}
                maxLength={10}
                className="font-mono"
                aria-invalid={!!errors.project_code}
                aria-describedby={errors.project_code ? "np-code-err" : undefined}
              />
              {errors.project_code && (
                <p id="np-code-err" className="text-[11px] text-destructive">
                  {errors.project_code}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-type">Type</Label>
              <Select
                value={form.project_type}
                onValueChange={(v) => setForm((f) => ({ ...f, project_type: v as ProjectType }))}
              >
                <SelectTrigger id="np-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Residential">Residential</SelectItem>
                  <SelectItem value="Commercial">Commercial</SelectItem>
                  <SelectItem value="Mixed-Use">Mixed-Use</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="np-name">Project name</Label>
            <Input
              id="np-name"
              placeholder="e.g. Manal Arcade"
              value={form.project_name}
              onChange={(e) => {
                setForm((f) => ({ ...f, project_name: e.target.value }));
                if (errors.project_name)
                  setErrors((prev) => ({ ...prev, project_name: undefined }));
              }}
              aria-invalid={!!errors.project_name}
              aria-describedby={errors.project_name ? "np-name-err" : undefined}
            />
            {errors.project_name && (
              <p id="np-name-err" className="text-[11px] text-destructive">
                {errors.project_name}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="np-loc">Location</Label>
            <Input
              id="np-loc"
              placeholder="City / area"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="np-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger id="np-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-start">Start date</Label>
              <Input
                id="np-start"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-end">Completion</Label>
              <Input
                id="np-end"
                type="date"
                value={form.expected_completion_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expected_completion_date: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="np-notes">Notes</Label>
            <Textarea
              id="np-notes"
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
            {saving ? "Saving…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
