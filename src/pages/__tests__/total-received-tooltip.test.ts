import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = resolve(here, "../../pages/Dashboard.tsx");

// Exact formula text shown in the Total Received tooltip. The unicode
// character is U+2212 MINUS SIGN, not an ASCII hyphen — keep it identical.
const FORMULA = "Cash + Asset Realized \u2212 Commission Paid";

describe("Total Received tooltip", () => {
  const source = readFileSync(DASHBOARD, "utf8");

  it("registers the exact formula text in the KPI_FORMULAS map", () => {
    // The Dashboard renders TooltipContent dynamically from KPI_FORMULAS[key].short.
    // Verify the `received` entry carries the canonical formula string verbatim.
    expect(source).toMatch(
      /received:\s*\{[^}]*short:\s*"Cash \+ Asset Realized \u2212 Commission Paid"/,
    );
  });

  it("renders TooltipContent driven by the formula map (not a hard-coded literal)", () => {
    // The rendered tooltip should pull from {formula.short}, so the JSX no longer
    // inlines the formula text. This keeps the map as the single source of truth.
    const blocks = source.match(/<TooltipContent[^>]*>([\s\S]*?)<\/TooltipContent>/g) ?? [];
    const trimmed = blocks.map((b) =>
      b
        .replace(/<TooltipContent[^>]*>/, "")
        .replace(/<\/TooltipContent>/, "")
        .trim(),
    );
    expect(trimmed).toContain("{formula.short}");
  });

  it("also exposes formulas for cash, adjustment realised, and commission paid", () => {
    // Each monetary KPI must have an entry in KPI_FORMULAS so the tooltip + sr-only
    // description render. Missing keys would silently hide the metric's definition.
    for (const key of ["cash", "adj_realised", "commission", "received"]) {
      expect(source).toMatch(new RegExp(`\\b${key}:\\s*\\{\\s*short:`));
    }
  });

  it("uses the U+2212 minus sign, not an ASCII hyphen", () => {
    expect(FORMULA).toContain("\u2212");
    expect(source).toContain(FORMULA);
    // Guard against an ASCII-hyphen regression sneaking into the same line.
    expect(source).not.toMatch(/Cash \+ Asset Realized - Commission Paid/);
  });
});
