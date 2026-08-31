/**
 * Unit tests — the dashboard's info live region must use role="alert" with
 * aria-live="assertive" and announce the correct message for invalid params.
 *
 * Two layers:
 *   1) Source-level: assert the JSX in src/pages/Dashboard.tsx renders the
 *      assertive live region with the required ARIA attributes, mounted
 *      unconditionally so AT reliably observes content updates.
 *   2) Behaviour-level: drive describeSanitization() with invalid query
 *      strings and verify the exact message text that feeds the live region.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeSanitization } from "@/lib/dashboardUrl";

const DASHBOARD_SRC = readFileSync(join(process.cwd(), "src/pages/Dashboard.tsx"), "utf8");

// 1) Markup contract ---------------------------------------------------

describe("Dashboard live region — ARIA contract", () => {
  it('mounts an assertive role="alert" region with aria-live="assertive"', () => {
    // Regression guard: dropping either attribute silences screen-reader
    // announcements when stale URL params are corrected.
    expect(DASHBOARD_SRC).toMatch(/role="alert"\s+aria-live="assertive"\s+aria-atomic="true"/);
  });

  it("renders the assertive region unconditionally (content is conditional, region is not)", () => {
    // AT only reliably announces additions to a region that was already
    // mounted, so the <div role="alert"> itself must not sit behind a
    // {condition && ...} guard.
    const alertIdx = DASHBOARD_SRC.indexOf('role="alert"');
    expect(alertIdx).toBeGreaterThan(-1);
    const snippet = DASHBOARD_SRC.slice(alertIdx, alertIdx + 400);
    expect(snippet).toMatch(/className="sr-only"\s*>\s*\{\s*resetParams\.length\s*>\s*0/);
  });

  it("also exposes a polite role=status mirror for AT that ignores alerts", () => {
    expect(DASHBOARD_SRC).toMatch(/role="status"\s+aria-live="polite"\s+aria-atomic="true"/);
    expect(DASHBOARD_SRC).toContain('data-testid="url-sanitizer-status"');
  });
});

// 2) Message content for invalid params --------------------------------

describe("Dashboard live region — message content from describeSanitization", () => {
  it("returns null when nothing was invalid", () => {
    expect(describeSanitization("")).toBeNull();
    expect(describeSanitization("?tab=overdue")).toBeNull();
  });

  it("announces a removed param with its original value", () => {
    const r = describeSanitization("?risk=BANANA");
    expect(r).not.toBeNull();
    expect(r!.description).toContain('Invalid (removed): risk="BANANA"');
    expect(r!.removed.map((c) => c.key)).toContain("risk");
  });

  it("announces an adjusted kpi with original → replacement and landing line", () => {
    const r = describeSanitization("?tab=kpi&kpi=ghost");
    expect(r).not.toBeNull();
    expect(r!.description).toContain('Adjusted: kpi="ghost" → overdue');
    expect(r!.description).toContain("Landing on: KPI tab → “Current Overdue Amount”");
    expect(r!.finalTab).toBe("kpi");
    expect(r!.finalKpi).toBe("overdue");
  });

  it("uses the combined Resolved sentence when kpi + kexp are both stale", () => {
    const r = describeSanitization("?tab=kpi&kpi=ghost&kexp=-1");
    expect(r).not.toBeNull();
    expect(r!.description).toContain(
      "Resolved: KPI “Current Overdue Amount” at row #1 (kpi + kexp were both stale)",
    );
    // Combined branch must suppress the plain landing form.
    expect(r!.description).not.toMatch(/Landing on: KPI tab →/);
    expect(r!.finalKexpRow).toBe(1);
  });

  it("clamps kexp above the max and reflects the row in the message", () => {
    const r = describeSanitization("?tab=kpi&kpi=overdue&kexp=99999999");
    expect(r).not.toBeNull();
    expect(r!.description).toContain('Adjusted: kexp="99999999" → row #100001');
    // kpi was valid, so the combined sentence must NOT appear.
    expect(r!.description).not.toMatch(/kpi \+ kexp were both stale/);
  });

  it("handles multiple invalid params in a single announcement", () => {
    const r = describeSanitization("?risk=BANANA&age=999&tab=kpi&kpi=ghost&kexp=abc");
    expect(r).not.toBeNull();
    const desc = r!.description;
    expect(desc).toContain('Invalid (removed): risk="BANANA"');
    expect(desc).toContain('age="999"');
    expect(desc).toContain('Adjusted: kpi="ghost" → overdue');
    expect(desc).toContain('kexp="abc" → row #1');
    expect(desc).toContain(
      "Resolved: KPI “Current Overdue Amount” at row #1 (kpi + kexp were both stale)",
    );
  });

  it("exposes a stable title for the toast/live region", () => {
    const r = describeSanitization("?risk=BANANA");
    expect(r!.title).toBe("Some link parameters were invalid");
  });
});
