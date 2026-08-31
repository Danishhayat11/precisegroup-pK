/**
 * EditUnitDialog — edit floor, type, size, base rate (and unit no. / notes /
 * status) for an existing unit. Standard value recalculates from
 * size × base_rate. `project_code` / `project_name` are NOT editable here —
 * moving a unit across projects would break bookings/ledger references.
 */
import { useEffect, useMemo, useState } from "react";
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
import { fmtPKR } from "@/lib/format";

const UNIT_TYPES = ["Shop", "Office", "Apartment", "House", "Plot", "Other"] as const;
type UnitType = (typeof UNIT_TYPES)[number];

const STATUSES = ["Available", "Reserved", "Booked", "Sold", "Blocked"] as const;
type UnitStatus = (typeof STATUSES)[number];

export type EditableUnit = {
  unit_id: string;
  project_code: string;
  project_name: string | null;
  unit_no: string | null;
  unit_type: string | null;
  floor: string | null;
  size_sqft: number | null;
  base_rate: number | null;
  status: string | null;
  notes: string | null;
  linked_booking_id?: string | null;
};

export function EditUnitDialog({
  unit,
  open,
  onOpenChange,
}: {
  unit: EditableUnit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { companyId } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    unit_no: "",
    unit_type: "Apartment" as UnitType,
    floor: "",
    size_sqft: "",
    base_rate: "",
    status: "Available" as UnitStatus,
    notes: "",
  });

  useEffect(() => {
    if (!unit || !open) return;
    setForm({
      unit_no: unit.unit_no ?? "",
      unit_type: UNIT_TYPES.includes(unit.unit_type as UnitType)
        ? (unit.unit_type as UnitType)
        : "Other",
      floor: unit.floor ?? "",
      size_sqft: unit.size_sqft != null ? String(unit.size_sqft) : "",
      base_rate: unit.base_rate != null ? String(unit.base_rate) : "",
      status: STATUSES.includes(unit.status as UnitStatus)
        ? (unit.status as UnitStatus)
        : "Available",
      notes: unit.notes ?? "",
    });
  }, [unit, open]);

  const standardValue = useMemo(() => {
    const s = Number(form.size_sqft) || 0;
    const r = Number(form.base_rate) || 0;
    return s * r;
  }, [form.size_sqft, form.base_rate]);

  const submit = async () => {
    if (!unit) return;
    const size = Number(form.size_sqft);
    const rate = Number(form.base_rate);
    if (!(size > 0)) {
      toast({ variant: "destructive", title: "Size (sqft) must be greater than 0" });
      return;
    }
    if (!(rate > 0)) {
      toast({ variant: "destructive", title: "Base rate must be greater than 0" });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("units")
      .update({
        unit_no: form.unit_no.trim() || null,
        unit_type: form.unit_type,
        floor: form.floor.trim() || null,
        size_sqft: size,
        base_rate: rate,
        standard_value: size * rate,
        status: form.status,
        notes: form.notes.trim() || null,
      } as any)
      .eq("unit_id", unit.unit_id)
      .eq("company_id", companyId!);
    setSaving(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Could not update unit",
        description: error.message,
      });
      return;
    }
    toast({
      title: "Unit updated",
      description: `${unit.unit_id} · ${form.unit_type} · ${fmtPKR(size * rate)}`,
    });
    await qc.invalidateQueries({ queryKey: ["units"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit unit</DialogTitle>
          <DialogDescription>
            {unit ? (
              <>
                <span className="font-mono">{unit.unit_id}</span>
                {" · "}
                {unit.project_name ?? unit.project_code}
              </>
            ) : (
              "Update unit details. Standard value auto-calculates."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="eu-no">Unit no.</Label>
              <Input
                id="eu-no"
                value={form.unit_no}
                onChange={(e) => setForm((f) => ({ ...f, unit_no: e.target.value }))}
                className="font-mono"
                maxLength={20}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="eu-type">Type</Label>
              <Select
                value={form.unit_type}
                onValueChange={(v) => setForm((f) => ({ ...f, unit_type: v as UnitType }))}
              >
                <SelectTrigger id="eu-type">
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
              <Label htmlFor="eu-floor">Floor</Label>
              <Input
                id="eu-floor"
                placeholder="e.g. Ground, 1st, 4"
                value={form.floor}
                onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))}
                maxLength={30}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="eu-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as UnitStatus }))}
              >
                <SelectTrigger id="eu-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="eu-size">Size (sqft)</Label>
              <Input
                id="eu-size"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={form.size_sqft}
                onChange={(e) => setForm((f) => ({ ...f, size_sqft: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="eu-rate">Base rate (PKR / sqft)</Label>
              <Input
                id="eu-rate"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={form.base_rate}
                onChange={(e) => setForm((f) => ({ ...f, base_rate: e.target.value }))}
              />
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Standard value</span>
            <span className="font-medium tabular-nums">{fmtPKR(standardValue)}</span>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="eu-notes">Notes</Label>
            <Textarea
              id="eu-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              maxLength={1000}
            />
          </div>

          {unit?.linked_booking_id ? (
            <p className="text-[11px] text-muted-foreground">
              Linked to booking <span className="font-mono">{unit.linked_booking_id}</span>. Changes
              affect the standard value shown across bookings and reports.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
