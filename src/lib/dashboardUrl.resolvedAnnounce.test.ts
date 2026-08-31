/**
 * Unit-level sibling to tests/a11y/url-sanitizer-resolved-announce.spec.ts.
 *
 * The Playwright spec asserts the announcement reaches the live regions in
 * a real browser. This file pins the pure source of that announcement —
 * describeSanitization() — for the same two scenarios, so a regression in
 * the message text fails fast (without spinning up Playwright).
 *
 *   A) kpi-only stale       → "Landing on: KPI tab → “<label>”"
 *   B) kpi + kexp stale     → "Resolved: KPI “<label>” at row #<N>
 *                              (kpi + kexp were both stale)"
 */
import { describe, it, expect } from "vitest";
import { describeSanitization } from "@/lib/dashboardUrl";

describe("Resolved-KPI announcement — message contract", () => {
  describe("A) kpi-only stale", () => {
    it("announces the plain landing sentence without a row component", () => {
      const r = describeSanitization("?tab=kpi&kpi=ghost");
      expect(r).not.toBeNull();
      expect(r!.description).toContain("Landing on: KPI tab → “Current Overdue Amount”");
      // No row in the sentence because kexp was never in the URL.
      expect(r!.description).not.toMatch(/at row #/);
      // Not the combined branch.
      expect(r!.description).not.toMatch(/kpi \+ kexp were both stale/);
      expect(r!.finalKexpRow).toBeNull();
      expect(r!.finalKpi).toBe("overdue");
      expect(r!.kpiLabel).toBe("Current Overdue Amount");
    });
  });

  describe("B) kpi + kexp both stale", () => {
    it("uses the combined Resolved sentence at row #1 for below-min kexp", () => {
      const r = describeSanitization("?tab=kpi&kpi=ghost&kexp=-1");
      expect(r).not.toBeNull();
      expect(r!.description).toContain(
        "Resolved: KPI “Current Overdue Amount” at row #1 (kpi + kexp were both stale)",
      );
      expect(r!.description).not.toMatch(/Landing on: KPI tab →/);
      expect(r!.finalKexpRow).toBe(1);
    });

    it("uses the combined Resolved sentence at row #100001 for above-max kexp", () => {
      const r = describeSanitization("?tab=kpi&kpi=ghost&kexp=99999999");
      expect(r).not.toBeNull();
      expect(r!.description).toContain(
        "Resolved: KPI “Current Overdue Amount” at row #100001 (kpi + kexp were both stale)",
      );
      expect(r!.description).not.toMatch(/Landing on: KPI tab →/);
      expect(r!.finalKexpRow).toBe(100001);
    });

    it("uses the combined Resolved sentence at row #1 for non-numeric kexp", () => {
      const r = describeSanitization("?tab=kpi&kpi=ghost&kexp=abc");
      expect(r).not.toBeNull();
      expect(r!.description).toContain(
        "Resolved: KPI “Current Overdue Amount” at row #1 (kpi + kexp were both stale)",
      );
      expect(r!.finalKexpRow).toBe(1);
    });
  });

  it("control: a clean URL produces no announcement", () => {
    expect(describeSanitization("")).toBeNull();
    expect(describeSanitization("?tab=overdue")).toBeNull();
  });
});
