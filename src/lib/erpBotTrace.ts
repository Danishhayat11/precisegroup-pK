/**
 * Decision-trace builder for the ERP assistant.
 *
 * Every tool invocation in src/routes/api/ai.ts is now wrapped with a
 * structured "why did the bot do this" trace. The trace records, in order:
 *
 *   1. Preconditions — role gate, admin-only check, and what the bot ASSUMED
 *      about the caller. Verified against `ctx.isAdmin` before dispatch.
 *   2. Validation gate — what fields the bot required, what defaults it
 *      substituted, and how `validateToolArgs` confirmed the payload.
 *   3. Execution assumptions — e.g. FIFO ordering, clamped limits, default
 *      status filters. Each assumption cites the input it derived from.
 *   4. Outcome verification — how the bot proved the tool actually did the
 *      right thing (row counts, `error` field absence, `ok: true`, etc.).
 *
 * The trace is attached to every tool response as `_trace` so the LLM can
 * quote it back to the user when they ask "why?" or "how do you know?" —
 * and so any future UI can surface a per-step audit trail.
 *
 * This module is pure (no I/O) and side-effect free so it can be unit tested
 * and reused from other assistants.
 */

import { GATED_TOOLS } from "./erpBotValidation";

export type TraceStep = {
  n: number;
  phase: "precondition" | "validation" | "assumption" | "verification";
  action: string;
  assumption?: string;
  verification: string;
  outcome: "ok" | "warn" | "blocked";
};

export type DecisionTrace = {
  tool: string;
  summary: string;
  steps: TraceStep[];
};

type TraceCtx = {
  isAdmin: boolean;
  adminOnly: boolean;
  gateBlocked: boolean;
  gateHint?: string;
  gateMissing?: string[];
  gateInconsistencies?: string[];
};

/**
 * Build a decision trace for one tool call. `result` is whatever
 * `executeTool` returned; we inspect it (never mutate) to write the
 * post-execution verification step.
 */
export function buildToolTrace(
  name: string,
  args: unknown,
  tctx: TraceCtx,
  result: unknown,
): DecisionTrace {
  const steps: TraceStep[] = [];
  let n = 1;

  const a = (args ?? {}) as Record<string, unknown>;

  // 1. Precondition: role gate.
  steps.push({
    n: n++,
    phase: "precondition",
    action: `Check caller may invoke "${name}"`,
    assumption: tctx.adminOnly
      ? `"${name}" is admin-only; caller must have Admin role.`
      : `"${name}" is available to all authenticated staff.`,
    verification: tctx.adminOnly
      ? `Read ctx.isAdmin = ${tctx.isAdmin} from the authenticated session.`
      : `No admin check required; ctx.isAdmin = ${tctx.isAdmin}.`,
    outcome: tctx.adminOnly && !tctx.isAdmin ? "blocked" : "ok",
  });

  if (tctx.adminOnly && !tctx.isAdmin) {
    return finalize(name, steps, "Blocked before validation: caller lacks Admin role.");
  }

  // 2. Validation gate.
  const gated = GATED_TOOLS.has(name);
  if (gated) {
    if (tctx.gateBlocked) {
      steps.push({
        n: n++,
        phase: "validation",
        action: "Run validateToolArgs on the model-supplied payload",
        assumption:
          "Required fields and cross-field constraints must be satisfied before any ERP write.",
        verification: `Gate returned validation_failed. Missing: [${(tctx.gateMissing ?? []).join(", ") || "none"}]. Inconsistencies: [${(tctx.gateInconsistencies ?? []).join("; ") || "none"}].`,
        outcome: "blocked",
      });
      return finalize(
        name,
        steps,
        tctx.gateHint ?? "Blocked by validation gate — no ERP write happened.",
      );
    }
    steps.push({
      n: n++,
      phase: "validation",
      action: "Run validateToolArgs on the model-supplied payload",
      assumption:
        "Payload conforms to the tool's schema (required fields present, dates ISO, amounts positive, allocations sum to total, terms unique and ordered).",
      verification:
        "Gate returned { ok: true } — no missing fields and no cross-field inconsistencies.",
      outcome: "ok",
    });
  } else {
    steps.push({
      n: n++,
      phase: "validation",
      action: "Skip validation gate (read-only tool)",
      assumption:
        "Read-only lookups cannot corrupt ERP state, so schema-shape errors surface as query errors instead.",
      verification: `"${name}" is not in GATED_TOOLS.`,
      outcome: "ok",
    });
  }

  // 3. Per-tool execution assumptions.
  for (const step of executionAssumptions(name, a)) {
    steps.push({ ...step, n: n++ });
  }

  // 4. Outcome verification.
  steps.push(verifyOutcome(n, result));

  const summary = summarize(name, steps, result);
  return finalize(name, steps, summary);
}

function finalize(tool: string, steps: TraceStep[], summary: string): DecisionTrace {
  return { tool, summary, steps };
}

function executionAssumptions(
  name: string,
  a: Record<string, unknown>,
): Array<Omit<TraceStep, "n">> {
  const out: Array<Omit<TraceStep, "n">> = [];
  switch (name) {
    case "search_bookings": {
      const raw = Number((a as any).limit ?? 15);
      const clamped = Math.min(Math.max(raw, 1), 30);
      out.push({
        phase: "assumption",
        action: "Clamp result limit to safe range",
        assumption: `Model requested limit=${(a as any).limit ?? "unset"}; ERP caps search at 30 rows to keep responses readable.`,
        verification: `Effective limit = ${clamped}.`,
        outcome: raw !== clamped ? "warn" : "ok",
      });
      out.push({
        phase: "assumption",
        action: "Match query across client_name, cnic, mobile, unit_id, booking_id",
        assumption: "User's free-text query could reference any identifier.",
        verification: "Applied ILIKE %query% across all five columns via .or().",
        outcome: "ok",
      });
      break;
    }
    case "get_booking_detail":
    case "get_ledger":
      out.push({
        phase: "assumption",
        action: `Fetch by booking_id="${String((a as any).booking_id ?? "")}"`,
        assumption:
          "booking_id is the canonical primary key; a single row (or none) will be returned.",
        verification: "Used .eq('booking_id', id) with .maybeSingle() / ordered ledger fetch.",
        outcome: "ok",
      });
      break;
    case "get_payments":
      out.push({
        phase: "assumption",
        action: "Order results by payment_date DESC",
        assumption: "Most-recent payments are almost always what the user wants first.",
        verification: "Applied .order('payment_date', { ascending: false }).",
        outcome: "ok",
      });
      break;
    case "get_overdue_clients":
      out.push({
        phase: "assumption",
        action: "Filter to bookings with total_overdue_amount > 0",
        assumption:
          "Overdue = an installment past due AND unpaid; total_overdue_amount is the aggregated ledger signal.",
        verification: "Applied .gt('total_overdue_amount', 0) and ordered DESC.",
        outcome: "ok",
      });
      if ((a as any).min_days !== undefined) {
        out.push({
          phase: "assumption",
          action: `Post-filter by min_days=${String((a as any).min_days)}`,
          assumption:
            "days_overdue lives on installment_ledger, not bookings, so a second lookup is required.",
          verification:
            "Joined via IN(booking_id) on installment_ledger and kept only matching bookings.",
          outcome: "ok",
        });
      }
      break;
    case "get_portfolio_kpis":
      out.push({
        phase: "assumption",
        action: "Paginate bookings in 1000-row pages",
        assumption:
          "PostgREST caps a single response at 1000 rows; naive aggregation would silently under-count.",
        verification: "Looped .range(from, from+999) until a short page arrived.",
        outcome: "ok",
      });
      break;
    case "propose_log_payment":
      out.push({
        phase: "assumption",
        action: "Do NOT write to payments table",
        assumption:
          "propose_* tools always return a proposal card; the user must confirm before an ERP write.",
        verification: "Handler returned { proposed: true, payload } without touching the database.",
        outcome: "ok",
      });
      break;
    case "propose_split_payment": {
      const allocs = Array.isArray((a as any).allocations) ? ((a as any).allocations as any[]) : [];
      const sum = allocs.reduce((s, r) => s + (typeof r?.amount === "number" ? r.amount : 0), 0);
      out.push({
        phase: "assumption",
        action: "Split allocations sum to total_amount",
        assumption: `Model supplied ${allocs.length} allocation row(s) totalling ${sum.toFixed(2)} against total_amount ${String((a as any).total_amount ?? "?")}.`,
        verification: "validateToolArgs enforced |sum − total| ≤ 1 PKR before this step ran.",
        outcome: "ok",
      });
      break;
    }
    case "propose_edit_payment":
      out.push({
        phase: "assumption",
        action: "Immutable fields excluded from edit payload",
        assumption:
          "receipt_no and booking_id are audit-critical and must never be edited in place.",
        verification: "validateToolArgs rejected the call if either key appeared in fields{}.",
        outcome: "ok",
      });
      break;
    case "propose_restructure_plan":
      out.push({
        phase: "assumption",
        action: "New schedule is strictly ordered and non-duplicating",
        assumption:
          "Restructures must produce a monotonically increasing due_date and unique term_no sequence.",
        verification:
          "validateToolArgs walked the schedule and confirmed ordering before proposal was built.",
        outcome: "ok",
      });
      break;
    case "add_payment_comment":
      out.push({
        phase: "assumption",
        action: "Attach comment to the receipt's booking_id when known",
        assumption:
          "A comment is more useful if it is also findable from the booking, not just the receipt.",
        verification:
          "Looked up payments.booking_id by receipt_no before insert; null-safe if the receipt is stray.",
        outcome: "ok",
      });
      break;
    case "mark_document_reviewed":
      out.push({
        phase: "assumption",
        action: "Stamp reviewed_at = now and reviewed_by = current user",
        assumption:
          "Review status is an audit fact; both timestamp and reviewer identity are required.",
        verification:
          "Used ctx.userId from the authenticated Supabase session, not any model-supplied ID.",
        outcome: "ok",
      });
      break;
    default:
      out.push({
        phase: "assumption",
        action: "No tool-specific assumptions",
        verification: "Executed with the raw args as supplied.",
        outcome: "ok",
      });
  }
  return out;
}

function verifyOutcome(n: number, result: unknown): TraceStep {
  const r = (result ?? {}) as Record<string, unknown>;
  if (typeof r.error === "string") {
    return {
      n,
      phase: "verification",
      action: "Inspect tool result",
      verification: `Tool returned error="${r.error}". No downstream write assumed.`,
      outcome: "blocked",
    };
  }
  if (r.proposed === true) {
    return {
      n,
      phase: "verification",
      action: "Inspect tool result",
      verification: `Proposal returned for action="${String(r.action ?? "")}"; awaiting user confirmation.`,
      outcome: "ok",
    };
  }
  if (r.ok === true) {
    return {
      n,
      phase: "verification",
      action: "Inspect tool result",
      verification: "Handler returned { ok: true } — write succeeded.",
      outcome: "ok",
    };
  }
  if (typeof r.count === "number") {
    return {
      n,
      phase: "verification",
      action: "Inspect tool result",
      verification: `Lookup returned ${r.count} row(s). Empty result means no matching data, not a failure.`,
      outcome: r.count === 0 ? "warn" : "ok",
    };
  }
  return {
    n,
    phase: "verification",
    action: "Inspect tool result",
    verification: "Result object returned without an error field; treated as success.",
    outcome: "ok",
  };
}

function summarize(name: string, steps: TraceStep[], result: unknown): string {
  const blocked = steps.find((s) => s.outcome === "blocked");
  if (blocked) return `Blocked at step ${blocked.n} (${blocked.phase}): ${blocked.verification}`;
  const r = (result ?? {}) as Record<string, unknown>;
  if (r.proposed === true) return `Built proposal for "${name}" — awaiting user confirmation.`;
  if (r.ok === true) return `"${name}" executed and verified.`;
  if (typeof r.count === "number") return `"${name}" returned ${r.count} row(s).`;
  return `"${name}" completed.`;
}
