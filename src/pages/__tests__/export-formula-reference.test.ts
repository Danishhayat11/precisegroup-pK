import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression: the Dashboard PDF + CSV exports must always carry the exact
 * Total Received formula reference so audited reports document the source
 * of the headline KPI. Asserted against source to remain stable across
 * jsdom/canvas/jspdf availability in CI.
 */
const SRC = readFileSync(resolve(__dirname, "../Dashboard.tsx"), "utf8");

const CSV_SECTION_HEADER = "FORMULA REFERENCE";
// The source uses the JS escape `\u2212` (U+2212 MINUS SIGN) literally — match either form.
const CSV_TOTAL_RECEIVED_FORMULA = "Cash Recovered + Adjustment Realised \\u2212 Commission Paid";
const PDF_FOOTER_NOTE = "Total Received = Cash + Adjustment Realised \\u2212 Commission Paid";
const PDF_KEYWORD = "Total Received = Cash + Adjustment Realised \\u2212 Commission Paid";

describe("Dashboard exports — Total Received formula reference", () => {
  it("CSV export emits a FORMULA REFERENCE section", () => {
    expect(SRC).toContain(`sections.push("${CSV_SECTION_HEADER}")`);
  });

  it("CSV FORMULA REFERENCE row contains the exact Total Received formula", () => {
    expect(SRC).toContain(CSV_TOTAL_RECEIVED_FORMULA);
    // Row must be paired with the "Total Received" label
    const idx = SRC.indexOf(CSV_TOTAL_RECEIVED_FORMULA);
    const window = SRC.slice(Math.max(0, idx - 120), idx);
    expect(window).toMatch(/"Total Received"/);
  });

  it("PDF footer note carries the exact Total Received formula (U+2212 minus)", () => {
    expect(SRC).toContain(PDF_FOOTER_NOTE);
    // The note must actually be stamped onto every page via the helper
    expect(SRC).toMatch(/stampFormulaFooter\(pdf,\s*formulaNote/);
  });

  it("PDF metadata (subject + keywords) references the formula when enabled", () => {
    expect(SRC).toMatch(/subject:\s*includeFormulaRef\s*\?\s*formulaNote/);
    expect(SRC).toContain(PDF_KEYWORD);
  });

  it("uses the proper Unicode minus sign (U+2212), not ASCII hyphen, in the visible note", () => {
    // The footer + CSV cells must reference U+2212 (as \u2212 escape) to match fmtPKR formatting
    expect(PDF_FOOTER_NOTE).toContain("\\u2212");
    expect(CSV_TOTAL_RECEIVED_FORMULA).toContain("\\u2212");
  });
});
