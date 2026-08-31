/**
 * Validation gates for the ERP assistant's tool calls.
 *
 * The assistant (see src/routes/api/ai.ts) can propose or execute ERP
 * mutations — logging payments, editing receipts, restructuring
 * installment plans, marking documents reviewed, etc. Before ANY of those
 * side effects happen, we run the raw model-generated `args` through
 * `validateToolArgs()`:
 *
 *   • Missing-field detection — required inputs the model omitted.
 *   • Inconsistency detection — inputs that are individually parseable
 *     but contradict each other (split allocations that don't sum to the
 *     stated total, restructure schedules with out-of-order due dates,
 *     future payment dates, empty edit-field objects, etc.).
 *
 * A validation failure returns a structured `error: "validation_failed"`
 * response the model can read in its next turn — with a concrete `hint`
 * telling it exactly what to ask the user for before retrying. This is
 * the last line of defence before an ERP write; it must be pure (no I/O)
 * and cover every mutating tool.
 */

export type ValidationFailure = {
  error: "validation_failed";
  tool: string;
  missing: string[];
  inconsistencies: string[];
  hint: string;
};

export type ValidationResult = { ok: true } | ValidationFailure;

const PAYMENT_MODES = new Set([
  "cash",
  "bank",
  "cheque",
  "online",
  "adjustment",
  "transfer",
  "pay-order",
  "draft",
]);

const RISK_LEVELS = new Set(["HIGH", "MEDIUM", "LOW", "ALL"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Absolute paise tolerance for split-allocation sums vs total. 1 PKR
// covers currency-rounding edge cases without hiding real mismatches.
const SPLIT_TOTAL_TOLERANCE_PKR = 1;

// Tools this module gates. Anything else in `ai.ts` is read-only and
// short-circuits to { ok: true }.
export const GATED_TOOLS = new Set([
  "add_payment_comment",
  "mark_document_reviewed",
  "propose_log_payment",
  "propose_split_payment",
  "propose_bulk_reminders",
  "propose_edit_payment",
  "propose_restructure_plan",
]);

export function validateToolArgs(
  name: string,
  args: unknown,
  today: Date = new Date(),
): ValidationResult {
  if (!GATED_TOOLS.has(name)) return { ok: true };

  const a = (args ?? {}) as Record<string, unknown>;
  const missing: string[] = [];
  const inconsistencies: string[] = [];

  const req = (field: string, cond: boolean) => {
    if (!cond) missing.push(field);
  };
  const bad = (msg: string) => inconsistencies.push(msg);

  const isNonEmptyString = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  const isPositiveNumber = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;
  const isNonNegativeInt = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0;
  const isPastOrToday = (iso: string): boolean => {
    if (!ISO_DATE.test(iso)) return false;
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    // Compare on the same day boundary so a same-day payment is valid.
    const todayUtc = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    return d.getTime() <= todayUtc.getTime();
  };

  switch (name) {
    case "add_payment_comment": {
      req("receipt_no", isNonEmptyString(a.receipt_no));
      req("comment_text", isNonEmptyString(a.comment_text));
      if (isNonEmptyString(a.comment_text) && a.comment_text.trim().length < 3) {
        bad("comment_text is too short — needs at least 3 characters");
      }
      if (isNonEmptyString(a.comment_text) && a.comment_text.length > 2000) {
        bad("comment_text exceeds 2000 characters");
      }
      if (
        a.kind !== undefined &&
        !["note", "edit_request", "dispute", "other"].includes(String(a.kind))
      ) {
        bad(`kind must be one of: note, edit_request, dispute, other (got "${String(a.kind)}")`);
      }
      break;
    }

    case "mark_document_reviewed": {
      req("document_id", isNonEmptyString(a.document_id));
      break;
    }

    case "propose_log_payment": {
      req("booking_id", isNonEmptyString(a.booking_id));
      req("amount", isPositiveNumber(a.amount));
      req("payment_date", isNonEmptyString(a.payment_date));
      if (isNonEmptyString(a.payment_date)) {
        if (!ISO_DATE.test(a.payment_date))
          bad(`payment_date "${a.payment_date}" is not YYYY-MM-DD`);
        else if (!isPastOrToday(a.payment_date))
          bad(`payment_date "${a.payment_date}" is in the future`);
      }
      if (a.amount !== undefined && !isPositiveNumber(a.amount)) {
        bad("amount must be a positive number");
      }
      if (
        a.payment_mode !== undefined &&
        !PAYMENT_MODES.has(String(a.payment_mode).toLowerCase())
      ) {
        bad(
          `payment_mode "${String(a.payment_mode)}" is not one of: ${[...PAYMENT_MODES].join(", ")}`,
        );
      }
      break;
    }

    case "propose_split_payment": {
      req("booking_id", isNonEmptyString(a.booking_id));
      req("total_amount", isPositiveNumber(a.total_amount));
      req("payment_date", isNonEmptyString(a.payment_date));
      req("allocations", Array.isArray(a.allocations) && (a.allocations as unknown[]).length > 0);
      if (isNonEmptyString(a.payment_date)) {
        if (!ISO_DATE.test(a.payment_date))
          bad(`payment_date "${a.payment_date}" is not YYYY-MM-DD`);
        else if (!isPastOrToday(a.payment_date))
          bad(`payment_date "${a.payment_date}" is in the future`);
      }
      if (Array.isArray(a.allocations)) {
        const allocs = a.allocations as Array<Record<string, unknown>>;
        let sum = 0;
        allocs.forEach((row, idx) => {
          if (!row || typeof row !== "object") {
            bad(`allocations[${idx}] is not an object`);
            return;
          }
          if (!isNonEmptyString(row.head_label)) bad(`allocations[${idx}].head_label is missing`);
          if (!isPositiveNumber(row.amount)) bad(`allocations[${idx}].amount must be > 0`);
          else sum += row.amount;
          if (row.installment_term_no !== undefined && !isNonNegativeInt(row.installment_term_no)) {
            bad(`allocations[${idx}].installment_term_no must be a non-negative integer`);
          }
        });
        if (
          isPositiveNumber(a.total_amount) &&
          Math.abs(sum - a.total_amount) > SPLIT_TOTAL_TOLERANCE_PKR
        ) {
          bad(
            `allocations sum to ${sum.toFixed(2)} but total_amount is ${a.total_amount.toFixed(2)} — difference of ${(sum - a.total_amount).toFixed(2)} exceeds ${SPLIT_TOTAL_TOLERANCE_PKR} PKR tolerance`,
          );
        }
        // Duplicate term_no would double-post to the same installment row.
        const terms = allocs
          .map((r) => r?.installment_term_no)
          .filter((t): t is number => typeof t === "number");
        const dupes = terms.filter((t, i) => terms.indexOf(t) !== i);
        if (dupes.length)
          bad(
            `allocations reuse installment_term_no ${[...new Set(dupes)].join(", ")} — each term can only be targeted once per split`,
          );
      }
      break;
    }

    case "propose_bulk_reminders": {
      if (a.risk_level !== undefined && !RISK_LEVELS.has(String(a.risk_level).toUpperCase())) {
        bad(
          `risk_level must be one of: ${[...RISK_LEVELS].join(", ")} (got "${String(a.risk_level)}")`,
        );
      }
      if (a.min_days !== undefined && !isNonNegativeInt(a.min_days)) {
        bad("min_days must be a non-negative integer");
      }
      if (a.message_template !== undefined) {
        const tpl = String(a.message_template);
        if (tpl.trim().length === 0) bad("message_template is empty");
        else if (tpl.length > 1000) bad("message_template exceeds 1000 characters");
        const opens = (tpl.match(/\{/g) ?? []).length;
        const closes = (tpl.match(/\}/g) ?? []).length;
        if (opens !== closes)
          bad(
            `message_template has unbalanced braces (${opens} '{' vs ${closes} '}') — placeholders won't render`,
          );
      }
      break;
    }

    case "propose_edit_payment": {
      req("receipt_no", isNonEmptyString(a.receipt_no));
      req("reason", isNonEmptyString(a.reason));
      const fieldsOk = a.fields && typeof a.fields === "object" && !Array.isArray(a.fields);
      req("fields", !!fieldsOk);
      if (isNonEmptyString(a.reason) && a.reason.trim().length < 5) {
        bad("reason must be at least 5 characters — audit trail requires a real justification");
      }
      if (fieldsOk) {
        const f = a.fields as Record<string, unknown>;
        if (Object.keys(f).length === 0) bad("fields object is empty — nothing to edit");
        if ("booking_id" in f)
          bad("fields.booking_id cannot be edited — cancel and re-log the payment instead");
        if ("receipt_no" in f)
          bad("fields.receipt_no cannot be edited — receipt numbers are immutable");
        if (f.amount !== undefined && !isPositiveNumber(f.amount))
          bad("fields.amount must be a positive number");
        if (f.payment_date !== undefined) {
          const pd = String(f.payment_date);
          if (!ISO_DATE.test(pd)) bad(`fields.payment_date "${pd}" is not YYYY-MM-DD`);
          else if (!isPastOrToday(pd)) bad(`fields.payment_date "${pd}" is in the future`);
        }
        if (
          f.payment_mode !== undefined &&
          !PAYMENT_MODES.has(String(f.payment_mode).toLowerCase())
        ) {
          bad(`fields.payment_mode "${String(f.payment_mode)}" is not a recognised mode`);
        }
      }
      break;
    }

    case "propose_restructure_plan": {
      req("booking_id", isNonEmptyString(a.booking_id));
      req("reason", isNonEmptyString(a.reason));
      req(
        "new_schedule",
        Array.isArray(a.new_schedule) && (a.new_schedule as unknown[]).length > 0,
      );
      if (isNonEmptyString(a.reason) && a.reason.trim().length < 5) {
        bad(
          "reason must be at least 5 characters — restructures require an audit-worthy justification",
        );
      }
      if (Array.isArray(a.new_schedule)) {
        const rows = a.new_schedule as Array<Record<string, unknown>>;
        const seenTerms = new Set<number>();
        let prevDate: string | null = null;
        let prevTerm: number | null = null;
        rows.forEach((row, idx) => {
          if (!row || typeof row !== "object") {
            bad(`new_schedule[${idx}] is not an object`);
            return;
          }
          if (!isNonEmptyString(row.due_date)) bad(`new_schedule[${idx}].due_date is missing`);
          else if (!ISO_DATE.test(row.due_date))
            bad(`new_schedule[${idx}].due_date "${row.due_date}" is not YYYY-MM-DD`);
          if (!isPositiveNumber(row.due_amount)) bad(`new_schedule[${idx}].due_amount must be > 0`);
          if (row.term_no !== undefined) {
            if (!isNonNegativeInt(row.term_no))
              bad(`new_schedule[${idx}].term_no must be a non-negative integer`);
            else {
              if (seenTerms.has(row.term_no))
                bad(
                  `new_schedule reuses term_no ${row.term_no} — each installment number must be unique`,
                );
              seenTerms.add(row.term_no);
              if (prevTerm !== null && row.term_no <= prevTerm) {
                bad(
                  `new_schedule[${idx}].term_no ${row.term_no} does not follow the previous term ${prevTerm} — schedule must be ordered`,
                );
              }
              prevTerm = row.term_no;
            }
          }
          if (isNonEmptyString(row.due_date) && ISO_DATE.test(row.due_date)) {
            if (prevDate && row.due_date <= prevDate) {
              bad(
                `new_schedule[${idx}].due_date ${row.due_date} is not after previous row's ${prevDate} — dates must strictly increase`,
              );
            }
            prevDate = row.due_date;
          }
        });
      }
      break;
    }
  }

  if (missing.length === 0 && inconsistencies.length === 0) return { ok: true };

  return {
    error: "validation_failed",
    tool: name,
    missing,
    inconsistencies,
    hint: buildHint(name, missing, inconsistencies),
  };
}

function buildHint(tool: string, missing: string[], inconsistencies: string[]): string {
  const parts: string[] = [];
  if (missing.length) {
    parts.push(
      `Ask the user for: ${missing.join(", ")}. Do NOT retry ${tool} until every required field is confirmed.`,
    );
  }
  if (inconsistencies.length) {
    parts.push(
      `Fix these inconsistencies first: ${inconsistencies.map((s) => `• ${s}`).join(" ")}`,
    );
  }
  parts.push("This tool was blocked by a validation gate — no ERP write happened.");
  return parts.join(" ");
}
