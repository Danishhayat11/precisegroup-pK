/**
 * End-to-end regression: <PrintPreviewModal>'s auto-fit math is
 * `Math.min(availW / sheetW, availH / sheetH)` (see `computeFitZoom` in
 * src/components/PrintPreviewModal.tsx). Whichever ratio is smaller
 * decides the axis — and the two axes have historically been
 * regressed independently:
 *
 *   - "Narrow receipt" — the *container* is much narrower than it is
 *     tall (e.g. a 320-px-wide phone). Width is the binding axis, and
 *     a bug that ignored `availW` used to let the A4 sheet overflow
 *     horizontally.
 *
 *   - "Tall receipt" — the *container* is much shorter than it is
 *     wide (e.g. a 1400×420 desktop panel), or the document is so
 *     long it paginates into a stack many multiples of the viewport
 *     tall. Height becomes the binding axis, and a bug that only
 *     divided by `sheetW` used to leave the sheet chopped off the
 *     bottom of the scroller — user sees nothing until they scroll.
 *
 * This spec exercises both binding axes at both content extremes
 * (short-receipt = single page; long-receipt = paginated) so a
 * regression on either axis fails a named test instead of hiding
 * behind the middle-of-the-road A4 case in fit-lengths.
 *
 * Run:  bunx playwright test tests/a11y/print-modal-fit-extremes.spec.ts
 *
 * Companion to:
 *   - tests/a11y/print-modal-mobile-render.spec.ts (mobile render integrity)
 *   - tests/a11y/print-modal-fit-lengths.spec.ts   (portrait mobile + desktop
 *                                                   at standard aspect ratios)
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const MIN_VISIBLE_RATIO = 0.5;
// A CSS `transform: scale()` on the sheet can round its bounding box a
// hair past the container edge on sub-pixel grids. 2 % of the container's
// width is our tolerance before we call it a real horizontal overflow.
// (No matching tolerance for height: `computeFitZoom` floors the scale at
// 0.35 to keep the sheet readable, so on very short containers the sheet
// is intentionally taller than the viewport and becomes vertically
// scrollable — the invariant that matters there is visibility ratio.)
const WIDTH_OVERFLOW_TOLERANCE = 1.02;

type Extreme = {
  name: "narrow-container" | "tall-container";
  /** Which viewport tier this represents in user terms (matches the two
   *  device classes the app supports). */
  tier: "mobile-portrait" | "desktop";
  viewport: { width: number; height: number };
  /** The axis the fit math should be constrained on for this shape. */
  bindingAxis: "width" | "height";
};

const EXTREMES: readonly Extreme[] = [
  // Mobile portrait, but squeezed to the narrowest viewport we still
  // claim to support. The A4 portrait sheet is ~794 CSS px wide at 1×;
  // at 320 px the container is < 41 % of the sheet's native width, so
  // the fit MUST be width-constrained or the sheet overflows sideways.
  {
    name: "narrow-container",
    tier: "mobile-portrait",
    viewport: { width: 320, height: 1200 },
    bindingAxis: "width",
  },
  // Desktop with an unusually short chrome — think a docked bottom
  // panel or landscape tablet. The container is much wider than tall,
  // so an A4 portrait sheet (~1123 px tall at 1×) must be scaled down
  // by the *height* ratio or its bottom half falls out of view.
  {
    name: "tall-container",
    tier: "desktop",
    viewport: { width: 1400, height: 420 },
    bindingAxis: "height",
  },
] as const;

async function openModal(page: Page, doc: string) {
  await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("open-modal").click();
  await expect(page.locator(".pp-sheet").first()).toBeVisible({ timeout: 15_000 });
  // Let auto-fit settle after mount + font load + ResizeObserver first tick.
  await expect(
    page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /Ready/ }).first(),
  ).toBeVisible({ timeout: 8_000 });
}

/**
 * Measurements for the first .pp-sheet relative to its scrollable
 * preview container, returned as raw pixels so tests can assert against
 * the correct binding axis (width for narrow containers, height for
 * short/tall ones) without ambiguity.
 */
async function measureFirstSheet(page: Page): Promise<{
  visibleRatio: number;
  sheetWidth: number;
  sheetHeight: number;
  containerWidth: number;
  containerHeight: number;
  sheetCount: number;
}> {
  return page.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll<HTMLElement>(".pp-sheet"));
    const sheet = sheets[0] ?? null;
    if (!sheet) {
      return {
        visibleRatio: 0,
        sheetWidth: 0,
        sheetHeight: 0,
        containerWidth: 0,
        containerHeight: 0,
        sheetCount: 0,
      };
    }
    let container: HTMLElement | null = sheet.parentElement;
    while (container && container !== document.body) {
      const oy = getComputedStyle(container).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      container = container.parentElement;
    }
    if (!container) {
      return {
        visibleRatio: 0,
        sheetWidth: 0,
        sheetHeight: 0,
        containerWidth: 0,
        containerHeight: 0,
        sheetCount: sheets.length,
      };
    }
    const s = sheet.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const w = Math.max(0, Math.min(s.right, c.right) - Math.max(s.left, c.left));
    const h = Math.max(0, Math.min(s.bottom, c.bottom) - Math.max(s.top, c.top));
    const overlap = w * h;
    const sheetArea = Math.max(1, s.width * s.height);
    return {
      visibleRatio: overlap / sheetArea,
      sheetWidth: s.width,
      sheetHeight: s.height,
      containerWidth: c.width,
      containerHeight: c.height,
      sheetCount: sheets.length,
    };
  });
}

for (const ex of EXTREMES) {
  test.describe(`PrintPreviewModal — auto-fit at container-aspect extremes (${ex.name}, ${ex.tier})`, () => {
    test.use({
      viewport: ex.viewport,
      colorScheme: "light",
      reducedMotion: "reduce",
    });

    test(`short receipt: single sheet stays within the ${ex.bindingAxis}-binding container`, async ({
      page,
    }) => {
      await openModal(page, "short-receipt");
      await page.waitForTimeout(300);

      const m = await measureFirstSheet(page);
      expect(m.sheetCount, `[${ex.name}] short receipt should render exactly 1 page`).toBe(1);
      expect(
        m.visibleRatio,
        `[${ex.name}] short-receipt sheet should overlap the container by ≥ ${MIN_VISIBLE_RATIO}, got ${m.visibleRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);

      if (ex.bindingAxis === "width") {
        expect(
          m.sheetWidth,
          `[${ex.name}] sheet width (${m.sheetWidth.toFixed(0)}px) must not overflow container width (${m.containerWidth.toFixed(0)}px) — width-axis fit regressed`,
        ).toBeLessThanOrEqual(m.containerWidth * WIDTH_OVERFLOW_TOLERANCE);
      }
      // Height-axis extremes intentionally allow vertical scroll below
      // the auto-fit floor (see WIDTH_OVERFLOW_TOLERANCE comment); the
      // visibleRatio check above is the height-binding contract.
    });

    test(`long receipt: paginated document's first sheet still fits the ${ex.bindingAxis}-binding container`, async ({
      page,
    }) => {
      await openModal(page, "long-receipt");
      await page.waitForTimeout(400);

      const m = await measureFirstSheet(page);
      expect(
        m.sheetCount,
        `[${ex.name}] long-receipt body should paginate into ≥ 2 pp-sheet elements, got ${m.sheetCount}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        m.visibleRatio,
        `[${ex.name}] long-receipt first page should overlap the container by ≥ ${MIN_VISIBLE_RATIO} after auto-fit (regression: paginated docs collapse to a thumbnail on extreme aspects), got ${m.visibleRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);

      if (ex.bindingAxis === "width") {
        expect(
          m.sheetWidth,
          `[${ex.name}] first sheet width (${m.sheetWidth.toFixed(0)}px) must not overflow container width (${m.containerWidth.toFixed(0)}px) — width-axis fit regressed on paginated docs`,
        ).toBeLessThanOrEqual(m.containerWidth * WIDTH_OVERFLOW_TOLERANCE);
      }
      // Height-binding extremes intentionally allow the sheet to be
      // taller than the container (auto-fit floor); the visibleRatio
      // check above is the contract for that axis.

      // Cross-check: status chip page count matches DOM sheet count so
      // extreme aspects don't silently desync the announcement.
      const status = page
        .locator('[role="status"][aria-live="polite"]')
        .filter({ hasText: /Ready · \d+ page/i })
        .first();
      const text = (await status.textContent())?.trim() ?? "";
      const match = text.match(/Ready · (\d+) page/i);
      expect(match, `[${ex.name}] expected "Ready · N page(s)" chip, got "${text}"`).not.toBeNull();
      expect(Number(match![1]), `[${ex.name}] chip page count must match DOM sheet count`).toBe(
        m.sheetCount,
      );
    });
  });
}
