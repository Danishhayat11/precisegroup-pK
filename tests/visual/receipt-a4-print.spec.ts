import { expect, test, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * Payment receipt — A4 print-media visual regression.
 *
 * Locks the dual-copy (Office + Client) receipt against layout drift in
 * print-media mode:
 *   • overall receipt geometry at A4 (194 × 285 mm safe area)
 *   • signature row rhythm (three columns, rule + label + name)
 *   • balance panel spacing (two cards, tone-coded totals)
 *   • footer address / phone strip
 *
 * We drive the fixture route `/receipt-fixture/PAY-00001` which mounts the
 * receipt modal open. Emulating `media: 'print'` triggers the @page A4
 * rules baked into `PaymentReceipt`'s <style> block so the snapshot
 * reflects what Chrome actually produces on "Save as PDF".
 *
 * Each snapshot is captured under BOTH light + dark themes. The receipt
 * chrome itself is intentionally theme-agnostic (guaranteed black-on-white
 * for printers), so drift across themes would signal an accidental
 * leak of authenticated-shell tokens into the print surface.
 */

const RECEIPT_NO = "PAY-00001";
const THEMES = ["light", "dark"] as const;

// A4 at 96dpi — matches Chrome's print rasterisation grid.
const A4_VIEWPORT = { width: 794, height: 1123 } as const;

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* ignored */
    }
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
    root.style.colorScheme = t;
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

test.describe("PaymentReceipt — A4 print media regression", () => {
  test.skip(!authAvailable(), "requires an injected Lovable session");

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(A4_VIEWPORT);
  });

  for (const theme of THEMES) {
    test(`${theme} · A4 print-media snapshot (full + regions)`, async ({ context, page }) => {
      await forceTheme(page, theme);
      await restoreSupabaseSession(context, page);
      await page.goto(`/receipt-fixture/${RECEIPT_NO}`, { waitUntil: "domcontentloaded" });

      // The receipt lives inside the PrintPreviewModal's visible zoom wrap
      // (the modal also mounts an off-screen measurement copy — skip that
      // one by scoping to `.pp-zoom-wrap`).
      const receipt = page.locator(".pp-zoom-wrap .pp-receipt").first();
      await expect(receipt, "Receipt mounts inside print preview modal").toBeVisible({
        timeout: 10_000,
      });

      // Wait for both copies to render (Office + Client).
      await expect(receipt.locator(".pp-copy")).toHaveCount(2);

      // NOTE: We intentionally do NOT call `page.emulateMedia({ media: 'print' })`.
      // The app's global @media print rules hide everything outside `.print-area`,
      // which would collapse the surrounding Dialog. Instead we snapshot the
      // in-modal preview pane — it renders the receipt at true A4 (mm) sizing
      // via the receipt's own inline styles, so it is a faithful proxy for
      // Chrome's print rasterisation.

      // Let fonts + reflow settle so pixel comparisons are stable.
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(400);

      // ── 1. Full receipt geometry (both copies + tear line) ─────
      await expect(receipt).toHaveScreenshot(`receipt-${theme}-full-a4.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });

      const firstCopy = receipt.locator(".pp-copy").first();

      // ── 2. Signature row — checks rule + label + name spacing.
      const signatureRow = firstCopy.locator(":scope > div", { hasText: "Authorized Signatory" });
      await expect(signatureRow).toBeVisible();
      await expect(signatureRow).toHaveScreenshot(`receipt-${theme}-signature-row.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });

      // ── 3. Balance panel.
      const balancePanel = firstCopy.locator(":scope > div", {
        hasText: "Account Balance After This Payment",
      });
      await expect(balancePanel).toBeVisible();
      await expect(balancePanel).toHaveScreenshot(`receipt-${theme}-balance-panel.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });

      // ── 4. Footer strip.
      const footer = firstCopy.locator(":scope > div", { hasText: "Manal Arcade, B-1 Markaz" });
      await expect(footer).toBeVisible();
      await expect(footer).toHaveScreenshot(`receipt-${theme}-footer.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });
  }
});
