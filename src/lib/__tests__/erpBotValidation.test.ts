import { describe, it, expect } from "vitest";
import { validateToolArgs, GATED_TOOLS } from "@/lib/erpBotValidation";

// Fixed "today" so future-date checks stay deterministic across CI runs.
const TODAY = new Date("2026-07-06T12:00:00Z");

const ok = (v: ReturnType<typeof validateToolArgs>) => expect(v).toEqual({ ok: true });
const fail = (v: ReturnType<typeof validateToolArgs>) => {
  if (!("error" in v)) throw new Error("expected validation_failed, got ok");
  expect(v.error).toBe("validation_failed");
  return v;
};

describe("validateToolArgs — non-gated tools", () => {
  it("passes read-only tools straight through", () => {
    ok(validateToolArgs("search_bookings", { query: "" }, TODAY));
    ok(validateToolArgs("get_ledger", {}, TODAY));
  });
});

describe("propose_log_payment", () => {
  it("accepts a fully-specified past-dated payment", () => {
    ok(
      validateToolArgs(
        "propose_log_payment",
        {
          booking_id: "BK-1",
          amount: 500_000,
          payment_date: "2026-06-30",
          payment_mode: "bank",
        },
        TODAY,
      ),
    );
  });

  it("flags missing required fields", () => {
    const r = fail(validateToolArgs("propose_log_payment", { booking_id: "BK-1" }, TODAY));
    expect(r.missing).toEqual(expect.arrayContaining(["amount", "payment_date"]));
  });

  it("rejects future payment dates", () => {
    const r = fail(
      validateToolArgs(
        "propose_log_payment",
        {
          booking_id: "BK-1",
          amount: 100,
          payment_date: "2027-01-01",
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/future/);
  });

  it("rejects unknown payment modes", () => {
    const r = fail(
      validateToolArgs(
        "propose_log_payment",
        {
          booking_id: "BK-1",
          amount: 100,
          payment_date: "2026-06-30",
          payment_mode: "crypto",
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/payment_mode/);
  });

  it("rejects zero or negative amounts", () => {
    const r = fail(
      validateToolArgs(
        "propose_log_payment",
        {
          booking_id: "BK-1",
          amount: 0,
          payment_date: "2026-06-30",
        },
        TODAY,
      ),
    );
    expect(r.missing).toContain("amount");
  });
});

describe("propose_split_payment", () => {
  it("passes when allocations sum to total within tolerance", () => {
    ok(
      validateToolArgs(
        "propose_split_payment",
        {
          booking_id: "BK-1",
          total_amount: 100_000,
          payment_date: "2026-06-30",
          allocations: [
            { head_label: "Installment 3", amount: 60_000, installment_term_no: 3 },
            { head_label: "Installment 4", amount: 40_000, installment_term_no: 4 },
          ],
        },
        TODAY,
      ),
    );
  });

  it("flags allocations that don't sum to total", () => {
    const r = fail(
      validateToolArgs(
        "propose_split_payment",
        {
          booking_id: "BK-1",
          total_amount: 100_000,
          payment_date: "2026-06-30",
          allocations: [
            { head_label: "A", amount: 60_000 },
            { head_label: "B", amount: 30_000 },
          ],
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/sum/);
  });

  it("flags duplicate installment_term_no", () => {
    const r = fail(
      validateToolArgs(
        "propose_split_payment",
        {
          booking_id: "BK-1",
          total_amount: 200,
          payment_date: "2026-06-30",
          allocations: [
            { head_label: "A", amount: 100, installment_term_no: 5 },
            { head_label: "B", amount: 100, installment_term_no: 5 },
          ],
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/term_no 5/);
  });

  it("requires at least one allocation", () => {
    const r = fail(
      validateToolArgs(
        "propose_split_payment",
        {
          booking_id: "BK-1",
          total_amount: 100,
          payment_date: "2026-06-30",
          allocations: [],
        },
        TODAY,
      ),
    );
    expect(r.missing).toContain("allocations");
  });
});

describe("propose_edit_payment", () => {
  it("blocks editing booking_id or receipt_no via fields", () => {
    const r = fail(
      validateToolArgs(
        "propose_edit_payment",
        {
          receipt_no: "R-1",
          reason: "typo fix in amount",
          fields: { booking_id: "BK-2", amount: 500 },
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/booking_id cannot be edited/);
  });

  it("rejects empty fields object", () => {
    const r = fail(
      validateToolArgs(
        "propose_edit_payment",
        {
          receipt_no: "R-1",
          reason: "clean up",
          fields: {},
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/fields object is empty/);
  });

  it("requires a substantive reason", () => {
    const r = fail(
      validateToolArgs(
        "propose_edit_payment",
        {
          receipt_no: "R-1",
          reason: "x",
          fields: { amount: 500 },
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/reason must be at least/);
  });
});

describe("propose_restructure_plan", () => {
  it("accepts a monotonically ordered schedule", () => {
    ok(
      validateToolArgs(
        "propose_restructure_plan",
        {
          booking_id: "BK-1",
          reason: "client requested extension",
          new_schedule: [
            { term_no: 1, due_date: "2026-08-01", due_amount: 100_000 },
            { term_no: 2, due_date: "2026-09-01", due_amount: 100_000 },
          ],
        },
        TODAY,
      ),
    );
  });

  it("flags out-of-order due dates", () => {
    const r = fail(
      validateToolArgs(
        "propose_restructure_plan",
        {
          booking_id: "BK-1",
          reason: "extension",
          new_schedule: [
            { term_no: 1, due_date: "2026-09-01", due_amount: 100 },
            { term_no: 2, due_date: "2026-08-01", due_amount: 100 },
          ],
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/must strictly increase/);
  });

  it("flags duplicate term_no", () => {
    const r = fail(
      validateToolArgs(
        "propose_restructure_plan",
        {
          booking_id: "BK-1",
          reason: "extension",
          new_schedule: [
            { term_no: 1, due_date: "2026-08-01", due_amount: 100 },
            { term_no: 1, due_date: "2026-09-01", due_amount: 100 },
          ],
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/term_no 1/);
  });
});

describe("add_payment_comment", () => {
  it("rejects unknown kind values", () => {
    const r = fail(
      validateToolArgs(
        "add_payment_comment",
        {
          receipt_no: "R-1",
          comment_text: "looks off",
          kind: "shout",
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/kind must be one of/);
  });
});

describe("propose_bulk_reminders", () => {
  it("flags unbalanced braces in the template", () => {
    const r = fail(
      validateToolArgs(
        "propose_bulk_reminders",
        {
          message_template: "Hello {name, your balance is {amount}",
        },
        TODAY,
      ),
    );
    expect(r.inconsistencies.join(" ")).toMatch(/unbalanced braces/);
  });
});

describe("hint shape", () => {
  it("always mentions no ERP write happened", () => {
    const r = fail(validateToolArgs("propose_log_payment", {}, TODAY));
    expect(r.hint).toMatch(/no ERP write happened/);
  });
});

describe("GATED_TOOLS coverage", () => {
  it("exports the exact tool names ai.ts must gate", () => {
    expect([...GATED_TOOLS].sort()).toEqual([
      "add_payment_comment",
      "mark_document_reviewed",
      "propose_bulk_reminders",
      "propose_edit_payment",
      "propose_log_payment",
      "propose_restructure_plan",
      "propose_split_payment",
    ]);
  });
});
