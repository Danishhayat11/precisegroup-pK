import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression: the "Include formula reference" toggle must gate BOTH the
 * CSV FORMULA REFERENCE section and the PDF footer/metadata note.
 */
const SRC = readFileSync(resolve(__dirname, "../Dashboard.tsx"), "utf8");

describe("Dashboard export — include/hide formula reference toggle", () => {
  it("exposes a stateful, persisted toggle (default ON)", () => {
    expect(SRC).toContain("dashboard.export.includeFormulaRef");
    expect(SRC).toMatch(/const \[includeFormulaRef, setIncludeFormulaRef\]/);
    // Defaults to true when the localStorage value is unset
    expect(SRC).toMatch(/v === null \? true : v === "1"/);
  });

  it("renders a checkbox menu item to control it", () => {
    expect(SRC).toContain("DropdownMenuCheckboxItem");
    expect(SRC).toMatch(/checked=\{includeFormulaRef\}/);
    expect(SRC).toMatch(/onCheckedChange=\{\(v\) => setIncludeFormulaRef\(Boolean\(v\)\)\}/);
    expect(SRC).toContain("Include formula reference");
  });

  it("CSV export gates the FORMULA REFERENCE block on the toggle", () => {
    expect(SRC).toMatch(/if \(includeFormulaRef\) \{[\s\S]*?sections\.push\("FORMULA REFERENCE"\)/);
  });

  it("PDF export gates the per-page footer stamp on the toggle", () => {
    expect(SRC).toMatch(/if \(includeFormulaRef\) \{[\s\S]*?stampFormulaFooter\(pdf, formulaNote/);
  });

  it("PDF metadata (subject/keywords) is generic when toggle is OFF", () => {
    expect(SRC).toMatch(/subject: includeFormulaRef \? formulaNote :/);
    expect(SRC).toMatch(/keywords: includeFormulaRef\s*\?/);
  });
});
