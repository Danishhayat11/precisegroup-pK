/**
 * EditProjectDialog — update name, type, location, status, and dates for the
 * currently active project.
 *
 * `project_code` is the primary key and is used as the prefix in booking IDs,
 * so it is intentionally read-only here; renaming a code would orphan every
 * child row. Everything else is editable.
 *
 * Data flow:
 *   - When the dialog opens, fetch the full row for `projectCode` (the
 *     ActiveProjectProvider only caches code + name, not the full record).
 *   - Save via `update(...).eq("project_code", code)` and invalidate both the
 *     dashboard query and the active-project cache so the header, dashboard
 *     hero card, and any project-scoped widget pick up the new values live.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type ProjectType = "Residential" | "Commercial" | "Mixed-Use";

const STATUS_OPTIONS = ["Planning", "Active", "On Hold", "Completed"] as const;

type FormState = {
  project_name: string;
  project_type: ProjectType;
  location: string;
  status: string;
  start_date: string;
  expected_completion_date: string;
  notes: string;
};

const EMPTY: FormState = {
  project_name: "",
  project_type: "Residential",
  location: "",
  status: "Planning",
  start_date: "",
  expected_completion_date: "",
  notes: "",
};

export function EditProjectDialog({
  projectCode,
  open,
  onOpenChange,
}: {
  /** project_code of the row to edit. Dialog is a no-op when null. */
  projectCode: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { companyId } = useAuth();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  // Fetch the full row every time the dialog opens for a project. We can't
  // rely on ActiveProjectProvider's cache because it only stores
  // project_code + project_name.
  useEffect(() => {
    if (!open || !projectCode) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("projects")
        .select(
          "project_name, project_type, location, status, start_date, expected_completion_date, notes",
        )
        .eq("project_code", projectCode)
        .maybeSingle();
      if (cancelled) return;
      setLoading(false);
      if (error) {
        toast({
          variant: "destructive",
          title: "Couldn't load project",
          description: error.message,
        });
        onOpenChange(false);
        return;
      }
      if (!data) {
        toast({
          variant: "destructive",
          title: "Project not found",
          description: `No project with code ${projectCode}.`,
        });
        onOpenChange(false);
        return;
      }
      setForm({
        project_name: data.project_name ?? "",
        project_type: (data.project_type as ProjectType) ?? "Residential",
        location: data.location ?? "",
        status: data.status ?? "Planning",
        start_date: data.start_date ?? "",
        expected_completion_date: data.expected_completion_date ?? "",
        notes: data.notes ?? "",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectCode, onOpenChange, toast]);

  const submit = async () => {
    if (!projectCode) return;
    const name = form.project_name.trim();
    if (name.length < 2) {
      toast({ variant: "destructive", title: "Project name required" });
      return;
    }
    // End date, if set, must not precede start date. Both blank is fine.
    if (
      form.start_date &&
      form.expected_completion_date &&
      form.expected_completion_date < form.start_date
    ) {
      toast({
        variant: "destructive",
        title: "Invalid dates",
        description: "Completion date can't be before the start date.",
      });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("projects")
      .update({
        project_name: name,
        project_type: form.project_type,
        location: form.location.trim() || null,
        status: form.status || null,
        start_date: form.start_date || null,
        expected_completion_date: form.expected_completion_date || null,
        notes: form.notes.trim() || null,
      })
      .eq("project_code", projectCode)
      .eq("company_id", companyId!);
    setSaving(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Couldn't save changes",
        description: error.message,
      });
      return;
    }

    toast({
      title: "Project updated",
      description: `${projectCode} — ${name}`,
    });
    // Refresh the header switcher, dashboard, and any project-scoped list.
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["active-project", "projects"] }),
      qc.invalidateQueries({ queryKey: ["projects"] }),
      qc.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            Update details for <span className="font-mono">{projectCode ?? "—"}</span>. The project
            code is fixed because it's referenced by every booking, payment, unit, and ledger entry.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2" aria-busy={loading}>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ep-code">Project code</Label>
              <Input
                id="ep-code"
                value={projectCode ?? ""}
                readOnly
                disabled
                className="font-mono"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ep-type">Type</Label>
              <Select
                value={form.project_type}
                onValueChange={(v) => setForm((f) => ({ ...f, project_type: v as ProjectType }))}
                disabled={loading || saving}
              >
                <SelectTrigger id="ep-type">
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
            <Label htmlFor="ep-name">Project name</Label>
            <Input
              id="ep-name"
              value={form.project_name}
              onChange={(e) => setForm((f) => ({ ...f, project_name: e.target.value }))}
              maxLength={100}
              disabled={loading || saving}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ep-loc">Location</Label>
            <Input
              id="ep-loc"
              placeholder="City / area"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              maxLength={200}
              disabled={loading || saving}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ep-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                disabled={loading || saving}
              >
                <SelectTrigger id="ep-status">
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
              <Label htmlFor="ep-start">Start date</Label>
              <Input
                id="ep-start"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                disabled={loading || saving}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ep-end">Completion</Label>
              <Input
                id="ep-end"
                type="date"
                value={form.expected_completion_date}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    expected_completion_date: e.target.value,
                  }))
                }
                disabled={loading || saving}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ep-notes">Notes</Label>
            <Textarea
              id="ep-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              maxLength={1000}
              disabled={loading || saving}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || loading || !projectCode}>
            {saving ? "Saving…" : loading ? "Loading…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
