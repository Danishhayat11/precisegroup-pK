/**
 * Accessibility regression: <PrintPreviewModal>'s render-status chip is
 * the *only* signal a screen-reader user gets that the preview has moved
 * from "still laying out" to "safe to interact with / send to printer".
 * If either half of the announcement regresses — the chip loses its
 * aria-live wiring, the "Preparing preview…" phase never renders, or the
 * final "Ready · N page(s)" text drops the page count / pluralization —
 * AT users are left guessing.
 *
 * Contracts pinned:
 *   1. The chip element carries role="status", aria-live="polite", and
 *      aria-atomic="true" so the *whole* new text is announced on change
 *      (not just the diff). Without aria-atomic, VoiceOver / NVDA read
 *      partial updates when the icon swaps.
 *   2. While the modal is preparing, the chip's live-region text
 *      contains "Preparing preview…" (rendering phase announcement).
 *   3. Once ready, the chip's text flips to "Ready · N page(s)" with
 *      the correct pluralization — singular "1 page" for a short
 *      receipt, plural "N pages" (N ≥ 2) for a paginated long receipt —
 *      and the announced count matches the .pp-sheet count in the DOM.
 *
 * Runs against portrait mobile (390×844) because that's the tightest
 * layout and the one where the chip most often gets clipped / hidden
 * off-screen by regressions; the aria-live contract must hold there.
 *
 * Run:  bunx playwright test tests/a11y/print-modal-status-announcements.spec.ts
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";

test.use({
  viewport: { width: 390, height: 844 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

/**
 * The status chip is the aria-live region that contains either
 * "Preparing preview…" or "Ready · N page(s)" — never both. Scope by
 * text so we don't accidentally match the blank-preview helper (which
 * also uses role="status" + aria-live="polite" but never contains the
 * page-count phrase).
 */
function statusChip(page: Page): Locator {
  return page
    .locator('[role="status"][aria-live="polite"]')
    .filter({ hasText: /Preparing preview|Ready · \d+ page/i })
    .first();
}

async function openModal(page: Page, doc: string) {
  await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("open-modal").click();
  await expect(page.locator(".pp-sheet").first()).toBeAttached({ timeout: 15_000 });
}

test.describe("PrintPreviewModal — status chip aria-live announcements", () => {
  test('chip has role="status", aria-live="polite", and aria-atomic="true"', async ({ page }) => {
    await openModal(page, "receipt");
    const chip = statusChip(page);
    await expect(chip).toBeAttached({ timeout: 8_000 });

    // Confirm the accessibility wiring is intact so screen readers
    // actually announce the text changes we assert below.
    await expect(chip).toHaveAttribute("role", "status");
    await expect(chip).toHaveAttribute("aria-live", "polite");
    await expect(chip).toHaveAttribute(
      "aria-atomic",
      "true",
      // If this regresses, VoiceOver / NVDA will read only the delta
      // when the icon swaps, mangling "Ready · N page(s)".
    );
  });

  test('announces "Preparing preview…" during the rendering phase, then flips to "Ready · N page(s)"', async ({
    page,
  }) => {
    // Record every text mutation on the chip's live region from the
    // moment the modal mounts, so we can assert both phases were
    // announced even if the "Preparing" phase is short-lived.
    await page.goto(`${BASE}/test-print-modal?doc=long-receipt`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

    await page.evaluate(() => {
      (window as unknown as { __chipTexts: string[] }).__chipTexts = [];
      const seen = new Set<Element>();
      const record = (el: Element) => {
        const text = (el.textContent ?? "").trim();
        const bag = (window as unknown as { __chipTexts: string[] }).__chipTexts;
        if (text && bag[bag.length - 1] !== text) bag.push(text);
      };
      const attach = (el: Element) => {
        if (seen.has(el)) return;
        seen.add(el);
        record(el);
        new MutationObserver(() => record(el)).observe(el, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      };
      const scan = () => {
        document.querySelectorAll('[role="status"][aria-live="polite"]').forEach((el) => {
          const t = (el.textContent ?? "").trim();
          if (/Preparing preview|Ready · \d+ page/i.test(t)) attach(el);
        });
      };
      new MutationObserver(scan).observe(document.body, { subtree: true, childList: true });
      scan();
    });

    await page.getByTestId("open-modal").click();

    // Wait for the "Ready" announcement to land, then read back the
    // full history of chip texts and assert both phases were announced
    // in order.
    await expect(statusChip(page)).toHaveText(/Ready · \d+ page/i, { timeout: 10_000 });
    const history: string[] = await page.evaluate(
      () => (window as unknown as { __chipTexts: string[] }).__chipTexts ?? [],
    );

    const preparingIndex = history.findIndex((t) => /Preparing preview/i.test(t));
    const readyIndex = history.findIndex((t) => /Ready · \d+ page/i.test(t));
    expect(
      preparingIndex,
      `Expected chip to announce "Preparing preview…" at least once; history = ${JSON.stringify(history)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      readyIndex,
      `Expected chip to announce "Ready · N page(s)"; history = ${JSON.stringify(history)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      preparingIndex,
      `"Preparing preview…" must be announced BEFORE "Ready · N page(s)"; history = ${JSON.stringify(history)}`,
    ).toBeLessThan(readyIndex);
  });

  test('final "Ready" announcement uses singular "1 page" for a short receipt', async ({
    page,
  }) => {
    await openModal(page, "short-receipt");
    const chip = statusChip(page);
    await expect(chip).toHaveText(/^\s*Ready · 1 page\s*$/i, { timeout: 10_000 });

    // Cross-check: the announced count matches DOM reality.
    const sheetCount = await page.locator(".pp-sheet").count();
    expect(sheetCount, "short-receipt should render exactly 1 .pp-sheet").toBe(1);
  });

  test('final "Ready" announcement uses plural "N pages" for a paginated long receipt', async ({
    page,
  }) => {
    await openModal(page, "long-receipt");
    const chip = statusChip(page);
    await expect(chip).toHaveText(/Ready · \d+ pages$/i, { timeout: 10_000 });

    const text = (await chip.textContent())?.trim() ?? "";
    const match = text.match(/Ready · (\d+) pages/i);
    expect(match, `Expected plural "Ready · N pages" chip, got "${text}"`).not.toBeNull();
    const announced = Number(match![1]);
    expect(
      announced,
      `long-receipt should announce ≥ 2 pages, announced ${announced}`,
    ).toBeGreaterThanOrEqual(2);

    const sheetCount = await page.locator(".pp-sheet").count();
    expect(
      announced,
      `chip announced ${announced} pages but DOM has ${sheetCount} .pp-sheet elements — screen-reader users would hear the wrong count`,
    ).toBe(sheetCount);
  });
});
