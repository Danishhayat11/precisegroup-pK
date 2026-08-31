import { useMemo, useRef, useState, useEffect, useId, type ReactNode } from "react";
import { usePIIGuardedQuery } from "@/lib/access";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtPKR, fmtDate } from "@/lib/format";
import { Check, Plus, Trash2, AlertTriangle, Info, CircleAlert, Scale } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * useTapTooltip — makes Radix Tooltip usable on touch devices.
 * Tap toggles, focus/mouse-enter open, blur/mouse-leave close,
 * Escape or outside pointerdown closes. Returns a controlled `open`
 * plus props to spread onto the trigger element (typically a button
 * wrapped by `<TooltipTrigger asChild>`).
 */
function useTapTooltip() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const triggerProps = {
    ref: (el: HTMLElement | null) => {
      ref.current = el;
    },
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      setOpen((v) => !v);
    },
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") setOpen(true);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") setOpen(false);
    },
    "aria-expanded": open,
  };
  return { open, setOpen, triggerProps };
}

/**
 * TapTip — small icon-button that opens a Radix Tooltip on hover, focus,
 * or tap. Provides an accessible name for screen readers and closes on
 * Escape / outside pointer. Use in place of raw <Tooltip> when the trigger
 * is a bare icon that must also work on touch.
 */
function TapTip({
  label,
  side = "top",
  className,
  children,
  icon,
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  children: ReactNode;
  icon: ReactNode;
}) {
  const { open, setOpen, triggerProps } = useTapTooltip();
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          {...triggerProps}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} role="tooltip" className="max-w-xs text-xs">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

export type Allocation = { ledger_id: string; head_label: string; amount: number };

// ─── Configurable rounding ────────────────────────────────────────────────
export type RoundingMode =
  | "none" // exact paise, must match to 0.005
  | "paisa" // nearest 0.01
  | "rupee" // nearest 1
  | "rupee_up" // ceil to 1
  | "rupee_down"; // floor to 1

export const ROUNDING_OPTIONS: {
  value: RoundingMode;
  label: string;
  unit: number;
  tol: number;
  desc: string;
}[] = [
  {
    value: "none",
    label: "Exact (no rounding)",
    unit: 0.01,
    tol: 1.0,
    desc: "Sum must match the payment to the paisa.",
  },
  {
    value: "paisa",
    label: "Nearest paisa (0.01)",
    unit: 0.01,
    tol: 1.0,
    desc: "Rounds each allocation to the nearest paisa.",
  },
  {
    value: "rupee",
    label: "Nearest rupee (₨1)",
    unit: 1,
    tol: 0.5,
    desc: "Rounds each allocation to the nearest whole rupee; totals may differ by up to ₨0.50.",
  },
  {
    value: "rupee_up",
    label: "Round up to rupee",
    unit: 1,
    tol: 1,
    desc: "Rounds each allocation up to the next whole rupee; totals may exceed the payment by up to ₨1.",
  },
  {
    value: "rupee_down",
    label: "Round down to rupee",
    unit: 1,
    tol: 1,
    desc: "Rounds each allocation down to a whole rupee; totals may fall short of the payment by up to ₨1.",
  },
];

export function roundAmount(v: number, mode: RoundingMode): number {
  if (!Number.isFinite(v)) return 0;
  switch (mode) {
    case "paisa":
      return Math.round(v * 100) / 100;
    case "rupee":
      return Math.round(v);
    case "rupee_up":
      return Math.ceil(v);
    case "rupee_down":
      return Math.floor(v);
    case "none":
    default:
      return Math.round(v * 100) / 100;
  }
}

export function toleranceFor(mode: RoundingMode): number {
  return ROUNDING_OPTIONS.find((o) => o.value === mode)?.tol ?? 1.0;
}

interface Props {
  bookingId: string;
  totalAmount: number;
  value: Allocation[];
  onChange: (allocs: Allocation[]) => void;
  /** When editing an existing payment, pass its receipt_no so its own allocations
   * are added back to each ledger row's remaining balance. */
  excludeReceiptNo?: string;
}

/** Parse any user input into a safe non-negative number. */
function parseAmount(v: unknown): number {
  if (v === "" || v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

type RowError = {
  target?: string;
  amount?: string;
};

export function AllocationBuilder({
  bookingId,
  totalAmount,
  value,
  onChange,
  excludeReceiptNo,
}: Props) {
  const { data: rows = [] } = usePIIGuardedQuery<any[]>({
    queryKey: ["alloc-ledger", bookingId, excludeReceiptNo ?? ""],
    enabled: !!bookingId,
    queryFn: async () => {
      const { data: ledger } = await supabase
        .from("installment_ledger")
        .select("ledger_id,term_no,particulars,due_date,due_amount,paid_amount")
        .eq("booking_id", bookingId)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("term_no", { ascending: true });
      const list = (ledger ?? []).filter(
        (r: any) => Number(r.due_amount) > 0 || String(r.particulars ?? "").trim().length > 0,
      );
      const ownAllocs: Record<string, number> = {};
      if (excludeReceiptNo) {
        const { data: own } = await supabase
          .from("payment_allocations")
          .select("ledger_id,amount")
          .eq("receipt_no", excludeReceiptNo);
        for (const a of own ?? [])
          ownAllocs[a.ledger_id] = (ownAllocs[a.ledger_id] ?? 0) + Number(a.amount);
      }
      return list.map((r: any) => {
        const due = Number(r.due_amount) || 0;
        const paid = Number(r.paid_amount) || 0;
        const ownBack = ownAllocs[r.ledger_id] ?? 0;
        // Apply rounding to remaining calculation to prevent precision drifts
        const rem = Math.max(0, due - Math.max(0, paid - ownBack));
        return { ...r, _remaining: Math.round((rem + Number.EPSILON) * 100) / 100 };
      });
    },
  });

  const rowsById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of rows as any[]) m[r.ledger_id] = r;
    return m;
  }, [rows]);

  const [rounding, setRounding] = useState<RoundingMode>("none");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const tol = toleranceFor(rounding);
  const roundingOpt = ROUNDING_OPTIONS.find((o) => o.value === rounding)!;

  const uid = useId().replace(/:/g, "");
  const rowInputRefs = useRef<Record<string, HTMLElement | null>>({});
  const rowId = (i: number, field: "target" | "amount") => `alloc-${uid}-${field}-${i}`;
  const errId = (i: number, field: "target" | "amount") => `alloc-${uid}-${field}-err-${i}`;
  const focusRow = (i: number, field: "target" | "amount") => {
    const el =
      rowInputRefs.current[rowId(i, field)] ??
      (typeof document !== "undefined" ? document.getElementById(rowId(i, field)) : null);
    if (!el) return;
    (el as HTMLElement).focus?.();
    (el as HTMLElement).scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  const toggleSelected = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const allocatedTotal = useMemo(
    () => value.reduce((s, a) => s + parseAmount(a.amount), 0),
    [value],
  );
  const target = Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : 0;
  const diff = target - allocatedTotal; // positive = short, negative = over
  const isEmpty = value.length === 0;
  const balanced = target > 0 && !isEmpty && Math.abs(diff) <= tol;
  const state: "neutral" | "error" | "ok" =
    target <= 0 || isEmpty ? "neutral" : balanced ? "ok" : "error";
  const withinToleranceButNotExact = balanced && Math.abs(diff) > 0.005;

  // Per-row validation (target, amount, duplicates, exceeds remaining)
  const seen = new Map<string, number>();
  const rowErrors: RowError[] = value.map((a) => {
    const err: RowError = {};
    if (!a.ledger_id) {
      err.target = "Select a schedule row.";
    } else {
      const count = (seen.get(a.ledger_id) ?? 0) + 1;
      seen.set(a.ledger_id, count);
      if (count > 1) err.target = "Duplicate — same row already targeted.";
    }
    const amt = parseAmount(a.amount);
    if (!a.amount && a.amount !== 0) {
      err.amount = "Enter an amount.";
    } else if (amt <= 0) {
      err.amount = "Amount must be a positive number.";
    } else if (a.ledger_id && rowsById[a.ledger_id]) {
      const rem = Number(rowsById[a.ledger_id]._remaining) || 0;
      if (amt - rem > Math.max(tol, 2.0)) err.amount = `Exceeds remaining ${fmtPKR(rem)}.`;
    }
    return err;
  });

  const hasRowErrors = rowErrors.some((e) => e.target || e.amount);

  const updateOne = (i: number, patch: Partial<Allocation>) => {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const addOne = () => {
    const usedIds = new Set(value.map((v) => v.ledger_id));
    const next = (rows as any[]).find((r: any) => r._remaining > 0 && !usedIds.has(r.ledger_id));
    onChange([
      ...value,
      { ledger_id: next?.ledger_id ?? "", head_label: next?.particulars ?? "", amount: 0 },
    ]);
  };
  const removeOne = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
    setSelected((prev) => {
      const next = new Set<number>();
      prev.forEach((k) => {
        if (k === i) return;
        next.add(k > i ? k - 1 : k);
      });
      return next;
    });
  };
  const autoBalanceLast = () => {
    if (isEmpty || target <= 0) return;
    const others = value.slice(0, -1).reduce((s, a) => s + parseAmount(a.amount), 0);
    const remainder = Math.max(0, +(target - others).toFixed(2));
    updateOne(value.length - 1, { amount: remainder });
  };
  const applyRounding = () => {
    if (isEmpty) return;
    const next = value.map((a) => ({ ...a, amount: roundAmount(parseAmount(a.amount), rounding) }));
    onChange(next);
  };

  /**
   * Smart Distribute — proportionally allocate the remaining unallocated
   * amount across the selected rows, weighted by each row's outstanding
   * balance (_remaining). Rounds per the active rounding mode and puts
   * any residual on the largest selected row so the total stays exact.
   */
  const smartDistribute = () => {
    if (target <= 0 || isEmpty) return;
    const idxs = [...selected].filter((i) => i >= 0 && i < value.length);
    if (idxs.length === 0) return;

    // Amount to distribute = target minus everything already allocated
    // to the NON-selected rows.
    const lockedSum = value.reduce(
      (s, a, i) => (idxs.includes(i) ? s : s + parseAmount(a.amount)),
      0,
    );
    const remaining = +(target - lockedSum).toFixed(2);
    if (remaining <= 0) return;

    // Weights = each selected row's _remaining balance; fall back to equal
    // weights if none have a known outstanding balance.
    const weights = idxs.map((i) => {
      const r = rowsById[value[i].ledger_id];
      const rem = r ? Number(r._remaining) || 0 : 0;
      return rem;
    });
    const weightSum = weights.reduce((s, w) => s + w, 0);
    const equal = weightSum <= 0;
    const shares = idxs.map((_, k) =>
      equal ? remaining / idxs.length : remaining * (weights[k] / weightSum),
    );

    // Round each share to the active mode's unit, then absorb the residual.
    const rounded = shares.map((s) => roundAmount(s, rounding));
    const residual = +(remaining - rounded.reduce((s, v) => s + v, 0)).toFixed(2);
    if (Math.abs(residual) > 0.005) {
      // Put the leftover on the row with the largest share.
      let bestK = 0;
      for (let k = 1; k < rounded.length; k++) if (rounded[k] > rounded[bestK]) bestK = k;
      rounded[bestK] = +(rounded[bestK] + residual).toFixed(2);
      if (rounded[bestK] < 0) rounded[bestK] = 0;
    }

    const next = value.slice();
    idxs.forEach((i, k) => {
      next[i] = { ...next[i], amount: rounded[k] };
    });
    onChange(next);
  };

  const indicatorClass =
    state === "ok"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900"
      : state === "error"
        ? "bg-red-50 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900"
        : "bg-muted text-muted-foreground border-border";

  const deviationLabel =
    state === "ok"
      ? withinToleranceButNotExact
        ? `Balanced within ±${fmtPKR(tol)} rounding tolerance`
        : "Perfectly balanced"
      : target <= 0
        ? "Enter a payment amount to begin"
        : isEmpty
          ? "No allocations yet"
          : diff > 0
            ? `${fmtPKR(diff)} short of target`
            : `${fmtPKR(-diff)} over target`;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="rounded-md border bg-muted/30 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-muted-foreground">
            Split this payment across specific schedule rows (Installment, Possession, etc.).
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <div className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-[11px] text-muted-foreground">Rounding</Label>
              <Select value={rounding} onValueChange={(v) => setRounding(v as RoundingMode)}>
                <SelectTrigger className="h-8 w-[190px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUNDING_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TapTip
                label="About the selected rounding mode"
                icon={<Info className="h-3.5 w-3.5" />}
              >
                <div className="space-y-1">
                  <div className="font-semibold">{roundingOpt.label}</div>
                  <div>{roundingOpt.desc}</div>
                  <div>
                    Match tolerance: <b>±{fmtPKR(tol)}</b>. Sums within this range of the payment
                    total are accepted as balanced.
                  </div>
                </div>
              </TapTip>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={applyRounding}
              disabled={isEmpty || rounding === "none"}
            >
              Apply rounding
            </Button>
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={smartDistribute}
                disabled={isEmpty || target <= 0 || selected.size === 0}
                className="gap-1"
                aria-describedby={`${uid}-smart-help`}
              >
                <Scale className="h-3.5 w-3.5" /> Smart Distribute
                {selected.size > 0 && (
                  <span className="ml-1 rounded bg-background/60 px-1 text-[10px] tabular-nums">
                    {selected.size}
                  </span>
                )}
              </Button>
              <TapTip label="How Smart Distribute works" icon={<Info className="h-3.5 w-3.5" />}>
                <span id={`${uid}-smart-help`}>
                  Proportionally splits the <b>remaining unallocated amount</b> across the rows
                  you've ticked, weighted by each row's outstanding balance. Rounds per the active
                  rounding mode; residual lands on the largest share.
                </span>
              </TapTip>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={autoBalanceLast}
              disabled={isEmpty || target <= 0}
            >
              Auto-balance last
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={addOne}>
              <Plus className="h-4 w-4 mr-1" /> Add allocation
            </Button>
          </div>
        </div>

        {isEmpty && (
          <div className="text-xs text-muted-foreground italic px-1">
            No allocations yet — click <b>Add allocation</b> to target a specific row.
          </div>
        )}

        {value.length > 0 && (
          <div className="grid grid-cols-12 gap-2 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <div className="col-span-1">Pick</div>
            <div className="col-span-7">Apply to</div>
            <div className="col-span-3">Amount (PKR)</div>
            <div className="col-span-1" />
          </div>
        )}

        {value.map((a, i) => {
          const err = rowErrors[i];
          const isSel = selected.has(i);
          return (
            <div
              key={i}
              className={cn(
                "grid grid-cols-12 gap-2 items-start rounded-md px-1 -mx-1 py-1 transition-colors",
                isSel && "bg-primary/5 ring-1 ring-primary/20",
              )}
            >
              <div className="col-span-1 pt-2 flex items-center justify-center">
                <input
                  type="checkbox"
                  aria-label={`Include row ${i + 1} in Smart Distribute`}
                  className="h-4 w-4 accent-primary cursor-pointer"
                  checked={isSel}
                  onChange={() => toggleSelected(i)}
                />
              </div>
              <div className="col-span-7">
                <Label className="text-[11px] sr-only">Apply to</Label>
                <Select
                  value={a.ledger_id}
                  onValueChange={(v) => {
                    const row = (rows as any[]).find((r: any) => r.ledger_id === v);
                    updateOne(i, { ledger_id: v, head_label: row?.particulars ?? "" });
                  }}
                >
                  <SelectTrigger
                    id={rowId(i, "target")}
                    ref={(el) => {
                      rowInputRefs.current[rowId(i, "target")] = el;
                    }}
                    className={cn("h-9", err.target && "border-red-500 focus:ring-red-500")}
                    aria-invalid={!!err.target}
                    aria-describedby={err.target ? errId(i, "target") : undefined}
                    aria-label={`Row ${i + 1} schedule target`}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown" && e.altKey) {
                        e.preventDefault();
                        focusRow(i, "amount");
                      }
                    }}
                  >
                    <SelectValue placeholder="Select schedule row" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {(rows as any[]).map((r: any) => (
                      <SelectItem key={r.ledger_id} value={r.ledger_id}>
                        <div className="flex items-center justify-between gap-4 w-full">
                          <span className="truncate">
                            {r.particulars}
                            {r.due_date ? ` · ${fmtDate(r.due_date)}` : ""}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {fmtPKR(r._remaining)} remaining
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {err.target && (
                  <p
                    id={errId(i, "target")}
                    className="mt-1 flex items-center gap-1 text-[11px] text-red-600"
                  >
                    <CircleAlert className="h-3 w-3" aria-hidden="true" /> {err.target}
                  </p>
                )}
              </div>
              <div className="col-span-3">
                <Label htmlFor={rowId(i, "amount")} className="text-[11px] sr-only">
                  Row {i + 1} amount in PKR
                </Label>
                <Input
                  id={rowId(i, "amount")}
                  ref={(el) => {
                    rowInputRefs.current[rowId(i, "amount")] = el;
                  }}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={a.amount || ""}
                  onChange={(e) => updateOne(i, { amount: parseAmount(e.target.value) })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const nextIdx = i + 1;
                      if (nextIdx < value.length) focusRow(nextIdx, "target");
                    }
                  }}
                  className={cn(
                    "tabular-nums",
                    err.amount && "border-red-500 focus-visible:ring-red-500",
                  )}
                  aria-invalid={!!err.amount}
                  aria-describedby={err.amount ? errId(i, "amount") : undefined}
                />
                {err.amount && (
                  <p
                    id={errId(i, "amount")}
                    className="mt-1 flex items-center gap-1 text-[11px] text-red-600"
                  >
                    <CircleAlert className="h-3 w-3" aria-hidden="true" /> {err.amount}
                  </p>
                )}
              </div>
              <div className="col-span-1 pt-5">
                <Button
                  className="min-h-11 min-w-11"
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeOne(i)}
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}

        {/* Remaining to Allocate indicator */}
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium tabular-nums transition-colors",
            indicatorClass,
          )}
        >
          <div className="flex items-center gap-2">
            {state === "ok" ? (
              <Check className="h-4 w-4" />
            ) : state === "error" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Info className="h-4 w-4" />
            )}
            <span>
              Allocated <span className="font-semibold">{fmtPKR(allocatedTotal)}</span> of{" "}
              <span className="font-semibold">{fmtPKR(target)}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>{deviationLabel}</span>
            <TapTip
              label="Deviation details"
              side="top"
              icon={<Info className="h-3.5 w-3.5 opacity-80" />}
            >
              <div className="space-y-1">
                <div>
                  Target payment: <b>{fmtPKR(target)}</b>
                </div>
                <div>
                  Sum of allocations: <b>{fmtPKR(allocatedTotal)}</b>
                </div>
                <div>
                  Deviation:{" "}
                  <b className={state === "ok" ? "text-emerald-400" : "text-red-400"}>
                    {diff === 0 ? fmtPKR(0) : diff > 0 ? `-${fmtPKR(diff)}` : `+${fmtPKR(-diff)}`}
                  </b>
                </div>
                {state === "error" && (
                  <div className="pt-1 text-muted-foreground">
                    {diff > 0
                      ? "Increase one or more allocation amounts, or add another row."
                      : "Reduce one or more allocation amounts, or remove a row."}
                  </div>
                )}
              </div>
            </TapTip>
          </div>
        </div>

        {withinToleranceButNotExact && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <b>Rounding applied.</b> Your allocations sum to {fmtPKR(allocatedTotal)}, which
              differs from the payment of {fmtPKR(target)} by{" "}
              <b>{diff > 0 ? `-${fmtPKR(diff)}` : `+${fmtPKR(-diff)}`}</b>. This falls within the{" "}
              <b>±{fmtPKR(tol)}</b> tolerance for <i>{roundingOpt.label}</i> and will be recorded
              as-is. Switch to <i>Exact</i> if you need paisa-perfect matching.
            </div>
          </div>
        )}

        {/* Error summary — always mounted so aria-live announces changes */}
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          aria-labelledby={`${uid}-errsum-title`}
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs transition-opacity",
            hasRowErrors || (!balanced && !isEmpty && target > 0)
              ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 opacity-100"
              : "sr-only",
          )}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div id={`${uid}-errsum-title`} className="font-semibold">
              {hasRowErrors || (!balanced && !isEmpty && target > 0)
                ? "Fix these before saving:"
                : "No allocation errors."}
            </div>
            <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
              {rowErrors.map((e, i) => {
                if (!e.target && !e.amount) return null;
                const jumpField: "target" | "amount" = e.target ? "target" : "amount";
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => focusRow(i, jumpField)}
                      className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-sm"
                      aria-label={`Row ${i + 1} error — press Enter to focus the ${jumpField === "target" ? "schedule row" : "amount"} field`}
                    >
                      Row {i + 1}: {[e.target, e.amount].filter(Boolean).join(" ")}
                    </button>
                  </li>
                );
              })}
              {!balanced && !isEmpty && target > 0 && (
                <li>
                  Allocation total must equal <b>{fmtPKR(target)}</b> within ±{fmtPKR(tol)} (
                  <i>{roundingOpt.label}</i>) — currently{" "}
                  {diff > 0 ? `short by ${fmtPKR(diff)}` : `over by ${fmtPKR(-diff)}`}.
                  {rounding !== "none" && " Click Apply rounding, then Auto-balance last."}
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * Validate allocations before saving. Returns null if OK, error string otherwise.
 * Pass a rounding `mode` (or explicit `tolerance`) to accept sums that differ
 * from the payment total by up to the mode's tolerance.
 */
export function validateAllocations(
  allocs: Allocation[],
  totalAmount: number,
  modeOrTolerance: RoundingMode | number = "none",
): string | null {
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return "Enter a valid payment amount before allocating.";
  }
  if (allocs.length === 0) return "Add at least one allocation.";
  const seen = new Set<string>();
  for (let i = 0; i < allocs.length; i++) {
    const a = allocs[i];
    if (!a.ledger_id) return `Row ${i + 1}: select a schedule row to apply this amount to.`;
    if (seen.has(a.ledger_id))
      return `Row ${i + 1}: duplicate schedule row — merge the amounts instead.`;
    seen.add(a.ledger_id);
    const amt = parseAmount(a.amount);
    if (amt <= 0) return `Row ${i + 1}: amount must be a positive number.`;
  }
  const tolerance =
    typeof modeOrTolerance === "number" ? modeOrTolerance : toleranceFor(modeOrTolerance);
  const sum = allocs.reduce((s, a) => s + parseAmount(a.amount), 0);
  const diff = totalAmount - sum;
  if (Math.abs(diff) > tolerance) {
    const tolNote = tolerance > 0.005 ? ` (allowed tolerance ±${fmtPKR(tolerance)})` : "";
    return diff > 0
      ? `Allocations are short by ${fmtPKR(diff)} — they must equal ${fmtPKR(totalAmount)}${tolNote}.`
      : `Allocations exceed the payment by ${fmtPKR(-diff)} — they must equal ${fmtPKR(totalAmount)}${tolNote}.`;
  }
  return null;
}
