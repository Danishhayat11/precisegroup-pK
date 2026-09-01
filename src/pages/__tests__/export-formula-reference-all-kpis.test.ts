import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Verifies CSV + PDF exports include exact formula reference text for the
 * four headline monetary KPIs: Cash Recovered, Total Adjustment Realised,
 * Commission Paid, Total Received.
 */
const SRC = readFileSync(resolve(__dirname, "../Dashboard.tsx"), "utf8");

const CSV_ROWS: Array<[string, string]> = [
  ["Total Received", "Cash Recovered + Adjustment Realised \\u2212 Commission Paid"],
  ["Cash Recovered", "Sum of cash receipts (excludes adjustments)"],
  ["Total Adjustment Realised", "Sum of approved adjustments marked realised"],
  ["Commission Paid", "Sum of commission payouts in range"],
];

describe("Dashboard exports — formula reference for all monetary KPIs", () => {
  it("CSV FORMULA REFERENCE section contains an exact row for each KPI", () => {
    const start = SRC.indexOf('sections.push("FORMULA REFERENCE")');
    expect(start).toBeGreaterThan(-1);
    const block = SRC.slice(start, start + 2000);
    for (const [label, formula] of CSV_ROWS) {
      expect(block).toContain(`["${label}", "${formula}"]`);
    }
  });

  it("PDF metadata keywords reference each monetary KPI in the Total Received formula", () => {
    // keywords string mentions the four KPIs by name in the formula
    expect(SRC).toMatch(
      /keywords:[\s\S]{0,400}Total Received = Cash \+ Adjustment Realised \\u2212 Commission Paid/,
    );
  });

  it("PDF per-page footer note (U+2212) is stamped on every page via helper", () => {
    expect(SRC).toContain(
      '"Total Received = Cash + Adjustment Realised \\u2212 Commission Paid',
    );
    expect(SRC).toMatch(/stampFormulaFooter\(pdf,\s*formulaNote/);
  });

  it("KPI_FORMULAS map carries short formulas for cash, adj_realised, commission, received", () => {
    const start = SRC.indexOf("const KPI_FORMULAS");
    expect(start).toBeGreaterThan(-1);
    const block = SRC.slice(start, start + 1200);
    expect(block).toMatch(
      /received:\s*\{\s*short:\s*"Cash \+ Adjustment Realised − Commission Paid"/,
    );
    // each of the four keys must be present
    for (const key of ["cash", "adj_realised", "commission", "received"]) {
      expect(block).toMatch(new RegExp(`\\b${key}:\\s*\\{`));
    }
  });
});
