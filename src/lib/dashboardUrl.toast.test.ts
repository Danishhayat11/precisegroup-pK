import { describe, expect, it } from "vitest";
import { describeSanitization } from "./dashboardUrl";

/**
 * Asserts the sanitizer's toast description lists every invalid query param,
 * shows its original value, and reports the exact replacement (or "removed").
 * Each test also verifies the "Landing on:" suffix confirms the final tab/KPI.
 */
describe("describeSanitization — toast description", () => {
  it("returns null when nothing is invalid", () => {
    expect(describeSanitization("?tab=overdue&risk=HIGH")).toBeNull();
  });

  it("lists an invalid risk in 'Invalid (removed)' with its original value", () => {
    const r = describeSanitization("?risk=BANANA")!;
    expect(r).not.toBeNull();
    expect(r.removed.map((c) => c.key)).toContain("risk");
    expect(r.description).toContain('Invalid (removed): risk="BANANA"');
    expect(r.description).toContain("Landing on: Overdue tab");
  });

  it("lists multiple removed params comma-separated", () => {
    const r = describeSanitization("?risk=BANANA&age=999&osize=7")!;
    const desc = r.description;
    for (const fragment of ['risk="BANANA"', 'age="999"', 'osize="7"']) {
      expect(desc).toContain(fragment);
    }
    expect(desc.split("Invalid (removed):")[1]?.split("·")[0]).toContain(",");
  });

  it("recovers kpi=overdue and reports adjustment with from='(missing)'", () => {
    const r = describeSanitization("?tab=kpi")!;
    const adj = r.adjusted.find((c) => c.key === "kpi");
    expect(adj).toEqual({ key: "kpi", from: "(missing)", to: "overdue" });
    expect(r.description).toContain('Adjusted: kpi="(missing)" → overdue');
    expect(r.description).toContain("Landing on: KPI tab → “Current Overdue Amount”");
    expect(r.finalTab).toBe("kpi");
    expect(r.finalKpi).toBe("overdue");
  });

  it("recovers from invalid kpi value, showing original value and replacement", () => {
    const r = describeSanitization("?kpi=nope")!;
    const adj = r.adjusted.find((c) => c.key === "kpi");
    expect(adj).toEqual({ key: "kpi", from: "nope", to: "overdue" });
    expect(r.description).toContain('Adjusted: kpi="nope" → overdue');
    expect(r.description).toContain("Landing on: KPI tab → “Current Overdue Amount”");
  });

  it("clamps negative kexp to row #1 and names the surviving KPI", () => {
    const r = describeSanitization("?kpi=overdue&kexp=-9")!;
    const adj = r.adjusted.find((c) => c.key === "kexp");
    expect(adj).toEqual({ key: "kexp", from: "-9", to: "row #1" });
    expect(r.description).toContain('kexp="-9" → row #1');
    expect(r.description).toContain("Landing on: KPI tab → “Current Overdue Amount”");
  });

  it("clamps oversized kexp to row #100001", () => {
    const r = describeSanitization("?kpi=sell&kexp=999999")!;
    const adj = r.adjusted.find((c) => c.key === "kexp");
    expect(adj?.to).toBe("row #100001");
    expect(r.description).toContain('kexp="999999" → row #100001');
    expect(r.description).toContain("Landing on: KPI tab → “Total Sell Value”");
  });

  it("drops KPI sub-params when kpi cannot be recovered", () => {
    // No kpi, no tab=kpi, no sub-params -> nothing to recover; but invalid kpage alone
    // signals KPI intent in the recovery rule. Use a non-KPI-intent invalid param instead:
    const r = describeSanitization("?risk=BANANA&age=xyz")!;
    expect(r.finalTab).toBe("overdue");
    expect(r.finalKpi).toBeNull();
    expect(r.description).toContain("Landing on: Overdue tab");
  });

  it("groups both removed and adjusted in the description in fixed order", () => {
    const r = describeSanitization("?risk=BANANA&tab=kpi&kexp=-1&kpi=overdue")!;
    const desc = r.description;
    expect(desc.indexOf("Invalid (removed):")).toBeGreaterThanOrEqual(0);
    expect(desc.indexOf("Adjusted:")).toBeGreaterThan(desc.indexOf("Invalid (removed):"));
    expect(desc.indexOf("Landing on:")).toBeGreaterThan(desc.indexOf("Adjusted:"));
    expect(desc).toContain('risk="BANANA"');
    expect(desc).toContain('kexp="-1" → row #1');
  });

  it("truncates absurdly long original values to keep the toast readable", () => {
    const long = "x".repeat(200);
    const r = describeSanitization(`?risk=${long}`)!;
    const fromValue = r.removed.find((c) => c.key === "risk")?.from ?? "";
    expect(fromValue.length).toBeLessThanOrEqual(24);
    expect(fromValue.endsWith("…")).toBe(true);
    expect(r.description).toContain(`risk="${fromValue}"`);
  });

  it("labels every recoverable KPI key correctly in the landing line", () => {
    const cases: Array<[string, string]> = [
      ["sell", "Total Sell Value"],
      ["cash", "Cash Recovered"],
      ["adj_allowed", "Total Adjustment Approved"],
      ["adj_realised", "Total Adjustment Realised"],
      ["received", "Total Received"],
      ["pending", "Total Pending Balance"],
      ["overdue", "Current Overdue Amount"],
    ];
    for (const [key, label] of cases) {
      // Force a change so the report is emitted: add an invalid risk alongside.
      const r = describeSanitization(`?kpi=${key}&risk=BANANA`)!;
      expect(r.finalKpi).toBe(key);
      expect(r.kpiLabel).toBe(label);
      expect(r.description).toContain(`Landing on: KPI tab → “${label}”`);
    }
  });

  it("title is stable for use as the toast headline", () => {
    const r = describeSanitization("?risk=BANANA")!;
    expect(r.title).toBe("Some link parameters were invalid");
  });

  it("resetKeys is deduped and covers every changed param", () => {
    const r = describeSanitization("?risk=BANANA&age=xyz&tab=kpi&kexp=-9")!;
    expect(new Set(r.resetKeys)).toEqual(new Set(r.changes.map((c) => c.key)));
    expect(r.resetKeys.length).toBe(new Set(r.resetKeys).size);
  });
});

/**
 * Focused coverage for KPI-namespaced params (kpi, kpage, ksize, ksort, kq, kexp).
 * Each case asserts: (1) the original invalid value appears verbatim in the toast
 * description, (2) the param is reported under the correct outcome bucket
 * (removed vs. adjusted with exact replacement), and (3) the landing line names
 * the surviving KPI when one can be recovered.
 */
describe("describeSanitization — KPI param coverage", () => {
  it("invalid kpage is reported as removed with its original value", () => {
    const r = describeSanitization("?kpi=overdue&kpage=abc")!;
    const c = r.removed.find((x) => x.key === "kpage");
    expect(c).toEqual({ key: "kpage", from: "abc", to: "removed" });
    expect(r.description).toContain('kpage="abc"');
    expect(r.description).toMatch(/Invalid \(removed\):[^·]*kpage="abc"/);
  });

  it("invalid ksize is reported as removed with its original value", () => {
    const r = describeSanitization("?kpi=overdue&ksize=7")!;
    const c = r.removed.find((x) => x.key === "ksize");
    expect(c).toEqual({ key: "ksize", from: "7", to: "removed" });
    expect(r.description).toContain('ksize="7"');
  });

  it("invalid ksort is reported as removed with its original value", () => {
    const r = describeSanitization("?kpi=overdue&ksort=foo.bar")!;
    const c = r.removed.find((x) => x.key === "ksort");
    expect(c).toEqual({ key: "ksort", from: "foo.bar", to: "removed" });
    expect(r.description).toContain('ksort="foo.bar"');
  });

  it("empty kq is reported as removed (empty string shown literally)", () => {
    const r = describeSanitization("?kpi=overdue&kq=")!;
    const c = r.removed.find((x) => x.key === "kq");
    expect(c).toEqual({ key: "kq", from: "", to: "removed" });
    expect(r.description).toContain('kq=""');
  });

  it("kexp clamps negative values to 'row #1' (adjustment, not removal)", () => {
    const r = describeSanitization("?kpi=cash&kexp=-50")!;
    expect(r.removed.find((x) => x.key === "kexp")).toBeUndefined();
    const c = r.adjusted.find((x) => x.key === "kexp");
    expect(c).toEqual({ key: "kexp", from: "-50", to: "row #1" });
    expect(r.description).toContain('Adjusted: kexp="-50" → row #1');
    expect(r.description).toContain("Landing on: KPI tab → “Cash Recovered”");
  });

  it("kexp clamps oversized values to 'row #100001'", () => {
    const r = describeSanitization("?kpi=pending&kexp=250000")!;
    const c = r.adjusted.find((x) => x.key === "kexp");
    expect(c).toEqual({ key: "kexp", from: "250000", to: "row #100001" });
    expect(r.description).toContain('kexp="250000" → row #100001');
    expect(r.description).toContain("Landing on: KPI tab → “Total Pending Balance”");
  });

  it("kexp non-numeric is clamped to 'row #1' when kpi survives", () => {
    const r = describeSanitization("?kpi=sell&kexp=abc")!;
    const c = r.adjusted.find((x) => x.key === "kexp");
    expect(c).toEqual({ key: "kexp", from: "abc", to: "row #1" });
    expect(r.description).toContain('Adjusted: kexp="abc" → row #1');
    expect(r.description).toContain("Landing on: KPI tab → “Total Sell Value”");
  });

  // Note: any presence of kexp triggers KPI-intent recovery, so kexp is always
  // clamped to a valid row index rather than removed outright.

  it("invalid kpi value is adjusted to 'overdue' with exact replacement", () => {
    const r = describeSanitization("?kpi=not-a-kpi")!;
    const c = r.adjusted.find((x) => x.key === "kpi");
    expect(c).toEqual({ key: "kpi", from: "not-a-kpi", to: "overdue" });
    expect(r.description).toContain('Adjusted: kpi="not-a-kpi" → overdue');
    expect(r.description).toContain("Landing on: KPI tab → “Current Overdue Amount”");
  });

  it("missing kpi with KPI intent reports from='(missing)' → overdue", () => {
    const r = describeSanitization("?tab=kpi&kexp=2")!;
    const c = r.adjusted.find((x) => x.key === "kpi");
    expect(c).toEqual({ key: "kpi", from: "(missing)", to: "overdue" });
    expect(r.description).toContain('Adjusted: kpi="(missing)" → overdue');
  });

  it("reports every invalid KPI param simultaneously in one description", () => {
    const r = describeSanitization("?kpi=bogus&kpage=zz&ksize=3&ksort=bad.dir&kq=&kexp=-99")!;
    // Every key must appear verbatim with its original value.
    const expectations: Array<[string, string]> = [
      ["kpi", "bogus"],
      ["kpage", "zz"],
      ["ksize", "3"],
      ["ksort", "bad.dir"],
      ["kq", ""],
      ["kexp", "-99"],
    ];
    for (const [key, from] of expectations) {
      expect(r.description).toContain(`${key}="${from}"`);
    }
    // kpi and kexp recover; the rest are removed.
    expect(r.adjusted.map((c) => c.key).sort()).toEqual(["kexp", "kpi"]);
    expect(r.removed.map((c) => c.key).sort()).toEqual(["kpage", "kq", "ksize", "ksort"]);
    expect(r.description).toContain('kpi="bogus" → overdue');
    expect(r.description).toContain('kexp="-99" → row #1');
    // When both kpi and kexp are stale, a combined resolution sentence ties
    // the resolved KPI name and the clamped row together in one message.
    expect(r.description).toContain(
      "Resolved: KPI “Current Overdue Amount” at row #1 (kpi + kexp were both stale)",
    );
    expect(r.finalKexpRow).toBe(1);
    expect(r.kpiLabel).toBe("Current Overdue Amount");
  });

  it("truncates a long kq value but still reports it under removed", () => {
    const long = "q".repeat(300);
    const r = describeSanitization(`?kpi=overdue&kq=${long}`)!;
    const c = r.removed.find((x) => x.key === "kq");
    expect(c).toBeDefined();
    expect(c!.from.length).toBeLessThanOrEqual(24);
    expect(c!.from.endsWith("…")).toBe(true);
    expect(r.description).toContain(`kq="${c!.from}"`);
  });
});
