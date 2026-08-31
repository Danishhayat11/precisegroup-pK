/**
 * End-to-end regression: when the user cancels the browser print dialog
 * (so `afterprint` NEVER fires), `preparePrint()`'s 12s safety-timeout
 * must run cleanup and the print modal's focus trap + keyboard
 * navigation must remain fully usable — for every printable document
 * type.
 *
 * Flow per doc:
 *   1. page.clock.install() so we can deterministically advance time.
 *   2. Open the modal, install a window.print() mock that records the
 *      call but does NOT dispatch `afterprint` (the cancel path).
 *   3. Click Print. Confirm the runtime style + "Preparing for print…"
 *      toast are present (cleanup hasn't run yet).
 *   4. clock.fastForward(13_000) to trip the safety timer.
 *   5. Assert cleanup ran: runtime style gone, toast gone, title
 *      restored, Print button re-enabled.
 *   6. Assert the dialog is still open and the focus trap is intact:
 *        - focus is inside the dialog (not <body>)
 *        - Tab and Shift+Tab cycle through dialog tab-stops without
 *          escaping to page chrome
 *        - Escape closes the dialog
 *        - a stray afterprint dispatch after cleanup is a no-op (no
 *          re-injected style, no resurrected toast)
 *
 * Run:  bunx playwright test tests/a11y/print-cancel-focus-trap.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const TOAST_LABEL = "Preparing for print…";
const DOCS = ["receipt", "ledger", "plan", "notice", "statement"] as const;

async function installCancelPrintMock(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __printCalls: number; print: () => void };
    w.__printCalls = 0;
    // The cancel path: print() is called but the browser never fires
    // afterprint (user clicked Cancel in the print dialog).
    w.print = () => {
      w.__printCalls += 1;
    };
  });
}

async function tabStopsInsideDialog(page: Page): Promise<number> {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return 0;
    const sel = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    return dlg.querySelectorAll(sel).length;
  });
}

async function focusInfo(page: Page) {
  return page.evaluate(() => {
    const ae = document.activeElement as HTMLElement | null;
    const dlg = document.querySelector('[role="dialog"]');
    return {
      isBody: !ae || ae === document.body,
      insideDialog: !!(dlg && ae && dlg.contains(ae)),
      tag: ae?.tagName ?? null,
      label: ae?.getAttribute("aria-label") ?? ae?.textContent?.trim().slice(0, 40) ?? null,
    };
  });
}

test.describe("Print cancel path: safety timeout cleans up + focus trap survives", () => {
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
    test(`cancel path → safety-timeout cleanup keeps focus trap usable for doc="${doc}"`, async ({
      page,
    }) => {
      page.on("pageerror", () => {});

      // Install the synthetic clock BEFORE navigation so preparePrint's
      // setTimeout(SAFETY_MS) is registered against the mocked clock.
      await page.clock.install();

      await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "load" });
      await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

      const titleBefore = await page.title();

      await page.getByTestId("open-modal").click();
      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });

      const tabStopsBefore = await tabStopsInsideDialog(page);
      expect(tabStopsBefore).toBeGreaterThan(1);

      await installCancelPrintMock(page);
      await printBtn.click();

      // window.print() was invoked but afterprint was not dispatched —
      // we are now sitting in the "user staring at the print dialog"
      // state. Cleanup MUST NOT have run yet.
      await expect
        .poll(
          async () =>
            page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
          { timeout: 5_000 },
        )
        .toBeGreaterThanOrEqual(1);

      const midStyle = await page.evaluate(() => !!document.getElementById("pp-print-runtime"));
      expect(midStyle, "runtime style should still be present during the cancel dwell").toBe(true);
      await expect(page.getByText(TOAST_LABEL).first()).toBeVisible();

      // Trip the 12s safety timer.
      await page.clock.fastForward(13_000);

      // Cleanup must have run synchronously off the timeout.
      await expect
        .poll(async () => page.evaluate(() => !!document.getElementById("pp-print-runtime")), {
          timeout: 3_000,
        })
        .toBe(false);
      await expect(page.getByText(TOAST_LABEL)).toHaveCount(0, { timeout: 3_000 });
      expect(await page.title()).toBe(titleBefore);

      // Print button must be fully re-enabled (no stuck disabled / aria-busy).
      const btnState = await printBtn.evaluate((el) => {
        const b = el as HTMLButtonElement;
        return {
          disabled: b.disabled,
          ariaDisabled: b.getAttribute("aria-disabled"),
          ariaBusy: b.getAttribute("aria-busy"),
        };
      });
      expect(btnState.disabled).toBe(false);
      expect(btnState.ariaDisabled === null || btnState.ariaDisabled === "false").toBe(true);
      expect(btnState.ariaBusy === null || btnState.ariaBusy === "false").toBe(true);

      // Dialog still mounted, focus trap still in place: focus is inside
      // the dialog, not on <body>.
      await expect(page.getByRole("dialog")).toHaveCount(1);
      const f1 = await focusInfo(page);
      expect(f1.isBody, `focus fell to <body> after cancel-path cleanup for doc=${doc}`).toBe(
        false,
      );
      expect(f1.insideDialog, `focus escaped dialog after cancel-path cleanup for doc=${doc}`).toBe(
        true,
      );

      // Tab-stops inside the dialog must still match the pre-print set
      // (no stop got removed or duplicated by cleanup).
      const tabStopsAfter = await tabStopsInsideDialog(page);
      expect(tabStopsAfter).toBe(tabStopsBefore);

      // Keyboard navigation: Tab and Shift+Tab cycle without escaping
      // the dialog. Do a few rounds in each direction.
      for (let i = 0; i < Math.min(tabStopsAfter + 2, 8); i++) {
        await page.keyboard.press("Tab");
        const fi = await focusInfo(page);
        expect(fi.insideDialog, `Tab #${i} escaped dialog after cancel cleanup`).toBe(true);
        expect(fi.isBody).toBe(false);
      }
      for (let i = 0; i < Math.min(tabStopsAfter + 2, 8); i++) {
        await page.keyboard.press("Shift+Tab");
        const fi = await focusInfo(page);
        expect(fi.insideDialog, `Shift+Tab #${i} escaped dialog after cancel cleanup`).toBe(true);
        expect(fi.isBody).toBe(false);
      }

      // A stray afterprint dispatched *after* the safety cleanup must be
      // a no-op (proves the listener was detached, not just neutered).
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      expect(await page.evaluate(() => !!document.getElementById("pp-print-runtime"))).toBe(false);
      await expect(page.getByText(TOAST_LABEL)).toHaveCount(0);

      // Escape still closes the dialog and focus must not land on <body>.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });
      const fAfterClose = await focusInfo(page);
      expect(fAfterClose.isBody, "focus fell to <body> after Escape").toBe(false);
    });
  }
});
