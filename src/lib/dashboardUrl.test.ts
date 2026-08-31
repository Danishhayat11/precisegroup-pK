import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  readAge,
  readKpi,
  readKpiSort,
  readOverdueSort,
  readPage,
  readPageSize,
  readRisk,
  readTab,
  sanitizeDashboardSearch,
} from "./dashboardUrl";

describe("sanitizeDashboardSearch", () => {
  it("keeps valid params untouched", () => {
    const input =
      "risk=HIGH&age=31-60&kpi=overdue&osort=_amt.desc&osize=50&opage=2&ksort=3.asc&ksize=25&kpage=1&preset=Top&oexp=B-1&kexp=4";
    const { search, changed } = sanitizeDashboardSearch(input);
    expect(changed).toBe(false);
    // Order is preserved
    expect(new URLSearchParams(search).get("risk")).toBe("HIGH");
    expect(new URLSearchParams(search).get("kexp")).toBe("4");
  });

  it("strips unknown values from known keys", () => {
    // `kpi=nope` signals KPI intent → recovers to `kpi=overdue` instead of dropping it.
    const { search, changed } = sanitizeDashboardSearch(
      "risk=BANANA&age=ALL&osize=7&opage=-1&kpi=nope",
    );
    expect(changed).toBe(true);
    const sp = new URLSearchParams(search);
    expect(sp.has("risk")).toBe(false);
    expect(sp.has("osize")).toBe(false);
    expect(sp.has("opage")).toBe(false);
    expect(sp.get("kpi")).toBe("overdue");
    expect(sp.get("age")).toBe("ALL");
  });

  it("recovers kpi=overdue and preserves valid sub-params when kpi is missing", () => {
    // Updated behavior: valid sub-params signal the user wants the KPI sheet,
    // so we recover with the safe default instead of dropping everything.
    const { search, changed, stripped } = sanitizeDashboardSearch(
      "ksort=2.asc&ksize=50&kpage=3&kexp=4",
    );
    expect(changed).toBe(true);
    const sp = new URLSearchParams(search);
    expect(sp.get("kpi")).toBe("overdue");
    for (const k of ["ksort", "ksize", "kpage", "kexp"]) expect(sp.get(k)).toBeTruthy();
    expect(stripped).toContain("kpi");
  });

  it("recovers kpi=overdue when sub-params are all invalid but signal KPI intent", () => {
    // Presence of any KPI sub-param signals intent; recover with safe default
    // and strip the invalid sub-values.
    const { search, changed } = sanitizeDashboardSearch("ksort=bad&ksize=7&kpage=-1&kexp=-9");
    expect(changed).toBe(true);
    const sp = new URLSearchParams(search);
    expect(sp.get("kpi")).toBe("overdue");
    for (const k of ["ksort", "ksize", "kpage", "kexp"]) expect(sp.has(k)).toBe(false);
  });

  it("keeps KPI-dependent params when kpi is valid", () => {
    const { search } = sanitizeDashboardSearch("kpi=pending&ksort=1.desc&ksize=10&kpage=4&kexp=0");
    const sp = new URLSearchParams(search);
    expect(sp.get("kpi")).toBe("pending");
    expect(sp.get("ksort")).toBe("1.desc");
    expect(sp.get("kexp")).toBe("0");
  });

  it("rejects malformed sort tokens", () => {
    const { search } = sanitizeDashboardSearch(
      "kpi=sell&osort=client_name.sideways&ksort=abc.desc",
    );
    const sp = new URLSearchParams(search);
    expect(sp.has("osort")).toBe(false);
    expect(sp.has("ksort")).toBe(false);
  });

  it("enforces preset length cap (64 chars)", () => {
    const longName = "x".repeat(65);
    const { search } = sanitizeDashboardSearch(`preset=${longName}`);
    expect(new URLSearchParams(search).has("preset")).toBe(false);

    const ok = sanitizeDashboardSearch(`preset=${"x".repeat(64)}`);
    expect(new URLSearchParams(ok.search).has("preset")).toBe(true);
  });

  it("rejects non-integer / negative kexp", () => {
    expect(
      new URLSearchParams(sanitizeDashboardSearch("kpi=sell&kexp=-1").search).has("kexp"),
    ).toBe(false);
    expect(
      new URLSearchParams(sanitizeDashboardSearch("kpi=sell&kexp=1.5").search).has("kexp"),
    ).toBe(false);
    expect(
      new URLSearchParams(sanitizeDashboardSearch("kpi=sell&kexp=abc").search).has("kexp"),
    ).toBe(false);
    expect(new URLSearchParams(sanitizeDashboardSearch("kpi=sell&kexp=0").search).get("kexp")).toBe(
      "0",
    );
  });

  it("ignores completely unknown keys (passes them through unchanged)", () => {
    const { search, changed } = sanitizeDashboardSearch("foo=bar&risk=HIGH");
    expect(changed).toBe(false);
    expect(new URLSearchParams(search).get("foo")).toBe("bar");
  });
});

describe("readers with fallback defaults", () => {
  it("readRisk falls back to ALL", () => {
    expect(readRisk("")).toBe(DEFAULTS.risk);
    expect(readRisk("risk=BAD")).toBe(DEFAULTS.risk);
    expect(readRisk("risk=HIGH")).toBe("HIGH");
  });

  it("readAge falls back to ALL", () => {
    expect(readAge("")).toBe(DEFAULTS.age);
    expect(readAge("age=999d")).toBe(DEFAULTS.age);
    expect(readAge("age=61-90")).toBe("61-90");
  });

  it("readKpi returns null for unknown", () => {
    expect(readKpi("")).toBeNull();
    expect(readKpi("kpi=xxx")).toBeNull();
    expect(readKpi("kpi=cash")).toBe("cash");
  });

  it("readOverdueSort returns default when missing/invalid", () => {
    expect(readOverdueSort("")).toEqual(DEFAULTS.overdueSort);
    expect(readOverdueSort("osort=junk")).toEqual(DEFAULTS.overdueSort);
    expect(readOverdueSort("osort=client_name.asc")).toEqual({
      key: "client_name",
      dir: "asc",
    });
  });

  it("readPageSize accepts only 10/25/50/100", () => {
    expect(readPageSize("", "osize")).toBe(25);
    expect(readPageSize("osize=7", "osize")).toBe(25);
    expect(readPageSize("ksize=50", "ksize")).toBe(50);
  });

  it("readPage accepts positive integers", () => {
    expect(readPage("", "opage")).toBe(1);
    expect(readPage("opage=0", "opage")).toBe(1);
    expect(readPage("opage=-2", "opage")).toBe(1);
    expect(readPage("kpage=3", "kpage")).toBe(3);
  });

  it("readKpiSort parses idx.dir", () => {
    expect(readKpiSort("")).toBeNull();
    expect(readKpiSort("ksort=bad")).toBeNull();
    expect(readKpiSort("ksort=2.desc")).toEqual({ idx: 2, dir: "desc" });
  });
});

describe("tab + kpi fallback redirects", () => {
  it("readTab falls back to 'overdue' when missing", () => {
    expect(readTab("")).toBe("overdue");
    expect(readTab("tab=garbage")).toBe("overdue");
    expect(readTab("tab=kpi")).toBe("kpi");
    expect(readTab("tab=overdue")).toBe("overdue");
  });

  it("strips invalid tab values", () => {
    const { search, changed, stripped } = sanitizeDashboardSearch("tab=banana");
    expect(changed).toBe(true);
    expect(stripped).toContain("tab");
    expect(new URLSearchParams(search).has("tab")).toBe(false);
  });

  it("redirects tab=kpi without kpi to the safest default (kpi=overdue)", () => {
    const { search, changed, stripped } = sanitizeDashboardSearch("tab=kpi");
    expect(changed).toBe(true);
    const sp = new URLSearchParams(search);
    expect(sp.get("tab")).toBe("kpi");
    expect(sp.get("kpi")).toBe("overdue");
    expect(stripped).toContain("kpi");
  });

  it("redirects tab=kpi with an invalid kpi to kpi=overdue", () => {
    const { search, changed, stripped } = sanitizeDashboardSearch("tab=kpi&kpi=nope");
    expect(changed).toBe(true);
    const sp = new URLSearchParams(search);
    expect(sp.get("tab")).toBe("kpi");
    expect(sp.get("kpi")).toBe("overdue");
    // Both the invalid kpi removal and the fallback insertion are reported
    expect(stripped).toContain("kpi");
  });

  it("does not invent a kpi when tab is 'overdue'", () => {
    const { search, changed } = sanitizeDashboardSearch("tab=overdue");
    expect(changed).toBe(false);
    expect(new URLSearchParams(search).has("kpi")).toBe(false);
  });

  it("returns a deduped, ordered list of stripped keys for the toast", () => {
    const { stripped } = sanitizeDashboardSearch("risk=BANANA&age=YEARS&kpi=nope&osize=7&tab=kpi");
    // Deduped
    expect(new Set(stripped).size).toBe(stripped.length);
    // All offenders included
    for (const k of ["risk", "age", "kpi", "osize"]) expect(stripped).toContain(k);
  });

  it("keeps a valid tab+kpi combo untouched", () => {
    const { search, changed, stripped } = sanitizeDashboardSearch("tab=kpi&kpi=pending");
    expect(changed).toBe(false);
    expect(stripped).toEqual([]);
    const sp = new URLSearchParams(search);
    expect(sp.get("tab")).toBe("kpi");
    expect(sp.get("kpi")).toBe("pending");
  });
});

describe("partial KPI param recovery", () => {
  it("keeps valid sub-params when only kpage/ksort are invalid", () => {
    const { search, stripped } = sanitizeDashboardSearch(
      "kpi=pending&ksort=banana&kpage=-9&ksize=50&kq=adil",
    );
    const sp = new URLSearchParams(search);
    expect(sp.get("kpi")).toBe("pending");
    expect(sp.get("ksize")).toBe("50");
    expect(sp.get("kq")).toBe("adil");
    expect(sp.has("ksort")).toBe(false);
    expect(sp.has("kpage")).toBe(false);
    expect(stripped).toEqual(expect.arrayContaining(["ksort", "kpage"]));
  });

  it("recovers to kpi=overdue and preserves valid sub-params when only kpi is invalid", () => {
    const { search, stripped } = sanitizeDashboardSearch("kpi=nope&ksize=50&kpage=3&kq=khan");
    const sp = new URLSearchParams(search);
    expect(sp.get("kpi")).toBe("overdue");
    expect(sp.get("ksize")).toBe("50");
    expect(sp.get("kpage")).toBe("3");
    expect(sp.get("kq")).toBe("khan");
    expect(stripped).toContain("kpi");
  });

  it("syncs tab=kpi when a valid kpi is present without an explicit tab", () => {
    const { search } = sanitizeDashboardSearch("kpi=cash&ksize=25");
    const sp = new URLSearchParams(search);
    expect(sp.get("tab")).toBe("kpi");
    expect(sp.get("kpi")).toBe("cash");
  });

  it("recovers kpi=overdue when kpi value is bogus, dropping invalid sub-params", () => {
    const { search } = sanitizeDashboardSearch("kpi=bogus&ksort=junk&kpage=-1");
    const sp = new URLSearchParams(search);
    expect(sp.get("kpi")).toBe("overdue");
    expect(sp.has("ksort")).toBe(false);
    expect(sp.has("kpage")).toBe(false);
  });
});
