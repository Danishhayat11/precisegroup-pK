/**
 * Visual regression: pixel-diffs the first fitted `.pp-sheet` across
 * the zoom/DPR matrix from print-modal-zoom-dpi.spec.ts. The numeric
 * specs prove the sheet fits (visibleRatio ≥ 0.5, chip count matches
 * DOM), but they don't catch *layout shifts inside the sheet* — a
 * header that jumped 4px, a row that wrapped early under 125% zoom,
 * a logo that mis-scaled at DPR=3.
 *
 * Approach:
 *   - Per case, screenshot only the first `.pp-sheet` element (not
 *     the whole viewport) so container chrome / scrollbar changes
 *     don't dominate the diff.
 *   - `scale: 'css'` (playwright.config default) normalizes the raster
 *     to CSS pixels, so a DPR=3 case still produces a same-sized
 *     baseline as DPR=1. The layout inside is what we're comparing.
 *   - Tolerance is intentionally loose:
 *       maxDiffPixelRatio 0.02  — 2% pixel budget for sub-pixel AA
 *                                 and font-hinting jitter across
 *                                 Playwright / OS patch versions
 *       threshold 0.25          — per-pixel color-distance tolerance
 *                                 so text sub-pixel anti-aliasing
 *                                 doesn't count as a diff, while a
 *                                 shifted layout still trips the
 *                                 pixel-ratio budget.
 *   - Each case writes to its own snapshot name so the baselines are
 *     independent — Chromium/Firefox/WebKit each get their own set
 *     via the project name suffix Playwright appends automatically.
 *
 * Baselines:
 *   - Regenerate with:
 *       bunx playwright test tests/a11y/print-modal-zoom-dpi-visual.spec.ts \
 *         --project=chromium-reduced-motion --update-snapshots
 *   - Commit the .png files under
 *       tests/a11y/print-modal-zoom-dpi-visual.spec.ts-snapshots/
 *
 * Run:  bunx playwright test tests/a11y/print-modal-zoom-dpi-visual.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

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

// Tolerance shared by every visual assertion in this spec. See header
// comment for why these values are picked.
const VISUAL_OPTS = {
  maxDiffPixelRatio: 0.02,
  threshold: 0.25,
  animations: "disabled" as const,
  caret: "hide" as const,
  scale: "css" as const,
};

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
  // Let ResizeObserver settle so the raster is stable.
  await page.waitForTimeout(400);
}

/**
 * Scroll a specific .pp-sheet into the viewport of its scroll container
 * before capturing. Without this, sheets past the first fold render at
 * DOM but not on screen — `toHaveScreenshot` on an off-screen element
 * captures its rasterized layer, but IntersectionObserver-gated content
 * (letterhead images, deferred logos) may not have painted yet.
 */
async function bringSheetIntoView(page: Page, index: number) {
  await page.evaluate((i: number) => {
    const sheet = document.querySelectorAll<HTMLElement>(".pp-sheet")[i];
    if (!sheet) return;
    sheet.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
  }, index);
  // Let scroll-driven layout / lazy-loaded letterhead assets settle.
  await page.waitForTimeout(300);
}

for (const c of CASES) {
  const contextViewport = {
    viewport: MOBILE_VIEWPORT,
    colorScheme: "light" as const,
    reducedMotion: "reduce" as const,
    ...(c.kind === "dpr" ? { deviceScaleFactor: c.dpr } : {}),
  };

  test.describe(`PrintPreviewModal — visual diff of every fitted sheet (${c.label})`, () => {
    test.use(contextViewport);

    test("short receipt: single sheet raster matches baseline", async ({ page }) => {
      await openWithCase(page, "short-receipt", c);
      const count = await page.locator(".pp-sheet").count();
      expect(count, `[${c.label}] short receipt should render exactly 1 page`).toBe(1);
      const sheet = page.locator(".pp-sheet").first();
      await expect(sheet).toHaveScreenshot(`short-receipt-${c.slug}-page-1.png`, VISUAL_OPTS);
    });

    test("long receipt: every rendered .pp-sheet raster matches its baseline", async ({ page }) => {
      await openWithCase(page, "long-receipt", c);
      const sheets = page.locator(".pp-sheet");
      const count = await sheets.count();
      expect(
        count,
        `[${c.label}] long-receipt should paginate into ≥ 2 pages before visual diff, got ${count}`,
      ).toBeGreaterThanOrEqual(2);

      // Diff every sheet — including the last, which is where trailing
      // overflow content (totals, signatures, page footers) tends to
      // clip or mis-align first when the fit math regresses.
      for (let i = 0; i < count; i += 1) {
        await bringSheetIntoView(page, i);
        const sheet = sheets.nth(i);
        await expect(
          sheet,
          `[${c.label}] sheet #${i + 1} of ${count} raster mismatch`,
        ).toHaveScreenshot(`long-receipt-${c.slug}-page-${i + 1}-of-${count}.png`, VISUAL_OPTS);
      }
    });
  });
}
