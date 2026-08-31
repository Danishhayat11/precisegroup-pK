import { expect, test, type Page, type Locator } from "@playwright/test";
import { PNG } from "pngjs";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * PaymentReceipt — print regression matrix across receipt LENGTHS and
 * PAGE SIZES.
 *
 * The dual-copy receipt has two well-known failure modes in production:
 *
 *   1. **Blank / vanished output** — an `overflow:hidden` sheet, a print
 *      media rule, or the clone/scale path collapses content before
 *      rasterisation. Baseline PNGs alone can silently stay blank.
 *   2. **Horizontal clipping** — content overflows the printable area on
 *      the right edge (or bottom for extreme lengths) on Chrome/Edge,
 *      even though the on-screen preview looks fine.
 *
 * The single-scenario blank guard (`receipt-a4-print-blank-guard.spec.ts`)
 * only covers the *default* seed receipt at A4. This spec extends it into
 * a matrix so short, long, and extreme receipts are exercised on BOTH
 * A4 and US Letter without depending on additional seed data — the
 * scenarios synthesise line-item bulk by cloning existing DOM rows inside
 * every mounted `.pp-copy`, so length variance is deterministic.
 *
 * For every (pageSize × length) cell we assert:
 *   - Both copies (`.pp-copy` × 2) mount and remain visible.
 *   - The receipt raster is not uniformly white (ink-coverage floor).
 *   - No descendant of the receipt overflows the sheet's right edge by
 *     more than a 1px anti-aliasing tolerance (horizontal-clip guard).
 *   - The receipt's own `scrollWidth` fits inside its `clientWidth`
 *     (auto-scale + `overflow-wrap: anywhere` must have engaged for the
 *     extreme case).
 */

const RECEIPT_NO = "PAY-00001";

// 96 dpi rasterisation grid — matches Chrome's print pipeline.
const PAGE_SIZES = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
} as const;

type PageSize = keyof typeof PAGE_SIZES;

/**
 * How many synthetic body rows each `.pp-copy` should gain on top of its
 * baseline content. `short` = untouched seed receipt. `long` = spills
 * comfortably onto page 2. `extreme` = forces auto-scale / page-break
 * safety nets to engage.
 */
const LENGTH_SCENARIOS = {
  short: 0,
  long: 18,
  extreme: 60,
} as const;

type LengthScenario = keyof typeof LENGTH_SCENARIOS;

/** Ink-coverage floor — anything lower is effectively a blank sheet. */
const MIN_INK_COVERAGE = 0.06;

/** Horizontal overflow tolerance (px) — absorbs sub-pixel AA halos. */
const H_OVERFLOW_TOLERANCE_PX = 1.5;

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

/**
 * Bulk each `.pp-copy` up to the requested length. We clone an existing
 * inner block (the balance panel or the first `.pp-avoid-break`
 * grouping) N times so the additional content matches the real receipt's
 * typography and column widths — the goal is measuring layout, not
 * inventing new UI.
 */
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
        // Keep the clone visible even when the simplified-fallback CSS
        // hides ancillary content — we WANT this bulk to stress layout.
        clone
          .querySelectorAll(".pp-simplified-hide")
          .forEach((el) => el.classList.remove("pp-simplified-hide"));
        donor.parentElement?.insertBefore(clone, donor.nextSibling);
      }
    }
  }, extraBlocks);
}

async function measureOverflow(receipt: Locator) {
  return receipt.evaluate((el) => {
    const receiptRect = el.getBoundingClientRect();
    let worstDelta = 0;
    let culpritTag = "";
    for (const node of Array.from(el.querySelectorAll("*"))) {
      const r = (node as HTMLElement).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const delta = r.right - receiptRect.right;
      if (delta > worstDelta) {
        worstDelta = delta;
        culpritTag = (node as HTMLElement).tagName.toLowerCase();
      }
    }
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      worstDelta,
      culpritTag,
    };
  });
}

for (const pageSize of Object.keys(PAGE_SIZES) as PageSize[]) {
  for (const length of Object.keys(LENGTH_SCENARIOS) as LengthScenario[]) {
    test.describe(`PaymentReceipt — ${pageSize} × ${length}`, () => {
      test.skip(!authAvailable(), "requires an injected Lovable session");

      test(`is non-blank and not horizontally clipped (${pageSize}/${length})`, async ({
        context,
        page,
      }) => {
        const viewport = PAGE_SIZES[pageSize];
        await page.setViewportSize(viewport);
        await forceLight(page);
        await restoreSupabaseSession(context, page);
        await page.goto(`/receipt-fixture/${RECEIPT_NO}`, {
          waitUntil: "domcontentloaded",
        });

        const receipt = page.locator(".pp-zoom-wrap .pp-receipt").first();
        await expect(receipt, "Receipt mounts inside print preview").toBeVisible({
          timeout: 10_000,
        });

        const copies = receipt.locator(".pp-copy");
        await expect(copies, "Office + Client copies render").toHaveCount(2);

        // Inflate to the requested scenario size, then let fonts + images
        // settle so measurements + rasterisation are deterministic.
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
        await page.waitForTimeout(250);

        // Both copies still visible after bulking — a "vanished" copy
        // collapses to zero height when the parent flex/grid gives up.
        for (let i = 0; i < 2; i++) {
          const box = await copies.nth(i).boundingBox();
          expect(box, `Copy #${i} bounding box (${pageSize}/${length})`).not.toBeNull();
          expect(
            box!.height,
            `Copy #${i} must retain non-trivial height (${pageSize}/${length})`,
          ).toBeGreaterThan(80);
          expect(
            box!.width,
            `Copy #${i} must fill the sheet width (${pageSize}/${length})`,
          ).toBeGreaterThan(viewport.width * 0.7);
        }

        // Ink floor — the definitive blank/vanished-page detector.
        const coverage = await inkCoverage(receipt);
        expect(
          coverage,
          `${pageSize}/${length} raster is ${Math.round(coverage * 1000) / 10}% non-white — below the ${
            MIN_INK_COVERAGE * 100
          }% floor. Classic "printed a blank page" regression.`,
        ).toBeGreaterThan(MIN_INK_COVERAGE);

        // Horizontal-clip guard. `scrollWidth > clientWidth` means the
        // right edge overflows and Chrome/Edge will slice it off.
        const overflow = await measureOverflow(receipt);
        expect(
          overflow.scrollWidth,
          `Receipt scrollWidth (${overflow.scrollWidth}) must fit inside clientWidth (${overflow.clientWidth}) for ${pageSize}/${length}`,
        ).toBeLessThanOrEqual(overflow.clientWidth + H_OVERFLOW_TOLERANCE_PX);
        expect(
          overflow.worstDelta,
          `A <${overflow.culpritTag}> descendant overflowed the sheet right edge by ${overflow.worstDelta.toFixed(
            2,
          )}px (${pageSize}/${length}). Auto-scale / wrap safety net did not engage.`,
        ).toBeLessThanOrEqual(H_OVERFLOW_TOLERANCE_PX);
      });
    });
  }
}
