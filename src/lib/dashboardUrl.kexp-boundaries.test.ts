import { describe, expect, it } from "vitest";
import { describeSanitization, sanitizeDashboardSearch } from "./dashboardUrl";

/**
 * Boundary coverage for `kexp` clamping. The validator accepts integers in
 * [0, 100000]. Invalid values are clamped to either 0 (default) or 100000
 * (overflow), and the toast surface reports them as `row #1` / `row #100001`.
 *
 * Matrix:
 *   in-range valid:  kexp=0, kexp=100000               → no change
 *   below-min:       kexp=-1                           → row #1
 *   above-max:       kexp=100001, kexp=9999999         → row #100001
 *   non-integer:     kexp=0.5, kexp=42.7               → row #1
 *   non-numeric:     kexp=abc                          → row #1
 *
 * Each invalid case is run twice — alone (KPI tab adjusted from missing),
 * and with `kpi=ghost` (combined "Resolved: …" branch) — to prove the
 * final clamped row in the toast is correct in BOTH surfaces.
 */

const COMBINED_RE = (row: number) =>
  new RegExp(
    `Resolved: KPI “Current Overdue Amount” at row #${row} \\(kpi \\+ kexp were both stale\\)`,
  );
const LANDING_RE = (row: number) =>
  new RegExp(`Landing on: KPI tab → “Current Overdue Amount” at row #${row}`);

describe("kexp boundary clamping — final row in description", () => {
  describe("in-range values do NOT produce a kexp change", () => {
    it.each([
      { kexp: "0", note: "lower bound" },
      { kexp: "100000", note: "upper bound" },
      { kexp: "1", note: "minimum row above zero" },
      { kexp: "99999", note: "one below upper bound" },
    ])("$note (kexp=$kexp) with a valid kpi → null sanitization", ({ kexp }) => {
      // tab+kpi+kexp all valid → nothing to sanitize → null.
      expect(describeSanitization(`?tab=kpi&kpi=overdue&kexp=${kexp}`)).toBeNull();
      // And the search-string sanitizer also reports no change.
      const { changed, stripped } = sanitizeDashboardSearch(`?tab=kpi&kpi=overdue&kexp=${kexp}`);
      expect(changed).toBe(false);
      expect(stripped).toEqual([]);
    });
  });

  describe("below-minimum values clamp to row #1", () => {
    it.each([
      { kexp: "-1", note: "just below zero" },
      { kexp: "-100000", note: "deep negative" },
    ])("$note (kexp=$kexp) → row #1 in both surfaces", ({ kexp }) => {
      // Standalone: kpi=overdue is valid, only kexp was stale → middle branch.
      const r1 = describeSanitization(`?tab=kpi&kpi=overdue&kexp=${kexp}`)!;
      expect(r1.finalKexpRow).toBe(1);
      expect(r1.description).toContain(`kexp="${kexp}" → row #1`);
      expect(r1.description).toMatch(LANDING_RE(1));

      // Combined: kpi also stale → "Resolved: … at row #1 (kpi + kexp …)".
      const r2 = describeSanitization(`?tab=kpi&kpi=ghost&kexp=${kexp}`)!;
      expect(r2.finalKexpRow).toBe(1);
      expect(r2.description).toMatch(COMBINED_RE(1));
      expect(r2.description).not.toMatch(LANDING_RE(1));
    });
  });

  describe("above-maximum values clamp to row #100001", () => {
    it.each([
      { kexp: "100001", note: "one over the max" },
      { kexp: "9999999", note: "far above the max" },
      { kexp: "123456789", note: "very large integer" },
    ])("$note (kexp=$kexp) → row #100001 in both surfaces", ({ kexp }) => {
      const r1 = describeSanitization(`?tab=kpi&kpi=overdue&kexp=${kexp}`)!;
      expect(r1.finalKexpRow).toBe(100001);
      expect(r1.description).toContain(`kexp="${kexp}" → row #100001`);
      expect(r1.description).toMatch(LANDING_RE(100001));

      const r2 = describeSanitization(`?tab=kpi&kpi=ghost&kexp=${kexp}`)!;
      expect(r2.finalKexpRow).toBe(100001);
      expect(r2.description).toMatch(COMBINED_RE(100001));
    });
  });

  describe("non-integer numbers clamp to row #1 (NOT to upper bound)", () => {
    // n > 100000 ? upper : 0  — non-integers fall through to the default (0).
    it.each([
      { kexp: "0.5", note: "fractional within range" },
      { kexp: "42.7", note: "fractional mid-range" },
      { kexp: "99999.999", note: "fractional just under upper" },
    ])("$note (kexp=$kexp) → row #1", ({ kexp }) => {
      const r = describeSanitization(`?tab=kpi&kpi=overdue&kexp=${kexp}`)!;
      expect(r.finalKexpRow).toBe(1);
      expect(r.description).toContain(`kexp="${kexp}" → row #1`);
    });
  });

  describe("non-numeric values clamp to row #1", () => {
    it.each([
      { kexp: "abc", note: "letters" },
      { kexp: "NaN", note: "literal NaN" },
      { kexp: "Infinity", note: "literal Infinity" },
    ])("$note (kexp=$kexp) → row #1", ({ kexp }) => {
      const r = describeSanitization(`?tab=kpi&kpi=overdue&kexp=${kexp}`)!;
      expect(r.finalKexpRow).toBe(1);
      expect(r.description).toContain(`kexp="${kexp}" → row #1`);
    });
  });

  describe("orphan kexp recovers KPI intent and still clamps to a valid row", () => {
    it("?kexp=-1 → recovers kpi=overdue AND clamps kexp to row #1 (combined branch)", () => {
      // Having any KPI-dependent sub-key (kexp) signals KPI intent, so the
      // sanitizer recovers kpi=overdue and then clamps the stale kexp. Both
      // changes fire together → combined "Resolved" sentence at row #1.
      const r = describeSanitization(`?kexp=-1`)!;
      expect(r).not.toBeNull();
      expect(r.finalKpi).toBe("overdue");
      expect(r.finalKexpRow).toBe(1);
      expect(r.description).toMatch(COMBINED_RE(1));
    });
  });
});
