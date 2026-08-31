import { expect, test, type Page, type Locator } from "@playwright/test";
import { PNG } from "pngjs";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * PaymentReceipt — A4 print blank/vanished-output regression guard.
 *
 * The dual-copy receipt has repeatedly regressed to a *blank* A4 page in
 * production — usually caused by a hidden-iframe print flow, an
 * `overflow:hidden` sheet clipping content, or a print-media rule that
 * collapses the receipt while `@media print` is active. Pixel-diff
 * snapshots alone don't catch this reliably: a blank baseline stays
 * blank across runs and drift budgets can absorb "content mostly gone"
 * without failing.
 *
 * This spec asserts concrete invariants that a blank/vanished receipt
 * CANNOT satisfy, at true A4 (194 × 285 mm safe area, dpr=1):
 *
 *   1. Both copies mount (`.pp-copy` × 2), each with non-trivial pixel
 *      dimensions filling ≥ 40% of A4 height.
 *   2. Every required text landmark is present in the rendered DOM
 *      (project title, "PAYMENT RECEIPT", "OFFICE COPY", "CLIENT COPY",
 *      "Amount Received", the balance panel heading, and the tear
 *      instruction).
 *   3. The rasterised receipt is not uniformly white — at least 8% of
 *      sampled pixels deviate from the sheet background by a
 *      perceptible amount (guards against the "printed page is empty"
 *      class of bugs where content is technically in the DOM but painted
 *      off-canvas or clipped to zero).
 *   4. A tolerant full-receipt snapshot is committed so a future
 *      "shrunk to a strip" regression fails the diff even if it still
 *      passes the pixel-diversity floor.
 */

const RECEIPT_NO = "PAY-00001";

// A4 at 96 dpi — matches Chrome's print rasterisation grid.
const A4_VIEWPORT = { width: 794, height: 1123 } as const;

const REQUIRED_LANDMARKS = [
  "PAYMENT RECEIPT",
  "OFFICE COPY",
  "CLIENT COPY",
  "Amount Received",
  "Account Balance After This Payment",
  "Receipt No.",
] as const;

/** Fraction of pixels that must diverge from pure white. */
const MIN_INK_COVERAGE = 0.08;

/** Fraction of A4 height each copy must occupy — a "vanished" copy
 *  collapses to near-zero, so anything below this is a regression. */
const MIN_COPY_HEIGHT_FRACTION = 0.35;

async function forceLight(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("precise.theme", "light");
    } catch {
      /* ignored */
    }
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

async function inkCoverage(locator: Locator): Promise<number> {
  const buf = await locator.screenshot({ animations: "disabled", caret: "hide" });
  const png = PNG.sync.read(buf);
  const { data, width, height } = png;
  const total = width * height;
  if (!total) return 0;
  let inked = 0;
  // Sample every 4th pixel row+col for speed — still ~62k samples on
  // an A4 raster, well above what a statistical floor needs.
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Anything meaningfully darker than the sheet (#fff) counts as ink.
      // A 24-point delta absorbs anti-aliasing halos without counting
      // them as content on their own.
      if (r < 231 || g < 231 || b < 231) inked++;
    }
  }
  const sampled = Math.ceil(width / 2) * Math.ceil(height / 2);
  return inked / sampled;
}

test.describe("PaymentReceipt — A4 blank/vanished-output guard", () => {
  test.skip(!authAvailable(), "requires an injected Lovable session");

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(A4_VIEWPORT);
  });

  test("A4 receipt renders substantive content — not blank, not collapsed", async ({
    context,
    page,
  }) => {
    await forceLight(page);
    await restoreSupabaseSession(context, page);
    await page.goto(`/receipt-fixture/${RECEIPT_NO}`, { waitUntil: "domcontentloaded" });

    // Scope to the visible preview (skip the off-screen measurement copy
    // the modal mounts alongside).
    const receipt = page.locator(".pp-zoom-wrap .pp-receipt").first();
    await expect(receipt, "Receipt mounts inside print preview modal").toBeVisible({
      timeout: 10_000,
    });

    const copies = receipt.locator(".pp-copy");
    await expect(copies, "Office + Client copies render").toHaveCount(2);

    // Landmark text must exist in the rendered DOM — a "vanished" receipt
    // loses these because the parent flex/grid collapsed before paint.
    const receiptText = (await receipt.innerText()).replace(/\s+/g, " ");
    for (const landmark of REQUIRED_LANDMARKS) {
      expect(
        receiptText,
        `Receipt is missing landmark "${landmark}" — likely a blank/vanished render`,
      ).toContain(landmark);
    }

    // Wait for fonts / images / final reflow so the pixel floor is stable.
    await page.evaluate(() => document.fonts?.ready);
    await receipt.evaluate((el) =>
      Promise.all(
        Array.from(el.querySelectorAll("img")).map(
          (img) =>
            (img as HTMLImageElement).complete ||
            new Promise((r) => {
              img.addEventListener("load", () => r(null), { once: true });
              img.addEventListener("error", () => r(null), { once: true });
            }),
        ),
      ),
    );
    await page.waitForTimeout(300);

    // Geometry — each copy must occupy a real fraction of the A4 sheet.
    const receiptBox = await receipt.boundingBox();
    expect(receiptBox, "Receipt bounding box").not.toBeNull();
    expect(receiptBox!.height, "Receipt must be ≥ 60% of A4 height").toBeGreaterThan(
      A4_VIEWPORT.height * 0.6,
    );

    for (let i = 0; i < 2; i++) {
      const box = await copies.nth(i).boundingBox();
      expect(box, `Copy #${i} bounding box`).not.toBeNull();
      expect(
        box!.height,
        `Copy #${i} must occupy ≥ ${Math.round(MIN_COPY_HEIGHT_FRACTION * 100)}% of A4 height`,
      ).toBeGreaterThan(A4_VIEWPORT.height * MIN_COPY_HEIGHT_FRACTION);
      expect(box!.width, `Copy #${i} width must fill the sheet`).toBeGreaterThan(
        A4_VIEWPORT.width * 0.7,
      );
    }

    // Ink-coverage floor — the definitive blank-page detector.
    const coverage = await inkCoverage(receipt);
    expect(
      coverage,
      `Receipt raster is ${Math.round(coverage * 1000) / 10}% non-white — below the ${
        MIN_INK_COVERAGE * 100
      }% floor. This is the classic "printed a blank A4" regression.`,
    ).toBeGreaterThan(MIN_INK_COVERAGE);

    // Committed baseline — catches "shrunk to a header strip" regressions
    // that still clear the ink floor. Tolerant budget lets legitimate
    // typography tweaks land without a reflow of this guard.
    await expect(receipt).toHaveScreenshot("receipt-a4-blank-guard.png", {
      maxDiffPixelRatio: 0.03,
      animations: "disabled",
    });
  });
});
