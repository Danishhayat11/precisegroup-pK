/**
 * End-to-end regression: <PrintPreviewModal> auto-fit math must hold on
 * both ends of the content-length spectrum:
 *
 *   - Short receipt (~1 line of body): the single A4 sheet is much taller
 *     than its content. The fit should still constrain on the *width* axis
 *     so the whole sheet is visible inside the preview container. Bug
 *     regressed once when the fit switched to height-only for short docs
 *     and let the sheet overflow horizontally on mobile.
 *
 *   - Long receipt (multi-page): body is engineered to overflow one A4
 *     page so preparePrint() paginates into ≥ 2 .pp-sheet elements. The
 *     fit must apply to the *first* sheet's width (not the total document
 *     height) or the sheet ends up scaled down to a thumbnail. The
 *     render-status chip must also report the multi-page count.
 *
 * Both cases run on portrait mobile (390×844) — where auto-fit is
 * width-constrained — and on desktop (1280×900) — where the preview
 * container is roomy and no scaling should be forced.
 *
 * Run:  bunx playwright test tests/a11y/print-modal-fit-lengths.spec.ts
 *
 * Uses the /test-print-modal harness with the new ?doc=short-receipt and
 * ?doc=long-receipt variants (see src/routes/test-print-modal.tsx).
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const MIN_VISIBLE_RATIO = 0.5;
// Sheet may extend slightly past the container due to sub-pixel rounding
// after CSS transform: scale(). 2 % of container width is the tolerance
// we're willing to accept before calling it a horizontal overflow bug.
const WIDTH_OVERFLOW_TOLERANCE = 1.02;

type Viewport = {
  name: "mobile-portrait" | "desktop";
  viewport: { width: number; height: number };
};

const VIEWPORTS: readonly Viewport[] = [
  { name: "mobile-portrait", viewport: { width: 390, height: 844 } },
  { name: "desktop", viewport: { width: 1280, height: 900 } },
] as const;

async function openModal(page: Page, doc: string) {
  await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("open-modal").click();
  await expect(page.locator(".pp-sheet").first()).toBeVisible({ timeout: 15_000 });
  // Give the render-status chip a chance to flip to "Ready" so pagination
  // and the fit transform have both settled before we measure.
  await expect(
    page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /Ready/ }).first(),
  ).toBeVisible({ timeout: 8_000 });
}

/**
 * Measurements for the first .pp-sheet relative to its scrollable
 * preview container. Returns the visible-area ratio (as in the
 * mobile-render spec) plus the raw widths so tests can distinguish a
 * "fits vertically but overflows horizontally" regression from a
 * "shrunk to a thumbnail" regression.
 */
async function measureFirstSheet(page: Page): Promise<{
  visibleRatio: number;
  sheetWidth: number;
  containerWidth: number;
  sheetCount: number;
}> {
  return page.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll<HTMLElement>(".pp-sheet"));
    const sheet = sheets[0] ?? null;
    if (!sheet) return { visibleRatio: 0, sheetWidth: 0, containerWidth: 0, sheetCount: 0 };
    let container: HTMLElement | null = sheet.parentElement;
    while (container && container !== document.body) {
      const oy = getComputedStyle(container).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      container = container.parentElement;
    }
    if (!container)
      return { visibleRatio: 0, sheetWidth: 0, containerWidth: 0, sheetCount: sheets.length };
    const s = sheet.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const w = Math.max(0, Math.min(s.right, c.right) - Math.max(s.left, c.left));
    const h = Math.max(0, Math.min(s.bottom, c.bottom) - Math.max(s.top, c.top));
    const overlap = w * h;
    const sheetArea = Math.max(1, s.width * s.height);
    return {
      visibleRatio: overlap / sheetArea,
      sheetWidth: s.width,
      containerWidth: c.width,
      sheetCount: sheets.length,
    };
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`PrintPreviewModal — auto-fit at content-length extremes (${vp.name})`, () => {
    test.use({
      viewport: vp.viewport,
      colorScheme: "light",
      reducedMotion: "reduce",
    });

    test("short receipt: single sheet fits width without horizontal overflow", async ({ page }) => {
      await openModal(page, "short-receipt");
      await page.waitForTimeout(200);

      const m = await measureFirstSheet(page);
      expect(m.sheetCount, `[${vp.name}] short receipt should render exactly 1 page`).toBe(1);
      expect(
        m.visibleRatio,
        `[${vp.name}] short-receipt sheet should overlap the container by ≥ ${MIN_VISIBLE_RATIO}, got ${m.visibleRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);
      expect(
        m.sheetWidth,
        `[${vp.name}] short-receipt sheet width (${m.sheetWidth.toFixed(0)}px) must not overflow container width (${m.containerWidth.toFixed(0)}px)`,
      ).toBeLessThanOrEqual(m.containerWidth * WIDTH_OVERFLOW_TOLERANCE);
    });

    test("long receipt: paginates into multiple sheets and the first still auto-fits", async ({
      page,
    }) => {
      await openModal(page, "long-receipt");
      await page.waitForTimeout(300);

      const m = await measureFirstSheet(page);
      expect(
        m.sheetCount,
        `[${vp.name}] long-receipt body should paginate into ≥ 2 pp-sheet elements, got ${m.sheetCount}`,
      ).toBeGreaterThanOrEqual(2);

      expect(
        m.visibleRatio,
        `[${vp.name}] long-receipt first page should still overlap the container by ≥ ${MIN_VISIBLE_RATIO} after auto-fit (regression: multi-page docs scale to thumbnails), got ${m.visibleRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);

      expect(
        m.sheetWidth,
        `[${vp.name}] long-receipt first sheet width (${m.sheetWidth.toFixed(0)}px) must not overflow container width (${m.containerWidth.toFixed(0)}px)`,
      ).toBeLessThanOrEqual(m.containerWidth * WIDTH_OVERFLOW_TOLERANCE);

      // Status chip must reflect the true page count so screen-reader
      // users know how many pages were prepared.
      const status = page
        .locator('[role="status"][aria-live="polite"]')
        .filter({ hasText: /Ready · \d+ page/i })
        .first();
      const text = (await status.textContent())?.trim() ?? "";
      const match = text.match(/Ready · (\d+) page/i);
      expect(match, `[${vp.name}] expected "Ready · N page(s)" chip, got "${text}"`).not.toBeNull();
      const announced = Number(match![1]);
      expect(
        announced,
        `[${vp.name}] status chip announced ${announced} page(s) but DOM has ${m.sheetCount} .pp-sheet elements`,
      ).toBe(m.sheetCount);
    });
  });
}
