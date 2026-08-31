/**
 * Schema validator for scripts/audit/expectations/<BOOKING>.json files.
 *
 * Zero runtime dependencies — fails fast with a precise list of errors when
 * required fields are missing, types are wrong, values are negative, or
 * arithmetic identities the auditor relies on are violated.
 *
 * Used by:
 *   - scripts/audit/booking-reconciliation.mjs (per-run guard)
 *   - scripts/audit/validate-expectations.mjs   (validates every pinned file)
 */

export const BOOKING_ID_RE = /^[A-Z]{2,6}-[A-Z0-9]{1,8}-\d{3,8}$/;

// Every key the live cross-check consumes. Keep in sync with `live` in
// runAudit() — adding a new pinned KPI means updating this list.
export const REQUIRED_EXPECTED_FIELDS = Object.freeze([
  "cash_received",
  "remaining_balance",
  "total_contract_value",
  "current_overdue_count",
  "total_overdue_amount",
  "installments_paid",
  "possession_paid",
  "down_payment_paid",
]);

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const isNonNegInt = (v) =>
  typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0;

/**
 * Validate a parsed expectations document.
 * @param {unknown} doc            Parsed JSON contents.
 * @param {object}  [opts]
 * @param {string}  [opts.expectedBookingId]  If provided, doc.booking_id must match.
 * @param {string}  [opts.source]             Filename / path for error messages.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateExpectations(doc, opts = {}) {
  const errors = [];
  const src = opts.source ? ` (${opts.source})` : "";

  if (!isPlainObject(doc)) {
    return { valid: false, errors: [`root must be a JSON object${src}`] };
  }

  // booking_id
  if (typeof doc.booking_id !== "string" || !doc.booking_id.trim()) {
    errors.push(`booking_id is required (string)${src}`);
  } else if (!BOOKING_ID_RE.test(doc.booking_id)) {
    errors.push(`booking_id "${doc.booking_id}" must match ${BOOKING_ID_RE}${src}`);
  } else if (opts.expectedBookingId && doc.booking_id !== opts.expectedBookingId) {
    errors.push(
      `booking_id "${doc.booking_id}" does not match filename ID "${opts.expectedBookingId}"${src}`,
    );
  }

  // label (optional but, if present, must be a string)
  if (doc.label !== undefined && typeof doc.label !== "string") {
    errors.push(`label must be a string when present${src}`);
  }

  // expected block
  if (!isPlainObject(doc.expected)) {
    errors.push(`expected: required object with pinned totals is missing${src}`);
    return { valid: false, errors };
  }

  const exp = doc.expected;

  // Required keys + type check
  for (const key of REQUIRED_EXPECTED_FIELDS) {
    if (!(key in exp)) {
      errors.push(`expected.${key} is required${src}`);
      continue;
    }
    if (!isNonNegInt(exp[key])) {
      errors.push(
        `expected.${key} must be a non-negative integer (got ${JSON.stringify(exp[key])})${src}`,
      );
    }
  }

  // Unknown keys → warn loudly so typos don't silently get ignored.
  for (const key of Object.keys(exp)) {
    if (!REQUIRED_EXPECTED_FIELDS.includes(key)) {
      errors.push(
        `expected.${key} is not a recognized field. Allowed: ${REQUIRED_EXPECTED_FIELDS.join(", ")}${src}`,
      );
    }
  }

  // Arithmetic identities — only run when every field is a number, otherwise
  // the messages would be noise on top of the missing-field errors.
  const allNumeric = REQUIRED_EXPECTED_FIELDS.every((k) => isNonNegInt(exp[k]));
  if (allNumeric) {
    const splitSum = exp.down_payment_paid + exp.installments_paid + exp.possession_paid;
    if (splitSum !== exp.cash_received) {
      errors.push(
        `expected: down_payment_paid + installments_paid + possession_paid ` +
          `(${splitSum}) must equal cash_received (${exp.cash_received})${src}`,
      );
    }
    const contractSum = exp.cash_received + exp.remaining_balance;
    if (contractSum !== exp.total_contract_value) {
      errors.push(
        `expected: cash_received + remaining_balance (${contractSum}) ` +
          `must equal total_contract_value (${exp.total_contract_value})${src}`,
      );
    }
    const zeroCount = exp.current_overdue_count === 0;
    const zeroAmount = exp.total_overdue_amount === 0;
    if (zeroCount !== zeroAmount) {
      errors.push(
        `expected: current_overdue_count (${exp.current_overdue_count}) and ` +
          `total_overdue_amount (${exp.total_overdue_amount}) must both be zero or both be non-zero${src}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Convenience: validate and throw a single multi-line Error on failure.
 * Use this in scripts that want fail-fast behavior with a clean message.
 */
export function assertExpectations(doc, opts = {}) {
  const { valid, errors } = validateExpectations(doc, opts);
  if (!valid) {
    const header = `Invalid expectations file${opts.source ? ` ${opts.source}` : ""}:`;
    const err = new Error([header, ...errors.map((e) => `  • ${e}`)].join("\n"));
    err.code = "EXPECTATIONS_SCHEMA";
    err.errors = errors;
    throw err;
  }
}
