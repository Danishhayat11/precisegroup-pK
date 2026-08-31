/**
 * End-to-end regression: after the print round-trip + Escape-close of
 * the print modal, focus must return to the exact element that
 * originally opened the modal (Radix Dialog's onCloseAutoFocus
 * contract). Verified for every printable document type so a
 * regression in any single template wrapper is caught.
 *
 * Flow per doc:
 *   1. Focus the "Open print modal" trigger explicitly so we know the
 *      pre-open active element.
 *   2. Open the modal via keyboard (Enter on the focused trigger).
 *   3. Mock window.print to fire `afterprint` synchronously and click
 *      Print. Wait for cleanup (runtime style removed).
 *   4. Press Escape to close the modal.
 *   5. Assert document.activeElement === the original trigger element
 *      (not <body>, not the Print button, not somewhere else in the
 *      page).
 *
 * Run:  bunx playwright test tests/a11y/print-focus-return.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const DOCS = ["receipt", "ledger", "plan", "notice", "statement"] as const;

async function installPrintMock(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __printCalls: number; print: () => void };
    w.__printCalls = 0;
    w.print = () => {
      w.__printCalls += 1;
      window.dispatchEvent(new Event("afterprint"));
    };
  });
}

test.describe("Focus returns to the opening trigger after print + Escape", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "pp-print-checklist-v1",
          JSON.stringify({ paper: true, margins: true, bg: true, scale: true, headers: true }),
        );
      } catch {
        /* ignore */
      }
    });
  });

  for (const doc of DOCS) {
    test(`focus returns to the trigger for doc="${doc}"`, async ({ page }) => {
      page.on("pageerror", () => {});

      await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "load" });
      await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

      const trigger = page.getByTestId("open-modal");
      await expect(trigger).toBeVisible({ timeout: 15_000 });

      // Tag the trigger so we can identify it from inside page.evaluate
      // *after* Radix restores focus to it.
      await trigger.evaluate((el) => {
        el.setAttribute("data-focus-tag", "opener");
      });

      // Pre-open active element: the trigger itself.
      await trigger.focus();
      const focusedBefore = await page.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.getAttribute("data-focus-tag") ?? null,
      );
      expect(focusedBefore).toBe("opener");

      // Open the modal via keyboard so we are exercising the same
      // a11y path a screen-reader user would.
      await page.keyboard.press("Enter");

      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });

      // Run the real print flow with mocked window.print.
      await installPrintMock(page);
      await printBtn.click();
      await expect
        .poll(
          async () =>
            page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
          { timeout: 5_000 },
        )
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(async () => page.evaluate(() => !!document.getElementById("pp-print-runtime")), {
          timeout: 3_000,
        })
        .toBe(false);

      // Close the modal via Escape (Radix Dialog's documented close path).
      await page.keyboard.press("Escape");

      // Dialog must actually be gone before we read focus.
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });

      // Focus must be back on the original trigger element. Compare by
      // the tag we attached, not by selector match, to guarantee it is
      // literally the same DOM node — not a re-rendered sibling.
      const focusInfo = await page.evaluate(() => {
        const ae = document.activeElement as HTMLElement | null;
        return {
          tag: ae?.getAttribute("data-focus-tag") ?? null,
          isBody: !ae || ae === document.body,
          tagName: ae?.tagName ?? null,
        };
      });
      expect(
        focusInfo.isBody,
        `focus fell back to <body> after Escape for doc=${doc} (tagName=${focusInfo.tagName})`,
      ).toBe(false);
      expect(focusInfo.tag, `focus did not return to the opening trigger for doc=${doc}`).toBe(
        "opener",
      );
    });
  }
});
