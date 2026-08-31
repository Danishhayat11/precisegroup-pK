/**
 * End-to-end regression: navigating to later pages in a multi-page
 * receipt must keep the auto-fit scale correct and the render-status
 * chip's page count stable. The modal renders every page as a stacked
 * .pp-sheet inside a single scrollable preview container (there is no
 * next/prev pager — you scroll), so "navigate to page N" means scroll
 * the container until the Nth .pp-sheet enters the viewport.
 *
 * Contracts pinned:
 *   1. Every .pp-sheet in the stack renders at the same fitted width
 *      as the first — a per-page fit regression would show up as a
 *      later page being wider (or narrower) than page 1 and either
 *      overflowing the container or leaving a large gutter.
 *   2. Scrolling to the middle and the last page keeps ≥ 60 % of that
 *      sheet's area visible inside the container (auto-fit survives
 *      scroll; sheet isn't clipped away by header/footer overlays).
 *   3. The render-status chip's "Ready · N page(s)" text does NOT
 *      change while scrolling — the page count is a property of the
 *      document, not of the scroll position.
 *
 * Runs on portrait mobile (390×844) and desktop (1280×900) so both
 * width-constrained (mobile) and mostly-unconstrained (desktop) fit
 * paths are exercised.
 *
 * Run:  bunx playwright test tests/a11y/print-modal-page-navigation.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const MIN_VISIBLE_RATIO = 0.6;
// Per-page width variance tolerance. Sub-pixel rounding after
// `transform: scale()` can make sibling sheets differ by a fraction of
// a pixel; anything over 1 px is a real fit regression.
const WIDTH_VARIANCE_TOLERANCE_PX = 1;

type Viewport = {
  name: "mobile-portrait" | "desktop";
  viewport: { width: number; height: number };
};

const VIEWPORTS: readonly Viewport[] = [
  { name: "mobile-portrait", viewport: { width: 390, height: 844 } },
  { name: "desktop", viewport: { width: 1280, height: 900 } },
] as const;

async function openLongReceipt(page: Page) {
  await page.goto(`${BASE}/test-print-modal?doc=long-receipt`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("open-modal").click();
  await expect(page.locator(".pp-sheet").first()).toBeVisible({ timeout: 15_000 });
  await expect(
    page
      .locator('[role="status"][aria-live="polite"]')
      .filter({ hasText: /Ready · \d+ page/i })
      .first(),
  ).toBeVisible({ timeout: 8_000 });
}

/**
 * Scroll the preview container so its viewport is roughly centered on
 * the Nth .pp-sheet (0-indexed). Then wait a beat for the fit
 * ResizeObserver / any lazy layout to settle before measurement.
 */
async function scrollToSheet(page: Page, index: number): Promise<void> {
  await page.evaluate((i: number) => {
    const sheets = document.querySelectorAll<HTMLElement>(".pp-sheet");
    const sheet = sheets[i];
    if (!sheet) return;
    let container: HTMLElement | null = sheet.parentElement;
    while (container && container !== document.body) {
      const oy = getComputedStyle(container).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      container = container.parentElement;
    }
    if (!container) return;
    const s = sheet.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    // Position the sheet's top ~10 % into the container from the top.
    const targetOffsetInContainer = c.height * 0.1;
    const currentTopInContainer = s.top - c.top;
    container.scrollTop += currentTopInContainer - targetOffsetInContainer;
    container.dispatchEvent(new Event("scroll"));
  }, index);
  await page.waitForTimeout(250);
}

async function measureSheetVsContainer(
  page: Page,
  index: number,
): Promise<{
  visibleRatio: number;
  sheetWidth: number;
  containerWidth: number;
  found: boolean;
}> {
  return page.evaluate((i: number) => {
    const sheets = document.querySelectorAll<HTMLElement>(".pp-sheet");
    const sheet = sheets[i];
    if (!sheet) return { visibleRatio: 0, sheetWidth: 0, containerWidth: 0, found: false };
    let container: HTMLElement | null = sheet.parentElement;
    while (container && container !== document.body) {
      const oy = getComputedStyle(container).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      container = container.parentElement;
    }
    if (!container) return { visibleRatio: 0, sheetWidth: 0, containerWidth: 0, found: false };
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
      found: true,
    };
  }, index);
}

for (const vp of VIEWPORTS) {
  test.describe(`PrintPreviewModal — multi-page navigation preserves fit (${vp.name})`, () => {
    test.use({
      viewport: vp.viewport,
      colorScheme: "light",
      reducedMotion: "reduce",
    });

    test("scrolling to the middle and last pages keeps each sheet fitted and the page count stable", async ({
      page,
    }) => {
      await openLongReceipt(page);

      const sheetCount = await page.locator(".pp-sheet").count();
      expect(
        sheetCount,
        `[${vp.name}] long-receipt should paginate into ≥ 2 pages`,
      ).toBeGreaterThanOrEqual(2);

      // Snapshot the initial "Ready · N page(s)" text so we can assert
      // it never changes as the user scrolls through the document.
      const status = page
        .locator('[role="status"][aria-live="polite"]')
        .filter({ hasText: /Ready · \d+ page/i })
        .first();
      const initialStatusText = ((await status.textContent()) ?? "").trim();
      const initialMatch = initialStatusText.match(/Ready · (\d+) page/i);
      expect(
        initialMatch,
        `[${vp.name}] expected "Ready · N page(s)" chip, got "${initialStatusText}"`,
      ).not.toBeNull();
      expect(
        Number(initialMatch![1]),
        `[${vp.name}] chip page count must match DOM sheet count`,
      ).toBe(sheetCount);

      // Baseline: page 1 fits.
      const first = await measureSheetVsContainer(page, 0);
      expect(first.found).toBe(true);
      expect(
        first.visibleRatio,
        `[${vp.name}] page 1 should overlap the container by ≥ ${MIN_VISIBLE_RATIO}, got ${first.visibleRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);

      // Sanity-check every sheet's width against page 1's width — a
      // regression that re-fits per-page would show up as a variance
      // larger than sub-pixel rounding.
      const allWidths: number[] = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".pp-sheet")).map(
          (el) => el.getBoundingClientRect().width,
        ),
      );
      const maxDelta = Math.max(...allWidths.map((w) => Math.abs(w - first.sheetWidth)));
      expect(
        maxDelta,
        `[${vp.name}] all pages should render at the same fitted width as page 1 (±${WIDTH_VARIANCE_TOLERANCE_PX}px); widths=${allWidths.map((w) => w.toFixed(1)).join(",")}`,
      ).toBeLessThanOrEqual(WIDTH_VARIANCE_TOLERANCE_PX);

      // Navigate to the middle page.
      const middleIndex = Math.floor(sheetCount / 2);
      await scrollToSheet(page, middleIndex);
      const middle = await measureSheetVsContainer(page, middleIndex);
      expect(middle.found).toBe(true);
      expect(
        middle.visibleRatio,
        `[${vp.name}] middle page (${middleIndex + 1}/${sheetCount}) should overlap the container by ≥ ${MIN_VISIBLE_RATIO} after scroll, got ${middle.visibleRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);

      // Navigate to the last page.
      const lastIndex = sheetCount - 1;
      await scrollToSheet(page, lastIndex);
      const last = await measureSheetVsContainer(page, lastIndex);
      expect(last.found).toBe(true);
      expect(
        last.visibleRatio,
        `[${vp.name}] last page (${sheetCount}/${sheetCount}) should overlap the container by ≥ ${MIN_VISIBLE_RATIO} after scroll, got ${last.visibleRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);

      // Status chip text must not have changed as a side-effect of
      // scrolling — the count reflects the document, not the viewport.
      const finalStatusText = ((await status.textContent()) ?? "").trim();
      expect(
        finalStatusText,
        `[${vp.name}] status chip changed during navigation: "${initialStatusText}" → "${finalStatusText}"`,
      ).toBe(initialStatusText);

      // And the DOM sheet count is still what we started with (no page
      // was added / dropped by the scroll observers).
      const finalSheetCount = await page.locator(".pp-sheet").count();
      expect(
        finalSheetCount,
        `[${vp.name}] .pp-sheet count changed during navigation: ${sheetCount} → ${finalSheetCount}`,
      ).toBe(sheetCount);
    });
  });
}
