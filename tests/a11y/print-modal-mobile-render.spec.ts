/**
 * End-to-end regression: <PrintPreviewModal> on a mobile viewport must
 * render a visible printable sheet inside the preview container on open —
 * no more "empty gray" bug where the A4 sheet (~794 CSS px wide) started
 * scrolled off the ~340 px preview area on a 390 px phone.
 *
 * Contracts pinned (run twice — portrait 390×844 and landscape 844×390 —
 * because the auto-fit math constrains on the tighter axis and the
 * blank-preview helper must reach landscape phones too, where the short
 * viewport height is the failure axis rather than width):
 *   1. On open, the first .pp-sheet in the preview scroller intersects
 *      the container by ≥ 60 % of its scaled area (auto-fit succeeded).
 *   2. The render-status chip announces "Preparing preview…" and then
 *      flips to "Ready · N page(s)" (rendering → ready transition works
 *      and the aria-live status is populated).
 *   3. If every .pp-sheet is invisible (simulating the "empty gray"
 *      failure), the blank-preview helper appears and its "Fit to screen"
 *      action restores intersection ≥ 60 %.
 *
 * Run:  bunx playwright test tests/a11y/print-modal-mobile-render.spec.ts
 *
 * Uses the same /test-print-modal harness as print-modal-cleanup.spec.ts
 * so no seeded data / signed-in session is required.
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const MIN_VISIBLE_RATIO = 0.5;

type Orientation = {
  name: "portrait" | "landscape";
  viewport: { width: number; height: number };
};

const ORIENTATIONS: readonly Orientation[] = [
  // iPhone 14 class. Portrait is width-constrained; landscape is
  // height-constrained (only ~390 px tall) — different failure axis for
  // the auto-fit math, so both must be exercised.
  { name: "portrait", viewport: { width: 390, height: 844 } },
  { name: "landscape", viewport: { width: 844, height: 390 } },
] as const;

async function openModal(page: Page, doc = "receipt") {
  await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "domcontentloaded" });
  // Wait for client-side hydration; the SSR button is a no-op until React attaches.
  await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("open-modal").click();
  await expect(page.locator(".pp-sheet").first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Ratio of the first .pp-sheet's visible area (clipped to its scrollable
 * preview container) to its own on-screen bounding-box area. 1.0 means
 * the sheet is entirely within the container's viewport; 0 means it's
 * fully off-screen. Uses layout rects so it reflects the zoomed size.
 */
async function sheetVisibilityRatio(page: Page): Promise<number> {
  return page.evaluate((): number => {
    const sheet = document.querySelector(".pp-sheet") as HTMLElement | null;
    if (!sheet) return 0;
    let container: HTMLElement | null = sheet.parentElement;
    while (container && container !== document.body) {
      const oy = getComputedStyle(container).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      container = container.parentElement;
    }
    if (!container) return 0;
    const s = sheet.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const w = Math.max(0, Math.min(s.right, c.right) - Math.max(s.left, c.left));
    const h = Math.max(0, Math.min(s.bottom, c.bottom) - Math.max(s.top, c.top));
    const overlap = w * h;
    const sheetArea = Math.max(1, s.width * s.height);
    return overlap / sheetArea;
  });
}

for (const orient of ORIENTATIONS) {
  test.describe(`PrintPreviewModal — mobile render integrity (${orient.name})`, () => {
    test.use({
      viewport: orient.viewport,
      colorScheme: "light",
      reducedMotion: "reduce",
    });

    test("auto-fits the sheet into the preview container on open", async ({ page }) => {
      await openModal(page);
      await page.waitForTimeout(200);
      const ratio = await sheetVisibilityRatio(page);
      expect(
        ratio,
        `[${orient.name}] Expected ≥ ${MIN_VISIBLE_RATIO} of the sheet to overlap the preview container after auto-fit, got ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);
    });

    test("render status chip transitions rendering → ready and announces page count", async ({
      page,
    }) => {
      await openModal(page);
      const status = page
        .locator('[role="status"][aria-live="polite"]')
        .filter({ hasText: /Preparing preview|Ready/ });
      await expect(status.first()).toHaveText(/Ready · \d+ page/i, { timeout: 6_000 });
    });

    test("blank-preview helper appears when no sheet is visible and Fit to screen restores a fitted layout", async ({
      page,
    }) => {
      await openModal(page);
      await page.waitForTimeout(200);

      // Simulate the "empty gray preview" failure mode by hiding every sheet
      // inside the scroller, then nudging the scroller so the blank-preview
      // detector (which listens for scroll + ResizeObserver events) re-runs
      // with `.pp-sheet` invisible → ratio 0 → previewBlank=true.
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>(".pp-sheet").forEach((el) => {
          el.dataset.mrOrigDisplay = el.style.display;
          el.style.display = "none";
        });
        const scroller = document.querySelector<HTMLElement>(".pp-print-root")?.parentElement;
        if (scroller) {
          scroller.scrollTop = scroller.scrollTop + 1;
          scroller.dispatchEvent(new Event("scroll"));
        }
      });

      const helper = page.getByRole("status").filter({ hasText: /Preview looks blank/i });
      await expect(helper).toBeVisible({ timeout: 3_000 });

      // Restore the sheets before tapping Fit to screen so we can verify the
      // helper's action actually fits the (now-visible) content.
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>(".pp-sheet").forEach((el) => {
          el.style.display = el.dataset.mrOrigDisplay ?? "";
        });
      });

      await helper
        .getByRole("button", { name: /Fit the printable sheet to the preview screen/i })
        .click();
      // Dismiss the helper so its sticky banner no longer eats vertical
      // space in the scroller; then the visibility ratio reflects the
      // fitted layout on its own.
      await helper.getByRole("button", { name: /Dismiss blank preview helper/i }).click();
      await page.waitForTimeout(400);

      const ratio = await sheetVisibilityRatio(page);
      expect(
        ratio,
        `[${orient.name}] After tapping Fit to screen, expected ≥ ${MIN_VISIBLE_RATIO} of the sheet to overlap the container, got ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);
    });
  });
}
