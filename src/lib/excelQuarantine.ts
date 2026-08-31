// src/lib/excelQuarantine.ts
// Turns raw workbook rows into { clean, quarantined } bundles.
// Nothing here writes to the DB — callers decide when to persist the clean set.

import { validateDate, crossFieldIssues, type ParsedDate } from "./dateValidation";

export interface QuarantineRow {
  sheet: string;
  rowIndex: number; // 1-based row number in the workbook
  reasons: string[];
  raw: Record<string, unknown>;
}

export interface ValidationReport<T extends Record<string, unknown>> {
  sheet: string;
  clean: T[];
  quarantined: QuarantineRow[];
  totals: { input: number; clean: number; quarantined: number };
  fieldStats: Record<string, { parsed: number; failed: number }>;
}

/** Map of sheet name → date columns that must validate. */
export const DATE_COLUMNS: Record<string, string[]> = {
  bookings: ["booking_date", "first_installment_due", "possession_due_date"],
  payments: ["payment_date"],
  installment_ledger: ["due_date", "paid_date"],
  adjustments: ["created_at"],
  units: [],
  clients: [],
  projects: ["start_date", "expected_completion_date"],
};

export function validateSheet<T extends Record<string, unknown>>(
  sheet: string,
  rows: T[],
): ValidationReport<T> {
  const cols = DATE_COLUMNS[sheet] ?? [];
  const clean: T[] = [];
  const quarantined: QuarantineRow[] = [];
  const fieldStats: Record<string, { parsed: number; failed: number }> = {};
  cols.forEach((c) => (fieldStats[c] = { parsed: 0, failed: 0 }));

  rows.forEach((row, i) => {
    const reasons: string[] = [];
    const normalized = { ...row } as Record<string, unknown>;

    for (const col of cols) {
      const raw = row[col];
      if (raw == null || raw === "") continue; // nullable dates are OK
      const parsed: ParsedDate = validateDate(raw);
      if (!parsed.iso) {
        reasons.push(`${col}: ${parsed.issue ?? "invalid"} (${parsed.detail ?? String(raw)})`);
        fieldStats[col].failed++;
      } else {
        fieldStats[col].parsed++;
        normalized[col] = parsed.iso;
      }
    }

    // Cross-field consistency for booking-like sheets
    if (sheet === "bookings" || sheet === "payments" || sheet === "installment_ledger") {
      const xIssues = crossFieldIssues(normalized as never);
      xIssues.forEach((x) => reasons.push(`cross-field: ${x}`));
    }

    if (reasons.length) {
      quarantined.push({ sheet, rowIndex: i + 2, reasons, raw: row });
    } else {
      clean.push(normalized as T);
    }
  });

  return {
    sheet,
    clean,
    quarantined,
    totals: { input: rows.length, clean: clean.length, quarantined: quarantined.length },
    fieldStats,
  };
}

/** Convert quarantine rows to a CSV blob for download. */
export function quarantineToCsv(rows: QuarantineRow[]): string {
  if (!rows.length) return "sheet,rowIndex,reasons\n";
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.raw))));
  const header = ["sheet", "rowIndex", "reasons", ...keys].join(",");
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.sheet, r.rowIndex, r.reasons.join(" | "), ...keys.map((k) => r.raw[k])].map(esc).join(","),
  );
  return [header, ...lines].join("\n");
}

// ------------------------------------------------------------
// Aggregated validation report (clean vs quarantined + rule stats)
// ------------------------------------------------------------

export interface RuleViolation {
  rule: string; // canonical rule id, e.g. "date.unparseable" or "cross-field.due-before-booking"
  field: string; // column or "(cross-field)"
  category: "date-format" | "date-range" | "cross-field" | "other";
  count: number;
  sampleSheet: string;
  sampleRowIndex: number;
  sampleDetail: string;
}

const DATE_ISSUE_TO_RULE: Record<string, { rule: string; category: RuleViolation["category"] }> = {
  unparseable: { rule: "date.unparseable", category: "date-format" },
  invalid: { rule: "date.invalid", category: "date-format" },
  "out-of-range": { rule: "date.out-of-range", category: "date-range" },
  future: { rule: "date.future-not-allowed", category: "date-range" },
  ambiguous: { rule: "date.ambiguous-format", category: "date-format" },
  epoch: { rule: "date.epoch-suspect", category: "date-range" },
};

/** Parse a single reason string like "booking_date: unparseable (foo)" or "cross-field: due < booking_date". */
export function parseReason(reason: string): {
  field: string;
  rule: string;
  category: RuleViolation["category"];
  detail: string;
} {
  if (reason.startsWith("cross-field:")) {
    const detail = reason.replace(/^cross-field:\s*/, "").trim();
    const rule =
      "cross-field." +
      detail
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 48);
    return { field: "(cross-field)", rule, category: "cross-field", detail };
  }
  const m = /^([^:]+):\s*([^(]+)(?:\((.*)\))?$/.exec(reason);
  if (!m) return { field: "(unknown)", rule: "other", category: "other", detail: reason };
  const field = m[1].trim();
  const issueKey = m[2].trim().toLowerCase();
  const detail = (m[3] ?? "").trim();
  const mapped = DATE_ISSUE_TO_RULE[issueKey] ?? {
    rule: `date.${issueKey.replace(/\s+/g, "-")}`,
    category: "date-format" as const,
  };
  return { field, rule: mapped.rule, category: mapped.category, detail };
}

export interface ValidationSummary {
  generatedAt: string;
  totals: { input: number; clean: number; quarantined: number; sheets: number };
  perSheet: Array<{
    sheet: string;
    input: number;
    clean: number;
    quarantined: number;
    cleanPct: number;
    fieldStats: Record<string, { parsed: number; failed: number }>;
  }>;
  violations: RuleViolation[];
}

export function buildValidationSummary(
  reports: ValidationReport<Record<string, unknown>>[],
): ValidationSummary {
  const perSheet = reports.map((r) => ({
    sheet: r.sheet,
    input: r.totals.input,
    clean: r.totals.clean,
    quarantined: r.totals.quarantined,
    cleanPct:
      r.totals.input === 0 ? 100 : Math.round((r.totals.clean / r.totals.input) * 1000) / 10,
    fieldStats: r.fieldStats,
  }));

  const totals = perSheet.reduce(
    (a, s) => ({
      input: a.input + s.input,
      clean: a.clean + s.clean,
      quarantined: a.quarantined + s.quarantined,
      sheets: a.sheets + 1,
    }),
    { input: 0, clean: 0, quarantined: 0, sheets: 0 },
  );

  const bucket = new Map<string, RuleViolation>();
  reports.forEach((r) =>
    r.quarantined.forEach((q) =>
      q.reasons.forEach((reason) => {
        const p = parseReason(reason);
        const key = `${p.rule}::${p.field}`;
        const hit = bucket.get(key);
        if (hit) {
          hit.count++;
        } else {
          bucket.set(key, {
            rule: p.rule,
            field: p.field,
            category: p.category,
            count: 1,
            sampleSheet: q.sheet,
            sampleRowIndex: q.rowIndex,
            sampleDetail: p.detail || reason,
          });
        }
      }),
    ),
  );

  const violations = Array.from(bucket.values()).sort((a, b) => b.count - a.count);
  return { generatedAt: new Date().toISOString(), totals, perSheet, violations };
}

/** Multi-section CSV: Summary, Per-Sheet, Rule Violations, Field Stats, Quarantined Rows. */
export function validationReportToCsv(
  reports: ValidationReport<Record<string, unknown>>[],
): string {
  const s = buildValidationSummary(reports);
  const esc = (v: unknown) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const row = (a: unknown[]) => a.map(esc).join(",");
  const lines: string[] = [];

  lines.push("# Date Validation Report");
  lines.push(row(["Generated at", s.generatedAt]));
  lines.push("");
  lines.push("## Totals");
  lines.push(row(["Sheets validated", "Input rows", "Clean", "Quarantined", "Clean %"]));
  lines.push(
    row([
      s.totals.sheets,
      s.totals.input,
      s.totals.clean,
      s.totals.quarantined,
      s.totals.input ? Math.round((s.totals.clean / s.totals.input) * 1000) / 10 : 100,
    ]),
  );
  lines.push("");

  lines.push("## Per-sheet");
  lines.push(row(["Sheet", "Input", "Clean", "Quarantined", "Clean %", "Status"]));
  s.perSheet.forEach((p) =>
    lines.push(
      row([
        p.sheet,
        p.input,
        p.clean,
        p.quarantined,
        p.cleanPct,
        p.quarantined === 0 ? "Ready" : "Review",
      ]),
    ),
  );
  lines.push("");

  lines.push("## Rule violations");
  lines.push(
    row(["Rule", "Field", "Category", "Count", "Sample sheet", "Sample row #", "Sample detail"]),
  );
  s.violations.forEach((v) =>
    lines.push(
      row([v.rule, v.field, v.category, v.count, v.sampleSheet, v.sampleRowIndex, v.sampleDetail]),
    ),
  );
  if (s.violations.length === 0) lines.push(row(["(none)", "", "", 0, "", "", ""]));
  lines.push("");

  lines.push("## Field parse stats");
  lines.push(row(["Sheet", "Field", "Parsed", "Failed"]));
  s.perSheet.forEach((p) =>
    Object.entries(p.fieldStats).forEach(([f, st]) =>
      lines.push(row([p.sheet, f, st.parsed, st.failed])),
    ),
  );
  lines.push("");

  lines.push("## Quarantined rows");
  const allQ = reports.flatMap((r) => r.quarantined);
  const keys = Array.from(new Set(allQ.flatMap((r) => Object.keys(r.raw))));
  lines.push(row(["Sheet", "Row #", "Reasons", ...keys]));
  allQ.forEach((q) =>
    lines.push(row([q.sheet, q.rowIndex, q.reasons.join(" | "), ...keys.map((k) => q.raw[k])])),
  );
  if (allQ.length === 0) lines.push(row(["(none)", "", ""]));

  return lines.join("\n");
}
