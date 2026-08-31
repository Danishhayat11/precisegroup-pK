import { describe, expect, it } from "vitest";
import { describeSanitization } from "./dashboardUrl";

/**
 * Wording-focused coverage for the URL sanitizer toast. Two concerns:
 *
 *  1. Invalid params are quoted in the toast with their ORIGINAL value, in
 *     the correct outcome bucket ("Invalid (removed)" vs "Adjusted").
 *  2. The resolved fallback KPI destination is named in plain English and
 *     uses the correct sentence variant ("Landing on…", "Landing on … at
 *     row #N", or the combined "Resolved: KPI … at row #N").
 */

const KPI_CASES: Array<[string, string]> = [
  ["sell", "Total Sell Value"],
  ["cash", "Cash Recovered"],
  ["adj_allowed", "Total Adjustment Approved"],
  ["adj_realised", "Total Adjustment Realised"],
  ["received", "Total Received"],
  ["pending", "Total Pending Balance"],
  ["overdue", "Current Overdue Amount"],
];

describe("toast wording — invalid params", () => {
  it("quotes each removed param with its raw original value", () => {
    const r = describeSanitization("?risk=NEON&age=tomorrow&osize=42")!;
    expect(r.description).toContain('risk="NEON"');
    expect(r.description).toContain('age="tomorrow"');
    expect(r.description).toContain('osize="42"');
    const removedSegment = r.description.split("Invalid (removed):")[1]?.split("·")[0] ?? "";
    for (const f of ['risk="NEON"', 'age="tomorrow"', 'osize="42"']) {
      expect(removedSegment).toContain(f);
    }
  });

  it("quotes each adjusted param with from → to in the Adjusted segment", () => {
    const r = describeSanitization("?kpi=ghost&kexp=-7")!;
    const adjustedSegment = r.description.split("Adjusted:")[1]?.split("·")[0] ?? "";
    expect(adjustedSegment).toContain('kpi="ghost" → overdue');
    expect(adjustedSegment).toContain('kexp="-7" → row #1');
  });

  it("returns null (no toast wording) when the URL is already clean", () => {
    expect(describeSanitization("?tab=overdue&risk=HIGH&age=31-60")).toBeNull();
    expect(describeSanitization("?tab=kpi&kpi=overdue&kexp=3")).toBeNull();
  });

  it("never leaks invalid values into the destination sentence", () => {
    const r = describeSanitization("?kpi=NOT_REAL&risk=BANANA")!;
    const tail = r.description.split("Landing on:")[1] ?? r.description.split("Resolved:")[1] ?? "";
    expect(tail).not.toContain("NOT_REAL");
    expect(tail).not.toContain("BANANA");
    expect(r.description).toContain("Current Overdue Amount");
  });
});

describe("toast wording — resolved fallback KPI destination", () => {
  it.each(KPI_CASES)("kpi=%s recovers to “%s” in the Landing sentence", (key, label) => {
    // Force a sanitizer change so wording is emitted.
    const r = describeSanitization(`?kpi=${key}&risk=BANANA`)!;
    expect(r.finalTab).toBe("kpi");
    expect(r.finalKpi).toBe(key);
    expect(r.kpiLabel).toBe(label);
    expect(r.description).toContain(`Landing on: KPI tab → “${label}”`);
  });

  it.each(KPI_CASES)("kpi=%s plus invalid kexp lands on “%s” at the clamped row", (key, label) => {
    // kexp=-1 clamps to row #1; kpi survives so the "at row #N" branch fires.
    const r = describeSanitization(`?kpi=${key}&kexp=-1`)!;
    expect(r.finalKexpRow).toBe(1);
    expect(r.description).toContain(`Landing on: KPI tab → “${label}” at row #1`);
    // The combined "Resolved:" branch must NOT fire when kpi was valid.
    expect(r.description).not.toContain("Resolved:");
  });

  it.each(KPI_CASES)(
    "combined stale kpi + kexp uses the single 'Resolved' sentence (typo of %s)",
    (key) => {
      const r = describeSanitization(`?kpi=${key}_typo&kexp=-2`)!;
      // Invalid kpi → recovers to canonical default ("overdue"), kexp → row #1.
      expect(r.finalKpi).toBe("overdue");
      expect(r.kpiLabel).toBe("Current Overdue Amount");
      expect(r.finalKexpRow).toBe(1);
      expect(r.description).toContain(
        "Resolved: KPI “Current Overdue Amount” at row #1 (kpi + kexp were both stale)",
      );
      // Combined branch replaces the plain "Landing on:" sentence.
      expect(r.description).not.toContain("Landing on:");
      // Original invalid values are still echoed in the Adjusted segment.
      expect(r.description).toContain(`kpi="${key}_typo" → overdue`);
      expect(r.description).toContain('kexp="-2" → row #1');
    },
  );

  it("missing kpi recovered via KPI intent shows from='(missing)' → overdue", () => {
    const r = describeSanitization("?tab=kpi")!;
    expect(r.description).toContain('Adjusted: kpi="(missing)" → overdue');
    expect(r.description).toContain("Landing on: KPI tab → “Current Overdue Amount”");
  });

  it("non-KPI invalids fall back to the Overdue tab in the destination sentence", () => {
    const r = describeSanitization("?risk=BANANA&age=zzz")!;
    expect(r.finalTab).toBe("overdue");
    expect(r.finalKpi).toBeNull();
    expect(r.kpiLabel).toBeNull();
    expect(r.description).toContain("Landing on: Overdue tab");
    expect(r.description).not.toContain("KPI tab");
  });

  it("oversized kexp clamps to row #100001 in the destination sentence", () => {
    const r = describeSanitization("?kpi=cash&kexp=999999")!;
    expect(r.finalKexpRow).toBe(100_001);
    expect(r.description).toContain("Landing on: KPI tab → “Cash Recovered” at row #100001");
  });

  it("destination sentence is always the last segment of the description", () => {
    const r = describeSanitization("?risk=BANANA&kpi=ghost&kexp=2")!;
    const segments = r.description.split(" · ");
    const last = segments[segments.length - 1];
    expect(last.startsWith("Landing on:") || last.startsWith("Resolved:")).toBe(true);
  });
});
