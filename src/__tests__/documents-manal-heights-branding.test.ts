import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Regression guard for the legacy Documents.tsx route.
 *
 * Manal Arcade is a real sibling project in this multi-project ERP, so a few
 * conditional branches legitimately reference it (rendered only when a booking
 * belongs to the Arcade project). This test pins those to the known allow-list
 * and fails if any NEW "Manal Arcade" string is introduced into headers,
 * footers, or metadata — the Manal Heights branch of every conditional, and
 * every unconditional literal, must never say "Manal Arcade".
 */
describe("Documents.tsx — Manal Heights branding regression", () => {
  const source = readFileSync(resolve(__dirname, "../pages/Documents.tsx"), "utf8");

  // Known-good occurrences. Update this list ONLY when adding a new,
  // deliberate Arcade-project conditional branch (mirror the corresponding
  // Manal Heights value in the same ternary).
  const ALLOWED = [
    'isHeights ? "MANAL HEIGHTS" : "MANAL ARCADE"',
    '? "MANAL HEIGHTS, B-17, ISLAMABAD"\n      : "MANAL ARCADE, B-17, ISLAMABAD"',
  ] as const;

  it("has no unexpected 'Manal Arcade' strings", () => {
    // Strip the allow-listed conditional branches, then assert nothing remains.
    let stripped = source;
    for (const line of ALLOWED) {
      expect(stripped, `allow-listed line missing: ${line}`).toContain(line);
      stripped = stripped.split(line).join("");
    }
    const leftover = stripped.match(/manal\s*arcade/gi) ?? [];
    expect(
      leftover,
      `Unexpected 'Manal Arcade' occurrences in Documents.tsx. ` +
        `If this is intentional (new Arcade-project conditional branch), ` +
        `add the exact string to the ALLOWED list in this test.`,
    ).toEqual([]);
  });

  it("Manal Heights fallbacks are present in headers/footers/metadata", () => {
    // Positive assertions — these are the values that must survive.
    expect(source).toMatch(/Manal Heights, B-17 Multi Gardens, Islamabad/);
    expect(source).toMatch(/manalheights@gmail\.com/);
    expect(source).toMatch(/"MANAL HEIGHTS"/);
  });
});
