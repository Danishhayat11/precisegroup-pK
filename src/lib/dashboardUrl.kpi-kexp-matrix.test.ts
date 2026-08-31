import { describe, expect, it } from "vitest";
import { describeSanitization } from "./dashboardUrl";

/**
 * Targeted coverage for the three branches of describeSanitization's
 * landing/resolution sentence:
 *
 *  1. only `kpi` stale   → second-to-last branch: "Landing on: KPI tab → "…"" with NO row
 *  2. only `kexp` stale  → middle branch:        "Landing on: KPI tab → "…" at row #N"
 *  3. neither stale      → returns null (no toast emitted)
 *
 * The combined "Resolved: KPI “…” at row #N (kpi + kexp were both stale)"
 * branch is already covered in dashboardUrl.toast.test.ts.
 */
describe("describeSanitization — kpi vs kexp staleness matrix", () => {
  describe("only `kpi` is stale", () => {
    it("reports the adjustment and lands on the resolved KPI without a row", () => {
      const r = describeSanitization("?tab=kpi&kpi=ghost")!;
      expect(r).not.toBeNull();

      // kpi was adjusted from "ghost" → "overdue" (the recovery default).
      expect(r.adjusted.find((c) => c.key === "kpi")).toEqual({
        key: "kpi",
        from: "ghost",
        to: "overdue",
      });
      // kexp was not present → no kexp change, no clamped row.
      expect(r.adjusted.find((c) => c.key === "kexp")).toBeUndefined();
      expect(r.finalKexpRow).toBeNull();

      // Description: Adjusted segment + plain KPI landing (no row, no "Resolved:").
      expect(r.description).toContain('Adjusted: kpi="ghost" → overdue');
      expect(r.description).toContain("Landing on: KPI tab → “Current Overdue Amount”");
      expect(r.description).not.toMatch(/at row #/);
      expect(r.description).not.toMatch(/Resolved: KPI/);

      // Final destination fields agree with the sentence.
      expect(r.finalTab).toBe("kpi");
      expect(r.finalKpi).toBe("overdue");
    });
  });

  describe("only `kexp` is stale", () => {
    it("keeps the valid KPI and appends the clamped row to the landing sentence", () => {
      // kpi=overdue is valid; kexp=-1 is invalid and clamps to row #1.
      const r = describeSanitization("?tab=kpi&kpi=overdue&kexp=-1")!;
      expect(r).not.toBeNull();

      // kpi must NOT appear in adjustments — it was already valid.
      expect(r.adjusted.find((c) => c.key === "kpi")).toBeUndefined();
      // kexp must appear with its original value and the "row #1" replacement.
      const kexp = r.adjusted.find((c) => c.key === "kexp");
      expect(kexp).toBeDefined();
      expect(kexp!.from).toBe("-1");
      expect(kexp!.to).toMatch(/row #1/);
      expect(r.finalKexpRow).toBe(1);

      // Description: middle branch ("Landing on: KPI tab → … at row #N"), NOT
      // the combined "Resolved" branch (kpi wasn't stale).
      expect(r.description).toContain('kexp="-1" → row #1');
      expect(r.description).toContain("Landing on: KPI tab → “Current Overdue Amount” at row #1");
      expect(r.description).not.toMatch(/Resolved: KPI/);
      expect(r.description).not.toMatch(/kpi \+ kexp were both stale/);

      expect(r.finalTab).toBe("kpi");
      expect(r.finalKpi).toBe("overdue");
    });
  });

  describe("neither `kpi` nor `kexp` is stale", () => {
    it("returns null — no toast, no announcement, nothing to report", () => {
      // All values valid: tab=kpi, kpi=overdue, kexp=2 (in-range row).
      expect(describeSanitization("?tab=kpi&kpi=overdue&kexp=2")).toBeNull();
    });

    it("returns null on the bare overdue URL too (control)", () => {
      expect(describeSanitization("?tab=overdue")).toBeNull();
    });
  });
});
