/**
 * ERP bot — regression scenarios.
 *
 * Each `describe` block corresponds to a CLASS of failure the bot has been
 * caught making at least once. If the bot ever regresses on the same class,
 * the matching test fails and pins down the exact scenario. Add a new block
 * every time you catch a fresh failure category; keep old blocks green
 * forever so no class silently re-opens.
 *
 * Only PURE modules are exercised here — validation gates, memory /
 * ambiguity detection, and the decision-trace builder. DB writes,
 * rollback, and tool dispatch are wired via those pure modules, so
 * scenarios written against them catch the underlying regression class
 * without needing Supabase in the loop.
 */

import { describe, it, expect } from "vitest";
import { validateToolArgs } from "@/lib/erpBotValidation";
import {
  EMPTY_MEMORY,
  extractEntities,
  detectAmbiguity,
  renderMemoryForPrompt,
  pruneMemory,
  type ConversationMemory,
} from "@/lib/assistantMemory";
import { buildToolTrace } from "@/lib/erpBotTrace";

const TODAY = new Date("2026-07-07T12:00:00Z");

// ────────────────────────────────────────────────────────────
// Class 1 — Split payment allocation math errors
// ────────────────────────────────────────────────────────────
// Bot has previously proposed splits whose allocations did not sum to
// total_amount, or targeted the same installment twice.
describe("regression: split-payment math", () => {
  it("catches allocations that under-sum the total", () => {
    const r = validateToolArgs(
      "propose_split_payment",
      {
        booking_id: "BK-MA-00015",
        total_amount: 500_000,
        payment_date: "2026-06-30",
        allocations: [
          { head_label: "Installment 3", amount: 350_000, installment_term_no: 3 },
          { head_label: "Installment 4", amount: 100_000, installment_term_no: 4 },
        ],
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/sum|total/i);
  });

  it("catches allocations that over-sum the total by more than 1 PKR", () => {
    const r = validateToolArgs(
      "propose_split_payment",
      {
        booking_id: "BK-MA-00015",
        total_amount: 500_000,
        payment_date: "2026-06-30",
        allocations: [
          { head_label: "A", amount: 300_000, installment_term_no: 3 },
          { head_label: "B", amount: 200_003, installment_term_no: 4 },
        ],
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
  });

  it("allows 1 PKR rounding drift so real-world splits go through", () => {
    const r = validateToolArgs(
      "propose_split_payment",
      {
        booking_id: "BK-MA-00015",
        total_amount: 500_000,
        payment_date: "2026-06-30",
        allocations: [
          { head_label: "A", amount: 250_000.5, installment_term_no: 3 },
          { head_label: "B", amount: 250_000.5, installment_term_no: 4 },
        ],
      },
      TODAY,
    );
    expect(r).toEqual({ ok: true });
  });

  it("catches duplicate installment_term_no in the same split", () => {
    const r = validateToolArgs(
      "propose_split_payment",
      {
        booking_id: "BK-MA-00015",
        total_amount: 400_000,
        payment_date: "2026-06-30",
        allocations: [
          { head_label: "A", amount: 200_000, installment_term_no: 3 },
          { head_label: "B", amount: 200_000, installment_term_no: 3 },
        ],
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/reuse|term/i);
  });
});

// ────────────────────────────────────────────────────────────
// Class 2 — Restructure schedules that would corrupt the ledger
// ────────────────────────────────────────────────────────────
describe("regression: restructure schedule integrity", () => {
  it("rejects out-of-order due dates", () => {
    const r = validateToolArgs(
      "propose_restructure_plan",
      {
        booking_id: "BK-MA-00015",
        reason: "hardship-based rescheduling",
        new_schedule: [
          { term_no: 1, due_date: "2026-08-01", due_amount: 100_000 },
          { term_no: 2, due_date: "2026-07-01", due_amount: 100_000 },
        ],
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/date/);
  });

  it("rejects duplicate term_no in the new schedule", () => {
    const r = validateToolArgs(
      "propose_restructure_plan",
      {
        booking_id: "BK-MA-00015",
        reason: "renegotiated after slip verification",
        new_schedule: [
          { term_no: 1, due_date: "2026-08-01", due_amount: 100_000 },
          { term_no: 1, due_date: "2026-09-01", due_amount: 100_000 },
        ],
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
  });

  it("rejects a reason that is too short for an audit trail", () => {
    const r = validateToolArgs(
      "propose_restructure_plan",
      {
        booking_id: "BK-MA-00015",
        reason: "ok",
        new_schedule: [{ term_no: 1, due_date: "2026-08-01", due_amount: 100_000 }],
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/reason/);
  });
});

// ────────────────────────────────────────────────────────────
// Class 3 — Edit-payment safety (immutable fields, audit trail)
// ────────────────────────────────────────────────────────────
describe("regression: propose_edit_payment guards", () => {
  it("blocks editing the receipt_no (immutable)", () => {
    const r = validateToolArgs(
      "propose_edit_payment",
      {
        receipt_no: "R-1234",
        reason: "typo in amount",
        fields: { receipt_no: "R-9999" },
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/receipt_no/);
  });

  it("blocks editing the booking_id (must cancel + re-log instead)", () => {
    const r = validateToolArgs(
      "propose_edit_payment",
      {
        receipt_no: "R-1234",
        reason: "wrong booking chosen",
        fields: { booking_id: "BK-MA-00099" },
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/booking_id/);
  });

  it("rejects an empty fields object", () => {
    const r = validateToolArgs(
      "propose_edit_payment",
      {
        receipt_no: "R-1234",
        reason: "fixed offline",
        fields: {},
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/empty/i);
  });
});

// ────────────────────────────────────────────────────────────
// Class 4 — WhatsApp / reminder template with broken placeholders
// ────────────────────────────────────────────────────────────
describe("regression: bulk reminder template", () => {
  it("catches unbalanced placeholder braces", () => {
    const r = validateToolArgs(
      "propose_bulk_reminders",
      {
        message_template: "Assalam o Alaikum {client_name, PKR {amount} pending.",
      },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/brace/i);
  });

  it("accepts a well-formed template", () => {
    const r = validateToolArgs(
      "propose_bulk_reminders",
      {
        message_template: "Assalam o Alaikum {client_name}, PKR {amount} pending.",
        risk_level: "HIGH",
        min_days: 15,
      },
      TODAY,
    );
    expect(r).toEqual({ ok: true });
  });
});

// ────────────────────────────────────────────────────────────
// Class 5 — Ambiguous references the bot has acted on without asking
// ────────────────────────────────────────────────────────────
describe("regression: memory-driven ambiguity detection", () => {
  const seed = (): ConversationMemory => {
    let m = EMPTY_MEMORY;
    m = extractEntities(m, "Booking **Adil Khan** BK-MA-00015 has overdue installments.");
    m = extractEntities(m, "Booking **Adil Sheikh** BK-MA-00042 is on track.");
    m = extractEntities(m, "Receipt R-1201 posted. Receipt R-1202 was reversed.");
    return m;
  };

  it("asks which client when the user says 'him' with two Adils in memory", () => {
    const mem: ConversationMemory = { ...seed(), focus: null };
    const issues = detectAmbiguity(mem, "Send him a reminder");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toMatch(/which|multiple|memory/i);
  });

  it("asks which receipt when the user says 'the receipt' with multiple in memory", () => {
    const issues = detectAmbiguity(seed(), "Add a comment on the receipt");
    expect(issues.join(" ")).toMatch(/receipt/i);
  });

  it("asks for disambiguation on shared first names", () => {
    const issues = detectAmbiguity(seed(), "log a payment for Adil");
    expect(issues.join(" ")).toMatch(/adil/i);
  });

  it("does NOT ask when the user names a concrete booking_id", () => {
    const issues = detectAmbiguity(seed(), "log a payment for Adil BK-MA-00015");
    expect(issues).toEqual([]);
  });

  it("does NOT ask when the user provides a CNIC", () => {
    const issues = detectAmbiguity(seed(), "log a payment for Adil 12345-1234567-1");
    expect(issues).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// Class 6 — Memory entity extraction / persistence hygiene
// ────────────────────────────────────────────────────────────
describe("regression: memory extraction", () => {
  it("extracts booking_id, receipt, CNIC, and unit tokens", () => {
    const m = extractEntities(
      EMPTY_MEMORY,
      "**Adil Khan** BK-MA-00015 / CNIC 12345-1234567-1 / Receipt R-1201 / Unit 305",
    );
    const kinds = m.entities.map((e) => e.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(["booking", "client", "receipt", "cnic", "unit"]));
    expect(m.focus).toEqual({ kind: "booking", id: "BK-MA-00015" });
  });

  it("does NOT extract bare UUIDs that are not tagged as documents", () => {
    const m = extractEntities(
      EMPTY_MEMORY,
      "some uuid 8fc2e9b7-1234-4321-9999-aaaabbbbcccc floating around",
    );
    expect(m.entities.some((e) => e.kind === "document")).toBe(false);
  });

  it("prunes to a bounded size when many entities accumulate", () => {
    let m = EMPTY_MEMORY;
    for (let i = 0; i < 80; i++) {
      m = extractEntities(m, `BK-MA-${String(1000 + i).padStart(5, "0")}`);
    }
    const pruned = pruneMemory(m);
    expect(pruned.entities.length).toBeLessThanOrEqual(40);
  });

  it("rendered prompt block includes focus and per-kind lists", () => {
    const m = extractEntities(EMPTY_MEMORY, "**Adil Khan** BK-MA-00015 Receipt R-1201");
    const block = renderMemoryForPrompt(m);
    expect(block).toMatch(/PERSISTENT CONVERSATION MEMORY/);
    expect(block).toMatch(/BK-MA-00015/);
    expect(block).toMatch(/R-1201/);
    expect(block).toMatch(/focus/i);
  });
});

// ────────────────────────────────────────────────────────────
// Class 7 — Decision-trace completeness on blocked paths
// ────────────────────────────────────────────────────────────
describe("regression: decision trace covers blocking outcomes", () => {
  it("marks the admin-role gate as blocked when a non-admin calls admin-only", () => {
    const trace = buildToolTrace(
      "propose_edit_payment",
      { receipt_no: "R-1", reason: "typo", fields: { amount: 1 } },
      { isAdmin: false, adminOnly: true, gateBlocked: false },
      { error: "admin_required" },
    );
    expect(trace.steps[0].phase).toBe("precondition");
    expect(trace.steps[0].outcome).toBe("blocked");
    expect(trace.summary).toMatch(/blocked/i);
  });

  it("records validation_failed as a blocked step with the concrete hint", () => {
    const trace = buildToolTrace(
      "propose_log_payment",
      { booking_id: "BK-1" },
      {
        isAdmin: false,
        adminOnly: false,
        gateBlocked: true,
        gateHint: "Ask the user for: amount, payment_date.",
        gateMissing: ["amount", "payment_date"],
        gateInconsistencies: [],
      },
      { error: "validation_failed" },
    );
    const validation = trace.steps.find((s) => s.phase === "validation");
    expect(validation?.outcome).toBe("blocked");
    expect(validation?.verification).toMatch(/amount/);
    expect(validation?.verification).toMatch(/payment_date/);
  });

  it("marks a successful proposal as ok with a proposal verification", () => {
    const trace = buildToolTrace(
      "propose_log_payment",
      { booking_id: "BK-1", amount: 100, payment_date: "2026-06-30" },
      { isAdmin: false, adminOnly: false, gateBlocked: false },
      { proposed: true, action: "log_payment", payload: {} },
    );
    expect(trace.steps.every((s) => s.outcome !== "blocked")).toBe(true);
    const verify = trace.steps.find((s) => s.phase === "verification");
    expect(verify?.verification).toMatch(/proposal/i);
  });

  it("clamps search_bookings limit and records it as a warn assumption", () => {
    const trace = buildToolTrace(
      "search_bookings",
      { query: "adil", limit: 999 },
      { isAdmin: false, adminOnly: false, gateBlocked: false },
      { count: 3, rows: [] },
    );
    const clamp = trace.steps.find((s) => s.action.includes("Clamp"));
    expect(clamp?.outcome).toBe("warn");
    expect(clamp?.verification).toMatch(/30/);
  });
});

// ────────────────────────────────────────────────────────────
// Class 8 — Comment / annotation shape errors
// ────────────────────────────────────────────────────────────
describe("regression: add_payment_comment guards", () => {
  it("requires both receipt_no and comment_text", () => {
    const r = validateToolArgs("add_payment_comment", { receipt_no: "" }, TODAY);
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).missing).toEqual(expect.arrayContaining(["receipt_no", "comment_text"]));
  });

  it("rejects a comment that is too short to be meaningful", () => {
    const r = validateToolArgs(
      "add_payment_comment",
      { receipt_no: "R-1", comment_text: "ok" },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/short|3/);
  });

  it("rejects unknown kind values", () => {
    const r = validateToolArgs(
      "add_payment_comment",
      { receipt_no: "R-1", comment_text: "hello there", kind: "spam" },
      TODAY,
    );
    expect(r).toMatchObject({ error: "validation_failed" });
    expect((r as any).inconsistencies.join(" ")).toMatch(/kind/);
  });
});
