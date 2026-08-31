/**
 * Regression guard: each above-the-fold KPI card must be declared exactly
 * once on the /dashboard route.
 *
 * Rendering the real Dashboard route in a unit test pulls in Supabase,
 * TanStack Router, and every drill-down — orders of magnitude more setup
 * than this check needs. Instead we assert the source of truth directly:
 *
 *   1. Each canonical KPI label appears exactly ONCE in the KPI array in
 *      `src/pages/Dashboard.tsx` (matches both `label: "…"` object-literal
 *      style and `label="…"` JSX-prop style so future refactors that swap
 *      the tile from a data-driven map to explicit JSX still trip the
 *      dedupe check).
 *   2. `src/components/DashboardHero.tsx` must not mention any of them —
 *      the hero is deliberately KPI-free; any re-introduction there would
 *      duplicate the metric above the fold.
 *   3. `src/components/DashboardBrief.tsx` MUST NOT exist — that overlay
 *      was the historical source of duplicated KPI cards (Overdue Amount,
 *      Cash / Bank Received, etc.). Re-adding it re-introduces the bug.
 *
 * If any invariant breaks, a duplicate KPI card was re-introduced and
 * the dedupe from the "audit every component being rendered" work is
 * regressing.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The eight KPIs the user signed off on for the /dashboard grid. Order
 * mirrors the `kpis` array in Dashboard.tsx so a reviewer diffing this
 * file against the render list can eyeball them 1:1.
 */
const KPI_LABELS = [
  "Total Sell Value",
  "Cash Recovered",
  "Total Adjustment Approved",
  "Total Adjustment Realised",
  "Commission Paid",
  "Total Received",
  "Total Pending Balance",
  "Current Overdue Amount",
] as const;

const dashboardSrc = readFileSync(resolve(__dirname, "../Dashboard.tsx"), "utf8");
const heroSrc = readFileSync(resolve(__dirname, "../../components/DashboardHero.tsx"), "utf8");
const briefPath = resolve(__dirname, "../../components/DashboardBrief.tsx");

/** Count `label: "X"` (object-literal) + `label="X"` (JSX prop) occurrences. */
function countLabelDeclarations(src: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`label\\s*[:=]\\s*["']${escaped}["']`, "g");
  return src.match(re)?.length ?? 0;
}

describe("Dashboard KPI cards render exactly once above the fold", () => {
  it("does not resurrect the deleted DashboardBrief overlay", () => {
    // DashboardBrief was the original source of duplicated overdue /
    // cash / balance cards. It must stay deleted; if this file reappears
    // the dedupe regressed.
    expect(existsSync(briefPath), "DashboardBrief.tsx must remain deleted").toBe(false);
    // …and no live code reference to it. Match `<DashboardBrief` (JSX
    // usage) or `import ... DashboardBrief` — inline comments explaining
    // why the overlay was removed are allowed.
    expect(dashboardSrc).not.toMatch(/<DashboardBrief\b/);
    expect(dashboardSrc).not.toMatch(/\bimport\s[^;]*\bDashboardBrief\b/);
  });

  it.each(KPI_LABELS)(
    "declares '%s' exactly once in Dashboard.tsx (the only KPI-card surface)",
    (label) => {
      expect(countLabelDeclarations(dashboardSrc, label)).toBe(1);
    },
  );

  it.each(KPI_LABELS)("does not re-declare '%s' inside DashboardHero.tsx", (label) => {
    expect(heroSrc.includes(label)).toBe(false);
  });

  it("no stray 'Overdue Amount' KPI card slipped back in", () => {
    // Direct string search for the historically duplicated card labels
    // that were carried by DashboardBrief. `Current Overdue Amount` is
    // the single sanctioned KPI; the shortened `Overdue Amount` form
    // and `Overdue Installments Count` were the brief-era duplicates.
    // We tolerate `Overdue Amount` inside CSV export column headers
    // (e.g. `"Overdue Amount (PKR)"`), but ban a bare `label: "Overdue
    // Amount"` / `label="Overdue Amount"` KPI declaration.
    expect(countLabelDeclarations(dashboardSrc, "Overdue Amount")).toBe(0);
    expect(countLabelDeclarations(dashboardSrc, "Overdue Installments Count")).toBe(0);
    expect(countLabelDeclarations(dashboardSrc, "Gross Contract Value")).toBe(0);
    expect(countLabelDeclarations(dashboardSrc, "Cash / Bank Received")).toBe(0);
    expect(countLabelDeclarations(dashboardSrc, "Client Balance")).toBe(0);
  });
});
