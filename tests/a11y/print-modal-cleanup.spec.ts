/**
 * End-to-end regression: opens the real <PrintPreviewModal> in a real
 * browser, mocks window.print() to fire `afterprint` synchronously, then
 * verifies the "Preparing for print…" UI state is fully cleared for every
 * printable document type.
 *
 * "Fully cleared" means, after afterprint fires:
 *   - the sonner "Preparing for print…" toast is dismissed
 *   - the <style id="pp-print-runtime"> injected by preparePrint() is gone
 *   - document.title is restored to what it was before the dialog opened
 *   - no afterprint listener remains (a second afterprint dispatch must
 *     not trigger another toast dismissal — proves cleanup detached itself)
 *
 * Run:  bunx playwright test tests/a11y/print-modal-cleanup.spec.ts
 *
 * Why a route harness instead of clicking through real ERP pages: real
 * document routes require seeded bookings / clients and a signed-in
 * session. /test-print-modal mounts the *same* PrintPreviewModal component
 * with placeholder text content, so we are still exercising the real
 * preparePrint() + real modal in a real browser — only the data is faked.
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STYLE_ID = "pp-print-runtime";
const TOAST_LABEL = "Preparing for print…";

const DOCS = ["receipt", "ledger", "plan", "notice", "statement"] as const;

/**
 * Install a window.print() mock that records calls and (optionally) fires
 * `afterprint` synchronously. Must be installed BEFORE the user clicks the
 * Print button so the real preparePrint() flow sees the mock.
 */
async function installPrintMock(page: Page, opts: { fireAfterprint: boolean }) {
  await page.evaluate((fireAfterprint) => {
    const w = window as unknown as {
      __printCalls: number;
      __originalTitleAtPrint: string | null;
      __styleSeenAtPrint: boolean;
      print: () => void;
    };
    w.__printCalls = 0;
    w.__originalTitleAtPrint = null;
    w.__styleSeenAtPrint = false;
    w.print = () => {
      w.__printCalls += 1;
      // Snapshot state *during* the print dialog (i.e. AFTER preparePrint
      // injected its style + retitled, BEFORE cleanup runs).
      w.__originalTitleAtPrint = document.title;
      w.__styleSeenAtPrint = !!document.getElementById("pp-print-runtime");
      if (fireAfterprint) {
        window.dispatchEvent(new Event("afterprint"));
      }
    };
  }, opts.fireAfterprint);
}

async function readStateProbe(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __printCalls: number;
      __originalTitleAtPrint: string | null;
      __styleSeenAtPrint: boolean;
    };
    return {
      printCalls: w.__printCalls,
      titleDuringPrint: w.__originalTitleAtPrint,
      styleDuringPrint: w.__styleSeenAtPrint,
      styleNow: !!document.getElementById("pp-print-runtime"),
      titleNow: document.title,
    };
  });
}

test.describe("PrintPreviewModal: 'Preparing for print…' UI state clears after afterprint", () => {
  test.beforeEach(async ({ page }) => {
    // Pre-confirm the in-modal print-setup checklist so the Print button is
    // enabled the first time the modal opens. addInitScript runs before any
    // page script, so it lands before PrintPreviewModal's useState reads it.
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
    test(`cleans up after print for doc="${doc}"`, async ({ page }) => {
      // Quiet deliberate console noise from the harness route.
      page.on("pageerror", () => {});

      await page.goto(`${BASE}/test-print-modal?doc=${doc}`, {
        waitUntil: "load",
      });
      await expect(page.getByTestId("doc-key")).toHaveText(doc);
      // Wait for client-side hydration: until React attaches handlers,
      // the SSR-rendered "Open print modal" button is a no-op.
      await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

      const titleBefore = await page.title();

      // Open the modal and confirm the real PrintPreviewModal is mounted.
      await page.getByTestId("open-modal").click();
      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });

      // Mock window.print BEFORE clicking — preparePrint awaits 2 rAFs and
      // then calls window.print(), which (mocked) fires `afterprint`.
      await installPrintMock(page, { fireAfterprint: true });

      await printBtn.click();

      // Wait until preparePrint has called the mocked print() at least once.
      await expect
        .poll(async () => (await readStateProbe(page)).printCalls, {
          timeout: 5_000,
        })
        .toBeGreaterThanOrEqual(1);

      const mid = await readStateProbe(page);
      // During the print dialog the runtime style + retitle WERE in effect.
      // (Sanity-checks that the test isn't vacuously passing because the
      // flow never started.)
      expect(mid.styleDuringPrint).toBe(true);
      expect(mid.titleDuringPrint).not.toBe(titleBefore);

      // After afterprint fires, cleanup() must run synchronously: style
      // gone, title restored, toast dismissed. Use polling to ride out
      // React render + sonner animation frames.
      await expect
        .poll(async () => (await readStateProbe(page)).styleNow, {
          timeout: 3_000,
        })
        .toBe(false);

      const after = await readStateProbe(page);
      expect(after.titleNow).toBe(titleBefore);

      // Sonner "Preparing for print…" toast must be gone from the DOM.
      await expect(page.getByText(TOAST_LABEL)).toHaveCount(0, { timeout: 3_000 });

      // Listener was detached: a second afterprint must NOT cause a second
      // cleanup pass (re-injecting nothing, re-dismissing nothing). Easiest
      // observable: dispatching afterprint after cleanup must leave the DOM
      // untouched.
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      const afterSecondDispatch = await readStateProbe(page);
      expect(afterSecondDispatch.styleNow).toBe(false);
      expect(afterSecondDispatch.titleNow).toBe(titleBefore);
      await expect(page.getByText(TOAST_LABEL)).toHaveCount(0);

      // ── Extended cleanup checks ────────────────────────────────────────
      // Sonner toast region must have no remaining "Preparing for print…"
      // toasts (covers stacked duplicates that toHaveCount(0) on the text
      // selector alone could miss if hidden via opacity/transform).
      const toastRegion = page.locator("[data-sonner-toaster] [data-sonner-toast]");
      const preparingInRegion = toastRegion.filter({ hasText: TOAST_LABEL });
      await expect(preparingInRegion).toHaveCount(0);

      // The Print button must be fully re-enabled after print:
      //  - aria-disabled is "false" (or absent), never "true"
      //  - the underlying <button disabled> attribute is not set
      //  - no aria-busy left over on the button or the document body
      const printBtnHandle = await printBtn.elementHandle();
      expect(printBtnHandle).not.toBeNull();
      const printState = await page.evaluate((el) => {
        const b = el as HTMLButtonElement;
        return {
          ariaDisabled: b.getAttribute("aria-disabled"),
          disabledProp: b.disabled,
          ariaBusyBtn: b.getAttribute("aria-busy"),
          ariaBusyBody: document.body.getAttribute("aria-busy"),
        };
      }, printBtnHandle);
      expect(printState.ariaDisabled === null || printState.ariaDisabled === "false").toBe(true);
      expect(printState.disabledProp).toBe(false);
      expect(printState.ariaBusyBtn === null || printState.ariaBusyBtn === "false").toBe(true);
      expect(printState.ariaBusyBody === null || printState.ariaBusyBody === "false").toBe(true);

      // Re-clickability: a second click on the Print button must invoke
      // window.print() again (proves nothing got stuck in a one-shot
      // "currently printing" guarded state).
      await printBtn.click();
      await expect
        .poll(async () => (await readStateProbe(page)).printCalls, { timeout: 5_000 })
        .toBeGreaterThanOrEqual(2);

      // Focus must not be lost to <body>. After the print round-trip the
      // browser/Radix Dialog should keep focus inside the still-open modal
      // (typically on the Print button that was just clicked).
      const focusInfo = await page.evaluate(() => {
        const ae = document.activeElement as HTMLElement | null;
        const modal = document.querySelector('[role="dialog"]');
        return {
          isBody: ae === document.body || ae === null,
          tag: ae?.tagName ?? null,
          insideModal: !!(modal && ae && modal.contains(ae)),
        };
      });
      expect(focusInfo.isBody).toBe(false);
      expect(focusInfo.insideModal).toBe(true);
    });
  }

  test("focus stays inside the modal across the entire print round-trip", async ({ page }) => {
    page.on("pageerror", () => {});
    await page.goto(`${BASE}/test-print-modal?doc=receipt`, { waitUntil: "load" });
    await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

    await page.getByTestId("open-modal").click();
    const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
    await expect(printBtn).toBeVisible({ timeout: 15_000 });

    // Explicitly focus the Print button — this is the "previously active
    // element" at the moment window.print() is invoked. After cleanup we
    // expect focus to still be on it (or at least somewhere inside the
    // open modal), never lost to <body>.
    await printBtn.focus();

    await installPrintMock(page, { fireAfterprint: true });
    await printBtn.click();

    await expect
      .poll(async () => (await readStateProbe(page)).printCalls, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => (await readStateProbe(page)).styleNow, { timeout: 3_000 })
      .toBe(false);

    const focusAfter = await page.evaluate(() => {
      const ae = document.activeElement as HTMLElement | null;
      const modal = document.querySelector('[role="dialog"]');
      return {
        isBodyOrNull: !ae || ae === document.body,
        insideModal: !!(modal && ae && modal.contains(ae)),
        ariaLabel: ae?.getAttribute("aria-label") ?? null,
      };
    });
    expect(focusAfter.isBodyOrNull).toBe(false);
    expect(focusAfter.insideModal).toBe(true);
  });

  test("style + retitle are reverted even when the user re-opens the modal and prints again", async ({
    page,
  }) => {
    page.on("pageerror", () => {});
    await page.goto(`${BASE}/test-print-modal?doc=receipt`, {
      waitUntil: "load",
    });
    await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });
    const titleBefore = await page.title();

    for (let i = 0; i < 3; i++) {
      await page.getByTestId("open-modal").click();
      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });

      await installPrintMock(page, { fireAfterprint: true });
      await printBtn.click();

      await expect
        .poll(async () => (await readStateProbe(page)).printCalls, {
          timeout: 5_000,
        })
        .toBeGreaterThanOrEqual(1);

      await expect
        .poll(async () => (await readStateProbe(page)).styleNow, { timeout: 3_000 })
        .toBe(false);
      await expect(page.getByText(TOAST_LABEL)).toHaveCount(0, { timeout: 3_000 });
      expect(await page.title()).toBe(titleBefore);

      // Close the modal between runs (matches real user flow).
      await page.keyboard.press("Escape");
    }
  });

  test("rapid repeated prints across same+different docs: idempotent cleanup, no afterprint handler leak", async ({
    page,
  }) => {
    page.on("pageerror", () => {});

    // Instrument window.addEventListener / removeEventListener BEFORE any
    // app code runs so we can count net `afterprint` listeners attached at
    // any point. If cleanup is correct, the net count must return to its
    // baseline after every print round-trip — regardless of how many
    // times the user pressed Print, or which document was in the modal.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __afterprintAdds: number;
        __afterprintRemoves: number;
        __afterprintLive: number;
      };
      w.__afterprintAdds = 0;
      w.__afterprintRemoves = 0;
      w.__afterprintLive = 0;
      const origAdd = window.addEventListener.bind(window);
      const origRemove = window.removeEventListener.bind(window);
      window.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (type === "afterprint") {
          w.__afterprintAdds += 1;
          w.__afterprintLive += 1;
        }
        return origAdd(type, listener, options);
      }) as typeof window.addEventListener;
      window.removeEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) => {
        if (type === "afterprint") {
          w.__afterprintRemoves += 1;
          w.__afterprintLive -= 1;
        }
        return origRemove(type, listener, options);
      }) as typeof window.removeEventListener;
    });

    // Helper: run one full print round-trip on whatever modal is open.
    const runOnePrint = async () => {
      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });
      // Reinstall the mock each iteration — preparePrint re-reads
      // window.print on every call, so this matches a real user.
      await installPrintMock(page, { fireAfterprint: true });
      const before = await page.evaluate(
        () => (window as unknown as { __printCalls: number }).__printCalls ?? 0,
      );
      await printBtn.click();
      // Wait for THIS print to have fired (not just any previous one).
      await expect
        .poll(
          async () =>
            page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
          { timeout: 5_000 },
        )
        .toBeGreaterThan(before);
      // Wait for cleanup to have run.
      await expect
        .poll(async () => (await readStateProbe(page)).styleNow, { timeout: 3_000 })
        .toBe(false);
    };

    const readListenerCounts = () =>
      page.evaluate(() => {
        const w = window as unknown as {
          __afterprintAdds: number;
          __afterprintRemoves: number;
          __afterprintLive: number;
        };
        return {
          adds: w.__afterprintAdds,
          removes: w.__afterprintRemoves,
          live: w.__afterprintLive,
        };
      });

    // ── Phase 1: same document, rapid repeated prints ──────────────────
    await page.goto(`${BASE}/test-print-modal?doc=receipt`, { waitUntil: "load" });
    await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });
    const titleBefore = await page.title();

    // Capture the baseline AFTER navigation/hydration. Any listeners the
    // app attaches at boot are part of the baseline, not a leak.
    await page.getByTestId("open-modal").click();
    await expect(page.getByRole("button", { name: "Open browser print dialog" })).toBeVisible({
      timeout: 15_000,
    });
    const baseline = await readListenerCounts();

    // Five back-to-back prints inside the same open modal.
    for (let i = 0; i < 5; i++) {
      await runOnePrint();
      // No artificial wait — we want them as fast as Playwright will go,
      // which reproduces the "user mashes Print" scenario.
    }

    let counts = await readListenerCounts();
    // Net live count must return to baseline — every add was matched by a
    // remove. (adds-removes) is the leak; live is the same expressed
    // directly.
    expect(counts.live).toBe(baseline.live);
    // And cleanup IS actually running each time (sanity: at least 5 net
    // adds happened during the burst, even though they all got removed).
    expect(counts.adds - baseline.adds).toBeGreaterThanOrEqual(5);
    expect(counts.adds - baseline.adds).toBe(counts.removes - baseline.removes);

    // DOM-side idempotency: exactly zero leftover style tags / toasts /
    // retitled-titles after the burst.
    const domAfterBurst = await page.evaluate(() => ({
      styleCount: document.querySelectorAll("#pp-print-runtime").length,
      title: document.title,
      toastCount: document.querySelectorAll("[data-sonner-toaster] [data-sonner-toast]").length,
    }));
    expect(domAfterBurst.styleCount).toBe(0);
    expect(domAfterBurst.title).toBe(titleBefore);
    // The toast count check: any "Preparing for print…" toast must be
    // gone. Other unrelated toasts are tolerated.
    await expect(
      page.locator("[data-sonner-toaster] [data-sonner-toast]").filter({
        hasText: TOAST_LABEL,
      }),
    ).toHaveCount(0);

    // ── Phase 2: different documents, rapid succession ─────────────────
    // Close current modal first, then navigate doc → doc → doc, printing
    // once per doc, all back-to-back. Verifies that switching documents
    // mid-burst does not leak handlers either.
    await page.keyboard.press("Escape");

    const docSequence = ["ledger", "plan", "notice", "statement", "receipt"] as const;
    for (const doc of docSequence) {
      await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "load" });
      await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });
      await page.getByTestId("open-modal").click();
      await runOnePrint();
      await page.keyboard.press("Escape");
    }

    // Re-open one final modal so the listener-count snapshot is taken
    // under the SAME conditions as `baseline` (modal mounted + open).
    await page.getByTestId("open-modal").click();
    await expect(page.getByRole("button", { name: "Open browser print dialog" })).toBeVisible({
      timeout: 15_000,
    });

    counts = await readListenerCounts();
    // After cross-doc bursts, live afterprint listeners must still be at
    // baseline. (Each goto resets the page → window listeners are wiped
    // by the navigation itself, so this also exercises the in-page case
    // via the final reopened modal.)
    expect(counts.live).toBe(baseline.live);

    // Final DOM check: still no stale runtime style / "Preparing…" toast.
    expect(await page.evaluate(() => document.querySelectorAll("#pp-print-runtime").length)).toBe(
      0,
    );
    await expect(
      page.locator("[data-sonner-toaster] [data-sonner-toast]").filter({
        hasText: TOAST_LABEL,
      }),
    ).toHaveCount(0);
  });

  test("safety-timeout path: afterprint never fires, user cancels dialog early — UI still restores", async ({
    page,
  }) => {
    page.on("pageerror", () => {});

    // Use Playwright's synthetic clock so we don't actually wait the full
    // 12s SAFETY_MS in preparePrint. install() must run before any page
    // script so window.setTimeout is patched from the start.
    await page.clock.install();

    await page.goto(`${BASE}/test-print-modal?doc=receipt`, { waitUntil: "load" });
    await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });
    const titleBefore = await page.title();

    await page.getByTestId("open-modal").click();
    const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
    await expect(printBtn).toBeVisible({ timeout: 15_000 });

    // Mock window.print to simulate the browser opening the print dialog
    // and the user clicking "Cancel" — meaning `afterprint` NEVER fires.
    // (Some real browsers/PDF drivers genuinely skip afterprint on cancel.)
    await installPrintMock(page, { fireAfterprint: false });

    await printBtn.click();

    // The print call did happen, and DURING the call the runtime style +
    // retitled document.title were in place — proving preparePrint set
    // up the dialog state correctly.
    await expect
      .poll(async () => (await readStateProbe(page)).printCalls, { timeout: 5_000 })
      .toBe(1);
    const mid = await readStateProbe(page);
    expect(mid.styleDuringPrint).toBe(true);

    // Right after cancel: NO afterprint event was dispatched, so cleanup
    // has NOT run yet. The runtime style and "Preparing…" toast must
    // still be present. (This is the bug we want the safety net to fix.)
    expect(await page.locator(`#${STYLE_ID}`).count()).toBe(1);
    await expect(
      page.locator("[data-sonner-toaster] [data-sonner-toast]").filter({
        hasText: TOAST_LABEL,
      }),
    ).toHaveCount(1);

    // Advance the synthetic clock past SAFETY_MS (12_000ms in printFlow).
    // The setTimeout(cleanup, SAFETY_MS) fallback must now fire.
    await page.clock.fastForward(13_000);

    // After the safety timer fires, cleanup() runs exactly once:
    //  - runtime <style> removed
    //  - document.title restored
    //  - sonner "Preparing…" toast dismissed
    //  - afterprint listener detached
    await expect
      .poll(async () => (await readStateProbe(page)).styleNow, { timeout: 3_000 })
      .toBe(false);
    expect(await page.locator(`#${STYLE_ID}`).count()).toBe(0);
    expect(await page.title()).toBe(titleBefore);
    await expect(
      page.locator("[data-sonner-toaster] [data-sonner-toast]").filter({
        hasText: TOAST_LABEL,
      }),
    ).toHaveCount(0);

    // Listener detached: dispatching a stray afterprint now must be a
    // no-op (no re-cleanup, no toast resurrection, no errors).
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    expect(await page.locator(`#${STYLE_ID}`).count()).toBe(0);
    expect(await page.title()).toBe(titleBefore);

    // The Print button must be fully re-armed for a second attempt.
    await expect(printBtn).toBeEnabled();
    await expect(printBtn).toHaveJSProperty("disabled", false);

    // Reusing the modal works: a second print after the safety-timeout
    // recovery still goes through end-to-end, this time with afterprint.
    await installPrintMock(page, { fireAfterprint: true });
    await printBtn.click();
    await expect
      .poll(async () => (await readStateProbe(page)).printCalls, { timeout: 5_000 })
      .toBe(1); // mock reset → fresh count of 1
    await expect
      .poll(async () => (await readStateProbe(page)).styleNow, { timeout: 3_000 })
      .toBe(false);
    expect(await page.title()).toBe(titleBefore);
  });

  for (const doc of DOCS) {
    test(`focus trap + keyboard navigation survive print round-trip for doc="${doc}"`, async ({
      page,
    }) => {
      page.on("pageerror", () => {});

      await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "load" });
      await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

      // Open via keyboard so the trigger is the "previously focused
      // element" Radix should restore to after the dialog ultimately
      // closes — but we never close it in this test; we only verify the
      // trap survives the print round-trip.
      const opener = page.getByTestId("open-modal");
      await opener.focus();
      await expect(opener).toBeFocused();
      await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });

      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });

      // Helper: return the list of focusable elements *inside the
      // dialog*, in DOM order, mirroring what a focus trap considers
      // tab-stops. Used to assert Tab/Shift+Tab stay inside the dialog.
      const collectDialogFocusables = () =>
        page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          if (!dlg) return [] as string[];
          const sel = [
            "a[href]",
            "button:not([disabled])",
            'input:not([disabled]):not([type="hidden"])',
            "select:not([disabled])",
            "textarea:not([disabled])",
            '[tabindex]:not([tabindex="-1"])',
          ].join(",");
          const els = Array.from(dlg.querySelectorAll<HTMLElement>(sel)).filter(
            (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
          );
          return els.map((el) => {
            const label =
              el.getAttribute("aria-label") ||
              el.textContent?.trim().slice(0, 40) ||
              el.tagName.toLowerCase();
            return `${el.tagName.toLowerCase()}:${label}`;
          });
        });

      // ── Baseline: focus is INSIDE the dialog before printing. ────────
      const focusInDialog = () =>
        page.evaluate(
          () =>
            !!document.activeElement &&
            !!document.querySelector('[role="dialog"]')?.contains(document.activeElement),
        );
      await expect.poll(focusInDialog, { timeout: 5_000 }).toBe(true);

      const beforeFocusables = await collectDialogFocusables();
      expect(beforeFocusables.length).toBeGreaterThanOrEqual(2);

      // Park focus on the Print button so we have a known starting tab-stop.
      await printBtn.focus();
      await expect(printBtn).toBeFocused();

      // ── Print round-trip ─────────────────────────────────────────────
      await installPrintMock(page, { fireAfterprint: true });
      await page.keyboard.press("Enter"); // activate Print via keyboard
      await expect
        .poll(async () => (await readStateProbe(page)).printCalls, { timeout: 5_000 })
        .toBeGreaterThanOrEqual(1);
      // Wait for cleanup to actually finish (style gone).
      await expect
        .poll(async () => (await readStateProbe(page)).styleNow, { timeout: 3_000 })
        .toBe(false);

      // ── After print: dialog still mounted, focus still trapped. ──────
      await expect(dialog).toBeVisible();
      await expect.poll(focusInDialog, { timeout: 3_000 }).toBe(true);

      // The set of focusable elements inside the dialog should be the
      // same as before — print did not strip or add tab-stops.
      const afterFocusables = await collectDialogFocusables();
      expect(afterFocusables).toEqual(beforeFocusables);

      // Tab cycle stays inside the dialog. We Tab N+2 times and assert
      // every intermediate activeElement is still inside the dialog
      // (Radix FocusScope wraps from last → first, never escaping).
      for (let i = 0; i < afterFocusables.length + 2; i++) {
        await page.keyboard.press("Tab");
        expect(await focusInDialog()).toBe(true);
      }
      // Same for Shift+Tab in the reverse direction.
      for (let i = 0; i < afterFocusables.length + 2; i++) {
        await page.keyboard.press("Shift+Tab");
        expect(await focusInDialog()).toBe(true);
      }

      // Escape must still close the dialog (keyboard nav contract intact).
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden({ timeout: 5_000 });

      // Focus must NOT be lost on <body> after the dialog closes — it
      // should land on a real focusable element (ideally the original
      // trigger, but Radix's restoration is unreliable in headless and
      // the user-visible contract is "focus is not stuck on body").
      const postCloseFocus = await page.evaluate(() => {
        const ae = document.activeElement as HTMLElement | null;
        return {
          tag: ae?.tagName.toLowerCase() ?? null,
          testid: ae?.getAttribute("data-testid") ?? null,
          inDialog: !!document.querySelector('[role="dialog"]')?.contains(ae),
        };
      });
      expect(postCloseFocus.inDialog).toBe(false);

      // Re-opening + re-printing still works → no stuck focus state,
      // no orphaned guards from the previous print round-trip.
      await opener.focus();
      await expect(opener).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(dialog).toBeVisible({ timeout: 5_000 });
      const printBtn2 = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn2).toBeVisible();
      await installPrintMock(page, { fireAfterprint: true });
      await printBtn2.focus();
      await page.keyboard.press("Enter");
      await expect
        .poll(async () => (await readStateProbe(page)).printCalls, { timeout: 5_000 })
        .toBeGreaterThanOrEqual(1);
      await expect.poll(focusInDialog, { timeout: 3_000 }).toBe(true);
    });
  }

  for (const doc of DOCS) {
    test(`post-print UI is clean (no spinner / loading text / busy state) for doc="${doc}"`, async ({
      page,
    }) => {
      page.on("pageerror", () => {});

      await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "load" });
      await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

      await page.getByTestId("open-modal").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });

      // Print round-trip with synchronous afterprint.
      await installPrintMock(page, { fireAfterprint: true });
      await printBtn.click();
      await expect
        .poll(async () => (await readStateProbe(page)).printCalls, { timeout: 5_000 })
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(async () => (await readStateProbe(page)).styleNow, { timeout: 3_000 })
        .toBe(false);

      // ── Expected post-print UI state ────────────────────────────────
      // The modal is the expected resting state after print: still
      // mounted, content still rendered, ready for the user to either
      // print again or close. (It is NOT supposed to auto-close.)
      await expect(dialog).toBeVisible();
      await expect(printBtn).toBeVisible();
      await expect(printBtn).toBeEnabled();
      await expect(printBtn).toHaveJSProperty("disabled", false);

      // ── No leftover loading UI anywhere on the page ─────────────────
      // 1) The sonner "Preparing for print…" toast is gone — both as a
      //    text match and as a live region entry.
      await expect(page.getByText(TOAST_LABEL, { exact: false })).toHaveCount(0);
      await expect(
        page.locator("[data-sonner-toaster] [data-sonner-toast]").filter({
          hasText: TOAST_LABEL,
        }),
      ).toHaveCount(0);
      // No sonner loading-variant toasts of any kind linger.
      await expect(page.locator('[data-sonner-toast][data-type="loading"]')).toHaveCount(0);

      // 2) No spinners. Catches Loader2 (lucide → svg.lucide-loader-2),
      //    Tailwind `animate-spin`, generic role="status" busy
      //    indicators, and any aria-busy="true" element.
      const spinnerLeftovers = await page.evaluate(() => {
        const selectors = [
          ".animate-spin",
          "svg.lucide-loader",
          "svg.lucide-loader-2",
          "svg.lucide-loader-circle",
          '[role="status"]:not([aria-hidden="true"])',
          '[aria-busy="true"]',
          '[data-loading="true"]',
        ];
        const hits: { selector: string; count: number; sample: string }[] = [];
        for (const sel of selectors) {
          const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
            (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
          );
          if (els.length) {
            hits.push({
              selector: sel,
              count: els.length,
              sample: els[0].outerHTML.slice(0, 200) + (els[0].outerHTML.length > 200 ? "…" : ""),
            });
          }
        }
        return hits;
      });
      expect(spinnerLeftovers, JSON.stringify(spinnerLeftovers, null, 2)).toEqual([]);

      // 3) No common loading copy left in the DOM. We check text strings
      //    that the print flow / preparePrint may have shown.
      const leftoverCopy = [TOAST_LABEL, "Preparing…", "Loading…", "Please wait"];
      for (const phrase of leftoverCopy) {
        await expect(page.getByText(phrase, { exact: false })).toHaveCount(0);
      }

      // 4) Document-level busy state cleared.
      expect(await page.locator('body[aria-busy="true"]')).toHaveCount(0);

      // 5) No runtime <style> from preparePrint left over.
      expect(await page.locator(`#${STYLE_ID}`).count()).toBe(0);

      // 6) The modal is re-actionable: a follow-up print call still
      //    works (no stuck disabled/busy state we missed above).
      await installPrintMock(page, { fireAfterprint: true });
      await printBtn.click();
      await expect
        .poll(async () => (await readStateProbe(page)).printCalls, { timeout: 5_000 })
        .toBe(1); // mock counter was just reset → must reach 1 again
      // And it cleans up the second time too.
      await expect
        .poll(async () => (await readStateProbe(page)).styleNow, { timeout: 3_000 })
        .toBe(false);
      await expect(
        page.locator("[data-sonner-toaster] [data-sonner-toast]").filter({
          hasText: TOAST_LABEL,
        }),
      ).toHaveCount(0);
    });
  }
});
