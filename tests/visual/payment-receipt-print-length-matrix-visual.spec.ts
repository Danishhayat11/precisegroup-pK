import { expect, test, type Page, type Locator } from "@playwright/test";
import { PNG } from "pngjs";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * PaymentReceipt — pixel-snapshot visual regression across LENGTHS × PAGE
 * SIZES.
 *
 * Complements `receipt-print-length-matrix.spec.ts` (which only measures
 * ink coverage + overflow deltas) by locking a baseline PNG for every
 * (pageSize × length) cell of the dual-copy payment receipt. Any silent
 * regression that vanishes a copy, clips the tear-line, or collapses the
 * simplified fallback will now surface as a diff instead of only firing
 * on the numeric floor.
 *
 * Matrix: {a4, letter} × {short, long, extreme} = 6 baselines per browser.
 */

const RECEIPT_NO = "PAY-00001";

const PAGE_SIZES = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
} as const;
type PageSize = keyof typeof PAGE_SIZES;

const LENGTH_SCENARIOS = {
  short: 0,
  long: 18,
  extreme: 60,
} as const;
type LengthScenario = keyof typeof LENGTH_SCENARIOS;

const MIN_INK_COVERAGE = 0.06;

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
  if (!width || !height) return 0;
  let inked = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      if (data[i] < 231 || data[i + 1] < 231 || data[i + 2] < 231) inked++;
    }
  }
  const sampled = Math.ceil(width / 2) * Math.ceil(height / 2);
  return inked / sampled;
}

async function inflateReceipt(page: Page, extraBlocks: number) {
  if (extraBlocks <= 0) return;
  await page.evaluate((n) => {
    const copies = Array.from(
      document.querySelectorAll(".pp-zoom-wrap .pp-receipt .pp-copy"),
    ) as HTMLElement[];
    for (const copy of copies) {
      const donor =
        (copy.querySelector(".pp-avoid-break") as HTMLElement | null) ??
        (copy.lastElementChild as HTMLElement | null);
      if (!donor) continue;
      for (let i = 0; i < n; i++) {
        const clone = donor.cloneNode(true) as HTMLElement;
        clone.setAttribute("data-synth-row", String(i));
        clone
          .querySelectorAll(".pp-simplified-hide")
          .forEach((el) => el.classList.remove("pp-simplified-hide"));
        donor.parentElement?.insertBefore(clone, donor.nextSibling);
      }
    }
  }, extraBlocks);
}

for (const pageSize of Object.keys(PAGE_SIZES) as PageSize[]) {
  for (const length of Object.keys(LENGTH_SCENARIOS) as LengthScenario[]) {
    test.describe(`PaymentReceipt visual — ${pageSize} × ${length}`, () => {
      test.skip(!authAvailable(), "requires an injected Lovable session");

      test(`baseline snapshot (${pageSize}/${length})`, async ({ context, page }) => {
        const viewport = PAGE_SIZES[pageSize];
        await page.setViewportSize(viewport);
        await forceLight(page);
        await restoreSupabaseSession(context, page);
        await page.goto(`/receipt-fixture/${RECEIPT_NO}`, {
          waitUntil: "domcontentloaded",
        });

        const receipt = page
          .locator(".pp-zoom-wrap .pp-receipt.pp-payment-receipt, .pp-zoom-wrap .pp-receipt")
          .first();
        await expect(receipt, "Receipt mounts inside print preview").toBeVisible({
          timeout: 10_000,
        });

        const copies = receipt.locator(".pp-copy");
        await expect(copies, "Office + Client copies render").toHaveCount(2);

        await inflateReceipt(page, LENGTH_SCENARIOS[length]);
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

        // Pre-snapshot sanity: guard against saving a blank baseline.
        const coverage = await inkCoverage(receipt);
        expect(
          coverage,
          `Refusing to baseline a blank raster for ${pageSize}/${length} (coverage=${(
            coverage * 100
          ).toFixed(1)}%)`,
        ).toBeGreaterThan(MIN_INK_COVERAGE);

        await expect(receipt).toHaveScreenshot(`payment-receipt-${pageSize}-${length}.png`, {
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: 0.02,
        });
      });
    });
  }
}
