/**
 * Accessibility regression: runs axe-core against the open
 * <PrintPreviewModal> across the same zoom/DPR matrix as the visual
 * spec. The visual spec catches raster drift; this spec catches
 * missing ARIA / role / name / contrast regressions on the modal
 * chrome and rendered sheets under every DPI/zoom.
 *
 * Why a separate spec:
 *   The visual spec's per-sheet screenshot loop already runs 30+
 *   assertions per case. Interleaving an axe scan into that loop
 *   would mask which axis regressed. This spec runs exactly one axe
 *   pass per (case × document), scoped to the dialog subtree, and
 *   asserts zero violations after applying the shared
 *   `KNOWN_FALSE_POSITIVES` filter from `_helpers/axeConfig`.
 *
 * Why per (zoom, DPR):
 *   `color-contrast` is measured against rendered pixels — a zoom
 *   level that shifts a badge onto a lighter surface, or a hi-DPI
 *   raster that thins a stroke, can flip a previously-passing
 *   contrast check. Rule surface is `ENFORCED_RULES` from the shared
 *   helper (WCAG A/AA labels + structure + focus + contrast).
 *
 * Scope:
 *   Every scan is scoped to `[role="dialog"]` so unrelated page
 *   chrome (test harness route, Toaster portal) doesn't dilute the
 *   signal. If PrintPreviewModal's root ever stops being a Radix
 *   Dialog, update the include selector here.
 *
 * Run:  bunx playwright test tests/a11y/print-modal-zoom-dpi-axe.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { buildAxe, filterKnownFalsePositives } from "./_helpers/axeConfig";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const MOBILE_VIEWPORT = { width: 390, height: 844 };

type ZoomCase = { kind: "zoom"; slug: string; label: string; cssZoom: number };
type DprCase = { kind: "dpr"; slug: string; label: string; dpr: number };
type Case = ZoomCase | DprCase;

const CASES: readonly Case[] = [
  { kind: "zoom", slug: "zoom-090", label: "browser zoom 90%", cssZoom: 0.9 },
  { kind: "zoom", slug: "zoom-125", label: "browser zoom 125%", cssZoom: 1.25 },
  { kind: "dpr", slug: "dpr-2", label: "devicePixelRatio 2 (Retina)", dpr: 2 },
  { kind: "dpr", slug: "dpr-3", label: "devicePixelRatio 3 (hi-DPI phone)", dpr: 3 },
] as const;

async function openWithCase(page: Page, doc: string, c: Case) {
  await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

  if (c.kind === "zoom") {
    await page.evaluate((z: number) => {
      (document.documentElement.style as unknown as { zoom: string }).zoom = String(z);
    }, c.cssZoom);
  }

  await page.getByTestId("open-modal").click();
  await expect(page.locator(".pp-sheet").first()).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /Ready/ }).first(),
  ).toBeVisible({ timeout: 8_000 });
  // Let ResizeObserver settle so contrast is measured against the
  // final rendered pixels, not the mid-fit transient.
  await page.waitForTimeout(400);
}

async function assertNoAxeViolations(page: Page, label: string) {
  const raw = await buildAxe(page, { include: '[role="dialog"]' }).analyze();
  const { violations, suppressed } = filterKnownFalsePositives(raw.violations);

  if (Object.keys(suppressed).length > 0) {
    // Visibility only — the filter already removed these nodes.
    console.info(`[${label}] axe suppressed nodes:`, suppressed);
  }

  if (violations.length > 0) {
    // Compact, single-line-per-violation message so CI logs stay
    // readable across a matrix of failures. Detailed HTML lives in
    // the trace artifact.
    const summary = violations
      .map((v) => `${v.id} (${v.impact ?? "impact:?"}) × ${v.nodes.length} — ${v.help}`)
      .join("\n");
    throw new Error(`[${label}] axe found ${violations.length} violation(s):\n${summary}`);
  }
}

for (const c of CASES) {
  const contextViewport = {
    viewport: MOBILE_VIEWPORT,
    colorScheme: "light" as const,
    reducedMotion: "reduce" as const,
    ...(c.kind === "dpr" ? { deviceScaleFactor: c.dpr } : {}),
  };

  test.describe(`PrintPreviewModal — axe scan (${c.label})`, () => {
    test.use(contextViewport);

    test("short receipt: no WCAG A/AA violations inside the dialog", async ({ page }) => {
      await openWithCase(page, "short-receipt", c);
      await assertNoAxeViolations(page, `short-receipt / ${c.label}`);
    });

    test("long receipt: no WCAG A/AA violations across paginated sheets", async ({ page }) => {
      await openWithCase(page, "long-receipt", c);
      // Sanity: axe should scan a paginated document, not a fallback
      // single-page render — otherwise this test doesn't cover the
      // per-page footer / page-number chrome the user actually sees.
      const sheetCount = await page.locator(".pp-sheet").count();
      expect(
        sheetCount,
        `[${c.label}] long-receipt should paginate into ≥ 2 pages before axe scan, got ${sheetCount}`,
      ).toBeGreaterThanOrEqual(2);
      await assertNoAxeViolations(page, `long-receipt / ${c.label}`);
    });
  });
}
