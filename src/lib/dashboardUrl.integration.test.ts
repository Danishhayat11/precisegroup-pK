/**
 * Integration tests for the Dashboard URL sanitizer.
 *
 * Focus: stale/invalid `kpi` and `kexp` deep-links must always land on a
 * sensible default and surface the correct user-facing message. These tests
 * exercise the same code paths as the runtime sanitizer in
 * `src/pages/Dashboard.tsx`, plus a small adapter that mirrors how the
 * dashboard composes the toast description from the sanitizer output.
 */
import { describe, expect, it } from "vitest";
import {
  readKpi,
  readKpiSort,
  readPage,
  readPageSize,
  readTab,
  sanitizeDashboardSearch,
} from "./dashboardUrl";

/** Mirror of the dashboard's toast formatter (kept in sync with Dashboard.tsx). */
function buildResetMessage(stripped: string[]): {
  title: string;
  description: string;
} | null {
  if (stripped.length === 0) return null;
  return {
    title: "Some link parameters were invalid",
    description: `Reset to safe defaults: ${stripped.join(", ")}.`,
  };
}

/** Apply sanitizer and read effective values, as the page does on mount. */
function landingState(rawSearch: string) {
  const { search, changed, stripped } = sanitizeDashboardSearch(rawSearch);
  return {
    search,
    changed,
    stripped,
    message: buildResetMessage(stripped),
    tab: readTab(search),
    kpi: readKpi(search),
    ksort: readKpiSort(search),
    ksize: readPageSize(search, "ksize"),
    kpage: readPage(search, "kpage"),
  };
}

describe("Dashboard URL sanitizer — stale kpi links", () => {
  it("unknown kpi value alone falls back to overdue and reports kpi reset", () => {
    const s = landingState("kpi=ghost_metric");
    expect(s.kpi).toBe("overdue");
    expect(s.tab).toBe("kpi");
    expect(s.stripped).toContain("kpi");
    expect(s.message?.description).toMatch(/kpi/);
  });

  it("missing kpi but tab=kpi recovers to kpi=overdue", () => {
    const s = landingState("tab=kpi");
    expect(s.kpi).toBe("overdue");
    expect(s.tab).toBe("kpi");
    expect(s.stripped).toContain("kpi");
  });

  it("missing kpi but valid sub-params recovers to kpi=overdue and keeps subs", () => {
    const s = landingState("ksize=50&kpage=3");
    expect(s.kpi).toBe("overdue");
    expect(s.tab).toBe("kpi");
    expect(s.ksize).toBe(50);
    expect(s.kpage).toBe(3);
    expect(s.stripped).toEqual(["kpi"]);
  });

  it("invalid kpi but valid sub-params: subs survive, kpi defaults", () => {
    const s = landingState("kpi=zzz&ksort=2.desc&ksize=25");
    expect(s.kpi).toBe("overdue");
    expect(s.ksort).toEqual({ idx: 2, dir: "desc" });
    expect(s.ksize).toBe(25);
    expect(s.stripped).toContain("kpi");
  });

  it("no kpi intent at all: empty string stays empty, no message", () => {
    const s = landingState("");
    expect(s.kpi).toBeNull();
    expect(s.tab).toBe("overdue");
    expect(s.changed).toBe(false);
    expect(s.message).toBeNull();
  });

  it("valid kpi without tab is synced to tab=kpi without raising a message", () => {
    const s = landingState("kpi=cash");
    expect(s.kpi).toBe("cash");
    expect(s.tab).toBe("kpi");
    expect(s.changed).toBe(false);
    expect(s.message).toBeNull();
  });
});

describe("Dashboard URL sanitizer — stale kexp links", () => {
  it("non-numeric kexp is stripped, kpi survives", () => {
    const s = landingState("kpi=overdue&kexp=abc");
    expect(s.kpi).toBe("overdue");
    expect(new URLSearchParams(s.search).has("kexp")).toBe(false);
    expect(s.stripped).toContain("kexp");
    expect(s.message?.description).toMatch(/kexp/);
  });

  it("negative kexp is stripped", () => {
    const s = landingState("kpi=pending&kexp=-3");
    expect(s.kpi).toBe("pending");
    expect(s.stripped).toContain("kexp");
  });

  it("out-of-bounds kexp (> 100000) is stripped", () => {
    const s = landingState("kpi=overdue&kexp=999999");
    expect(s.stripped).toContain("kexp");
    expect(new URLSearchParams(s.search).has("kexp")).toBe(false);
  });

  it("invalid kexp with no kpi: kpi recovers to overdue and kexp is stripped", () => {
    const s = landingState("kexp=oops");
    expect(s.kpi).toBe("overdue");
    expect(s.stripped).toEqual(expect.arrayContaining(["kexp", "kpi"]));
    expect(new URLSearchParams(s.search).has("kexp")).toBe(false);
  });

  it("kexp=0 is accepted (boundary)", () => {
    const s = landingState("kpi=overdue&kexp=0");
    expect(s.changed).toBe(false);
    expect(new URLSearchParams(s.search).get("kexp")).toBe("0");
  });

  it("kexp=100000 is accepted (boundary)", () => {
    const s = landingState("kpi=overdue&kexp=100000");
    expect(s.changed).toBe(false);
  });
});

describe("Dashboard URL sanitizer — combined stale links", () => {
  it("invalid kpi + invalid kexp + invalid kpage all reset, message lists each", () => {
    const s = landingState("kpi=junk&kexp=NaN&kpage=-1&ksize=25");
    expect(s.kpi).toBe("overdue");
    expect(s.ksize).toBe(25); // valid sub-param survives
    expect(s.stripped).toEqual(expect.arrayContaining(["kpi", "kexp", "kpage"]));
    const desc = s.message!.description;
    for (const key of ["kpi", "kexp", "kpage"]) {
      expect(desc).toContain(key);
    }
  });

  it("all invalid KPI params + invalid tab still recover the sheet to kpi=overdue", () => {
    // Presence of kpi/sub-params (even empty) signals intent → safe default wins.
    const s = landingState("tab=banana&kpi=&kexp=&kpage=&ksize=&ksort=");
    expect(s.tab).toBe("kpi");
    expect(s.kpi).toBe("overdue");
    expect(s.message).not.toBeNull();
  });

  it("stripped list is deduped (sanitizer never reports the same key twice)", () => {
    const s = landingState("kpi=bad&kexp=bad&kpage=bad");
    const unique = new Set(s.stripped);
    expect(unique.size).toBe(s.stripped.length);
  });
});
