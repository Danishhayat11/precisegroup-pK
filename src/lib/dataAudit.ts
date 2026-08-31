/**
 * Client-side data audit engine.
 *
 * Pulls every booking / payment / ledger row / booking_document via fetchAll
 * (no 1000-row cap) and applies the rules described in the Data Health
 * spec. All severity / type / description / detected-at fields are
 * deterministic so the issue list can be diffed across scans and exported
 * to PDF without touching the database.
 *
 * Categorisation:
 *   CRITICAL — Rule 5 / Rule 6 invariants, negative balances on live bookings
 *   WARNING  — operational mismatches that need human review
 *   INFO     — cosmetic / data-quality notes (dummy data, doc ref collisions)
 */
import { fetchAllRows } from "@/lib/fetchAll";
import { recalculateLedger, checkPlanIdentity } from "@/lib/fifoEngine";

export type Severity = "CRITICAL" | "WARNING" | "INFO";

export type AuditIssue = {
  id: string; // stable per (booking, type) key
  severity: Severity;
  booking_id: string | null; // null for orphan-payment rows
  client_name: string | null;
  type: string; // short label
  description: string; // human description w/ numbers
  detected_at: string; // ISO timestamp of the scan
};

export type BookingBreakdown = {
  booking_id: string;
  booking_date: string | null; // ISO yyyy-mm-dd, used by CSV date-range filter
  client_name: string | null;
  status: string | null;
  risk_level_cached: string | null;
  risk_level_expected: "HIGH" | "MEDIUM" | "LOW";
  contract_value: number;
  cash_received: number;
  adjustment_credit: number;
  effective_received: number;
  live_balance: number;
  cached_balance: number;
  live_overdue_amount: number;
  cached_overdue_amount: number;
  live_overdue_count: number;
  cached_overdue_count: number;
  plan_sum: number;
  plan_vs_contract_diff: number;
  rules: {
    rule5_plan_identity: { ok: boolean; detail: string };
    rule6_overdue_le_balance: { ok: boolean; detail: string };
    risk_level: { ok: boolean; detail: string };
    completed_zero_balance: { ok: boolean; detail: string };
    no_negative_balance: { ok: boolean; detail: string };
    cached_balance_matches_live: { ok: boolean; detail: string };
    cached_overdue_matches_live: { ok: boolean; detail: string };
  };
  issue_count: number;
};

export type AuditReport = {
  issues: AuditIssue[];
  totals: {
    critical: number;
    warning: number;
    info: number;
    cleanBookings: number;
    totalBookings: number;
  };
  bySeverity: Record<Severity, AuditIssue[]>;
  bookingBreakdowns: BookingBreakdown[];
  scannedAt: string;
};

const DUMMY_PHONE = /^(?:0+|9+|1+|0?3000000000|N\/?A|TEST|DUMMY)$/i;
const DUMMY_CNIC = /^(?:0+(?:-0+)*|9+(?:-9+)*|1+(?:-1+)*|N\/?A|TEST|DUMMY)$/i;
const DUMMY_ADDR = /^\s*(?:n\/?a|test|dummy|tbd|to be confirmed|-+|unknown)\s*$/i;

const expectedRisk = (overdueCount: number): "HIGH" | "MEDIUM" | "LOW" =>
  overdueCount >= 3 ? "HIGH" : overdueCount >= 1 ? "MEDIUM" : "LOW";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export type AuditProgress = { stage: string; current: number; total: number };

export async function runDataAudit(
  today: string,
  opts: { signal?: AbortSignal; onProgress?: (p: AuditProgress) => void } = {},
): Promise<AuditReport> {
  const { signal, onProgress } = opts;
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException("Audit cancelled", "AbortError");
  };
  const tick = (stage: string, current: number, total: number) => {
    onProgress?.({ stage, current, total });
  };
  const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

  const scannedAt = new Date().toISOString();
  tick("Fetching bookings, payments, ledger & documents", 0, 4);
  const [bookings, payments, ledger, documents] = await Promise.all([
    fetchAllRows<any>("bookings", "*", "booking_id"),
    fetchAllRows<any>("payments", "*", "receipt_no"),
    fetchAllRows<any>("installment_ledger", "*", "ledger_id"),
    fetchAllRows<any>("booking_documents", "id,booking_id,label,tracking_no,doc_date", "id"),
  ]);
  checkAbort();
  tick("Fetched portfolio snapshot", 4, 4);

  const bookingMap = new Map(bookings.map((b) => [b.booking_id, b]));
  const ledgerByBooking = new Map<string, any[]>();
  for (const l of ledger) {
    const arr = ledgerByBooking.get(l.booking_id) ?? [];
    arr.push(l);
    ledgerByBooking.set(l.booking_id, arr);
  }
  const cashByBooking = new Map<string, number>();
  for (const p of payments) {
    if (!p.booking_id) continue;
    if (p.status === "Cancelled") continue;
    if (p.cash_bank_include === false) continue;
    cashByBooking.set(p.booking_id, (cashByBooking.get(p.booking_id) ?? 0) + Number(p.amount || 0));
  }

  const issues: AuditIssue[] = [];
  const cleanBookings = new Set<string>(bookings.map((b) => b.booking_id));
  const bookingBreakdowns: BookingBreakdown[] = [];
  const issuesByBooking = new Map<string, number>();
  const flag = (b: string | null) => {
    if (b) cleanBookings.delete(b);
  };

  const push = (i: Omit<AuditIssue, "detected_at">) => {
    issues.push({ ...i, detected_at: scannedAt });
    flag(i.booking_id);
    if (i.booking_id)
      issuesByBooking.set(i.booking_id, (issuesByBooking.get(i.booking_id) ?? 0) + 1);
  };

  // ── Per-booking checks ────────────────────────────────────────────────
  const totalBookings = bookings.length;
  let scanned = 0;
  for (const b of bookings) {
    const rows = ledgerByBooking.get(b.booking_id) ?? [];
    const cash = cashByBooking.get(b.booking_id) ?? 0;
    const adj = Number(b.adjustment_credit || 0);
    const engine = recalculateLedger({
      schedule: rows.map((r) => ({
        ledger_id: r.ledger_id,
        particulars: r.particulars,
        due_date: r.due_date,
        due_amount: Number(r.due_amount || 0),
        term_no: r.term_no,
      })),
      cashTotal: cash,
      adjustmentCredit: adj,
      today,
    });
    const contractRaw = Number(b.total_contract_value || 0);
    const rawBalance = contractRaw - (cash + adj);
    const liveBalance = Math.max(0, rawBalance);
    const liveOverdue = engine.overdueAmount;
    const liveOverdueCount = engine.overdueCount;

    // Rule 6
    if (liveOverdue > liveBalance + 1) {
      push({
        id: `${b.booking_id}:overdue_gt_balance`,
        severity: "CRITICAL",
        booking_id: b.booking_id,
        client_name: b.client_name,
        type: "Overdue > Balance",
        description: `Overdue PKR ${fmt(liveOverdue)} exceeds total balance PKR ${fmt(liveBalance)} (Rule 6).`,
      });
    }

    // Check 2 — Overpayment: cash + adj exceeds contract by more than PKR 1
    if (contractRaw > 0 && rawBalance < -1) {
      push({
        id: `${b.booking_id}:overpayment`,
        severity: "CRITICAL",
        booking_id: b.booking_id,
        client_name: b.client_name,
        type: "Overpayment Warning",
        description: `Cash PKR ${fmt(cash)} + adjustments PKR ${fmt(adj)} = PKR ${fmt(cash + adj)} exceeds contract PKR ${fmt(contractRaw)} by PKR ${fmt(-rawBalance)}.`,
      });
    }

    // Check 3 — Cached remaining_balance is negative
    if (Number(b.remaining_balance ?? 0) < -1) {
      push({
        id: `${b.booking_id}:cached_balance_negative`,
        severity: "CRITICAL",
        booking_id: b.booking_id,
        client_name: b.client_name,
        type: "Balance Error",
        description: `Cached remaining balance PKR ${fmt(Number(b.remaining_balance))} is negative — recalculate to fix.`,
      });
    }

    // Check 8 — Duplicate installment / term numbers within this booking's ledger
    {
      const seen = new Map<number, number>();
      for (const r of rows) {
        const t = Number(r.term_no ?? 0);
        if (!t) continue;
        seen.set(t, (seen.get(t) ?? 0) + 1);
      }
      const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([t]) => t);
      if (dupes.length) {
        push({
          id: `${b.booking_id}:duplicate_installment_no`,
          severity: "WARNING",
          booking_id: b.booking_id,
          client_name: b.client_name,
          type: "Duplicate Installment #",
          description: `Ledger has duplicate term_no values: ${dupes.join(", ")}.`,
        });
      }
    }

    // Rule 5
    const ident = checkPlanIdentity(b);
    if (!ident.matches) {
      push({
        id: `${b.booking_id}:plan_identity`,
        severity: "CRITICAL",
        booking_id: b.booking_id,
        client_name: b.client_name,
        type: "Plan ≠ Contract",
        description: `Plan total PKR ${fmt(ident.planSum)} vs contract PKR ${fmt(ident.contract)} (diff ${fmt(ident.diff)}).`,
      });
    }

    // Negative ledger balance on a non-cancelled booking
    const cancelled = String(b.booking_status ?? "").toLowerCase() === "cancelled";
    if (!cancelled) {
      const neg = rows.find((r) => Number(r.running_balance ?? 0) < -1);
      if (neg) {
        push({
          id: `${b.booking_id}:negative_balance`,
          severity: "CRITICAL",
          booking_id: b.booking_id,
          client_name: b.client_name,
          type: "Negative Ledger Balance",
          description: `Ledger row ${neg.ledger_id} has balance PKR ${fmt(Number(neg.running_balance))} on an active booking.`,
        });
      }
    }

    // Completed but remaining > 0
    if (String(b.booking_status ?? "").toLowerCase() === "completed" && liveBalance > 1) {
      push({
        id: `${b.booking_id}:completed_with_balance`,
        severity: "WARNING",
        booking_id: b.booking_id,
        client_name: b.client_name,
        type: "Completed w/ Balance",
        description: `Status is "Completed" but remaining balance is PKR ${fmt(liveBalance)}.`,
      });
    }

    // Risk-level mismatch
    const exp = expectedRisk(liveOverdueCount);
    const cur = String(b.risk_level ?? "").toUpperCase();
    if (cur && cur !== exp) {
      push({
        id: `${b.booking_id}:risk_mismatch`,
        severity: "WARNING",
        booking_id: b.booking_id,
        client_name: b.client_name,
        type: "Risk Level Mismatch",
        description: `Cached risk "${cur}" but live overdue count = ${liveOverdueCount} → expected "${exp}".`,
      });
    }

    // First installment before booking date
    if (b.first_installment_due && b.booking_date && b.first_installment_due < b.booking_date) {
      push({
        id: `${b.booking_id}:installment_before_booking`,
        severity: "WARNING",
        booking_id: b.booking_id,
        client_name: b.client_name,
        type: "Installment Before Booking",
        description: `First installment ${b.first_installment_due} precedes booking date ${b.booking_date}.`,
      });
    }

    // Dummy data
    const dummy: string[] = [];
    if (!b.mobile || DUMMY_PHONE.test(String(b.mobile).replace(/[\s-]/g, ""))) dummy.push("phone");
    if (!b.cnic || DUMMY_CNIC.test(String(b.cnic).replace(/\s/g, ""))) dummy.push("CNIC");
    if (!b.address || DUMMY_ADDR.test(String(b.address))) dummy.push("address");
    if (dummy.length) {
      push({
        id: `${b.booking_id}:dummy_data`,
        severity: "INFO",
        booking_id: b.booking_id,
        client_name: b.client_name,
        type: "Placeholder Data",
        description: `Missing or placeholder ${dummy.join(", ")}.`,
      });
    }

    // ── Per-booking breakdown (rule-by-rule expected vs actual) ─────────
    const contract = Number(b.total_contract_value || 0);
    const effective = cash + adj;
    const liveBalanceCalc = Math.max(0, contract - effective);
    const cachedBalance = Number(b.remaining_balance ?? 0);
    const cachedOverdueAmt = Number(b.total_overdue_amount ?? 0);
    const cachedOverdueCnt = Number(b.current_overdue_count ?? 0);
    const bal2dp = (v: number) => Math.round(v * 100) / 100;
    bookingBreakdowns.push({
      booking_id: b.booking_id,
      booking_date: b.booking_date ?? null,
      client_name: b.client_name ?? null,
      status: b.booking_status ?? null,
      risk_level_cached: b.risk_level ?? null,
      risk_level_expected: exp,
      contract_value: bal2dp(contract),
      cash_received: bal2dp(cash),
      adjustment_credit: bal2dp(adj),
      effective_received: bal2dp(effective),
      live_balance: bal2dp(liveBalance),
      cached_balance: bal2dp(cachedBalance),
      live_overdue_amount: bal2dp(liveOverdue),
      cached_overdue_amount: bal2dp(cachedOverdueAmt),
      live_overdue_count: liveOverdueCount,
      cached_overdue_count: cachedOverdueCnt,
      plan_sum: bal2dp(ident.planSum),
      plan_vs_contract_diff: bal2dp(ident.diff),
      rules: {
        rule5_plan_identity: {
          ok: ident.matches,
          detail: `plan PKR ${fmt(ident.planSum)} vs contract PKR ${fmt(ident.contract)} (Δ ${fmt(ident.diff)})`,
        },
        rule6_overdue_le_balance: {
          ok: liveOverdue <= liveBalance + 1,
          detail: `overdue PKR ${fmt(liveOverdue)} vs balance PKR ${fmt(liveBalance)}`,
        },
        risk_level: {
          ok: !cur || cur === exp,
          detail: cur
            ? `cached "${cur}" vs expected "${exp}" (overdue count ${liveOverdueCount})`
            : `expected "${exp}"`,
        },
        completed_zero_balance: {
          ok: !(String(b.booking_status ?? "").toLowerCase() === "completed" && liveBalance > 1),
          detail: `status "${b.booking_status ?? "—"}", balance PKR ${fmt(liveBalance)}`,
        },
        no_negative_balance: {
          ok: !rows.some((r) => Number(r.running_balance ?? 0) < -1),
          detail: (() => {
            const n = rows.find((r) => Number(r.running_balance ?? 0) < -1);
            return n
              ? `row ${n.ledger_id} balance PKR ${fmt(Number(n.running_balance))}`
              : "all rows ≥ 0";
          })(),
        },
        cached_balance_matches_live: {
          ok: Math.abs(cachedBalance - liveBalance) <= 1,
          detail: `cached PKR ${fmt(cachedBalance)} vs live PKR ${fmt(liveBalance)} (Δ ${fmt(cachedBalance - liveBalance)})`,
        },
        cached_overdue_matches_live: {
          ok:
            Math.abs(cachedOverdueAmt - liveOverdue) <= 1 && cachedOverdueCnt === liveOverdueCount,
          detail: `cached PKR ${fmt(cachedOverdueAmt)} / ${cachedOverdueCnt} rows · live PKR ${fmt(liveOverdue)} / ${liveOverdueCount} rows`,
        },
      },
      issue_count: 0, // filled in after all checks finalize
    });

    scanned += 1;
    if (scanned % 5 === 0 || scanned === totalBookings) {
      tick(`Auditing bookings (${scanned}/${totalBookings})`, scanned, totalBookings);
      checkAbort();
      await yieldToUi(); // keep UI responsive during long scans
    }
  }

  tick("Scanning payments & documents", totalBookings, totalBookings);
  // ── Orphan payments ───────────────────────────────────────────────────
  for (const p of payments) {
    if (p.booking_id && !bookingMap.has(p.booking_id)) {
      push({
        id: `orphan:${p.receipt_no ?? p.id ?? Math.random().toString(36)}`,
        severity: "WARNING",
        booking_id: null,
        client_name: p.client_name ?? null,
        type: "Orphan Payment",
        description: `Receipt ${p.receipt_no ?? "(no #)"} references missing booking ${p.booking_id}.`,
      });
    }
  }

  // ── Duplicate payments (same booking+amount+date) ─────────────────────
  const dupMap = new Map<string, any[]>();
  for (const p of payments) {
    if (!p.booking_id) continue;
    if (p.status === "Cancelled") continue;
    const k = `${p.booking_id}|${p.amount}|${p.payment_date}`;
    const arr = dupMap.get(k) ?? [];
    arr.push(p);
    dupMap.set(k, arr);
  }
  for (const [k, arr] of dupMap) {
    if (arr.length < 2) continue;
    const sample = arr[0];
    push({
      id: `dup_payment:${k}`,
      severity: "WARNING",
      booking_id: sample.booking_id,
      client_name: sample.client_name ?? null,
      type: "Possible Duplicate Payment",
      description: `${arr.length} payments of PKR ${fmt(Number(sample.amount))} on ${sample.payment_date} (${arr.map((p) => p.receipt_no ?? "?").join(", ")}).`,
    });
  }

  // ── Check 6 & 7 — payment amount & date sanity ────────────────────────
  for (const p of payments) {
    if (p.status === "Cancelled") continue;
    const amt = Number(p.amount ?? NaN);
    if (!Number.isFinite(amt) || amt <= 0) {
      push({
        id: `bad_amount:${p.receipt_no ?? p.id ?? Math.random().toString(36)}`,
        severity: "WARNING",
        booking_id: p.booking_id ?? null,
        client_name: p.client_name ?? null,
        type: "Invalid Payment Amount",
        description: `Receipt ${p.receipt_no ?? "(no #)"} has amount ${p.amount ?? "null"}.`,
      });
    }
    if (!p.payment_date) {
      push({
        id: `missing_date:${p.receipt_no ?? p.id ?? Math.random().toString(36)}`,
        severity: "WARNING",
        booking_id: p.booking_id ?? null,
        client_name: p.client_name ?? null,
        type: "Missing Payment Date",
        description: `Receipt ${p.receipt_no ?? "(no #)"} has no payment_date.`,
      });
    }
  }

  // ── Document tracking-number collision ────────────────────────────────
  const trackMap = new Map<string, any[]>();
  for (const d of documents) {
    if (!d.tracking_no) continue;
    const arr = trackMap.get(d.tracking_no) ?? [];
    arr.push(d);
    trackMap.set(d.tracking_no, arr);
  }
  for (const [trk, arr] of trackMap) {
    if (arr.length < 2) continue;
    push({
      id: `doc_collision:${trk}`,
      severity: "INFO",
      booking_id: arr[0].booking_id ?? null,
      client_name: null,
      type: "Document Ref Collision",
      description: `Tracking # "${trk}" used by ${arr.length} documents across bookings: ${[...new Set(arr.map((d) => d.booking_id))].join(", ")}.`,
    });
  }

  const bySeverity: Record<Severity, AuditIssue[]> = { CRITICAL: [], WARNING: [], INFO: [] };
  for (const i of issues) bySeverity[i.severity].push(i);

  for (const br of bookingBreakdowns) br.issue_count = issuesByBooking.get(br.booking_id) ?? 0;

  return {
    issues,
    bySeverity,
    bookingBreakdowns,
    scannedAt,
    totals: {
      critical: bySeverity.CRITICAL.length,
      warning: bySeverity.WARNING.length,
      info: bySeverity.INFO.length,
      cleanBookings: cleanBookings.size,
      totalBookings: bookings.length,
    },
  };
}
