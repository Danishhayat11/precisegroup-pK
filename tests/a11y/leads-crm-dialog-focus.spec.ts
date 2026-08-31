import { expect, test } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

/**
 * LeadsCRM AlertDialog focus-management regression.
 *
 * Contracts under test
 * --------------------
 * Every AlertDialog on /leads must:
 *   1. Move focus INSIDE the dialog on open (Radix FocusScope contract).
 *   2. Trap Tab / Shift+Tab within the dialog while open — cycling
 *      focus never escapes to underlying page controls.
 *   3. Return focus to the EXACT triggering control after close, via
 *      either the trigger's own <AlertDialogTrigger> contract (Delete
 *      lead button) or our `onCloseAutoFocus` + `stageTriggerRef`
 *      restoration (per-card stage Select).
 *
 * Two dialogs, two close paths
 * ----------------------------
 * We cover the two entry points that historically regressed:
 *   • Delete lead — opened via <AlertDialogTrigger> icon button on
 *     the Kanban card, closed via Escape.
 *   • Stage-change confirmation — opened by choosing a different stage
 *     from the per-card Select (no natural Trigger button), closed
 *     via the Cancel button. The custom `onCloseAutoFocus` restoration
 *     is the reason this test exists.
 *
 * Skips
 * -----
 * Requires a live Supabase session for /leads and at least one lead in
 * the pipeline. When neither is available the test is skipped loudly
 * rather than producing a false red.
 */

test.describe("LeadsCRM AlertDialogs — focus trap + return", () => {
  test.beforeEach(async ({ context, page }) => {
    test.skip(
      !authAvailable(),
      'Skipped: LOVABLE_BROWSER_AUTH_STATUS is not "injected". Sign in via the preview so /leads renders.',
    );
    await restoreSupabaseSession(context, page);
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(500);

    if (page.url().includes("/auth") || page.url().includes("/login")) {
      throw new Error(`Expected /leads but got ${page.url()} — auth gate rejected the session.`);
    }

    // Require at least one lead card to interact with — otherwise
    // there's nothing to open a dialog from.
    const anyDelete = page.getByRole("button", { name: /^Delete lead / }).first();
    const hasLeads = await anyDelete.count();
    test.skip(
      hasLeads === 0,
      "Skipped: /leads is empty in this environment. Seed at least one lead to exercise dialog focus flows.",
    );
  });

  test("Delete lead dialog — focus trap + return to trigger button", async ({ page }) => {
    // Grab the trigger button that opens the dialog.
    const trigger = page.getByRole("button", { name: /^Delete lead / }).first();
    await trigger.focus();
    await expect(trigger).toBeFocused();

    // Snapshot the exact DOM node behind the trigger so we can compare
    // element identity (not just role/name) after the dialog closes.
    const triggerHandle = await trigger.elementHandle();
    expect(triggerHandle).not.toBeNull();

    await trigger.click();

    // 1. Focus lands inside the dialog. Radix moves focus to the first
    //    focusable descendant, which is Cancel by default for AlertDialog.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const confirm = dialog.getByRole("button", { name: "Delete" });
    await expect(cancel).toBeFocused();

    // 2. Tab cycles within the dialog: Cancel → Delete → Cancel.
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();

    // 2b. Shift+Tab cycles backwards without escaping the trap.
    await page.keyboard.press("Shift+Tab");
    await expect(confirm).toBeFocused();

    // 3. Escape closes and focus returns to the exact trigger element.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Compare active element by node identity — the same button, not
    // just another button with the same accessible name.
    const isSameNode = await page.evaluate((el) => document.activeElement === el, triggerHandle);
    expect(isSameNode, "focus should return to the exact Delete trigger button").toBe(true);
  });

  test("Stage-change confirmation — focus trap + return to originating Select", async ({
    page,
  }) => {
    // Find the stage Select on the first non-converted card. Its
    // accessible name is `Move <name> to another stage. Currently <stage>.`
    const stageSelect = page.getByRole("combobox", { name: /^Move .* to another stage/ }).first();
    const hasSelect = await stageSelect.count();
    test.skip(
      hasSelect === 0,
      "Skipped: no per-card stage Select rendered (all leads converted, or Kanban view not the default).",
    );

    await stageSelect.focus();
    await expect(stageSelect).toBeFocused();
    const selectHandle = await stageSelect.elementHandle();

    // Open the Select popover and pick a stage that differs from the
    // current one — Radix Select emits `onValueChange` which we route
    // through `requestStageChange` → confirmation dialog.
    await stageSelect.click();
    // The listbox is portalled; wait for it before picking an option.
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();

    // Pick the first option whose text differs from the trigger's text.
    const currentLabel = (await stageSelect.textContent())?.trim() ?? "";
    const options = listbox.getByRole("option");
    const optionCount = await options.count();
    let picked = false;
    for (let i = 0; i < optionCount; i++) {
      const opt = options.nth(i);
      const label = (await opt.textContent())?.trim() ?? "";
      // Skip "Booking Done" — it triggers the convert-to-Booking flow
      // (different dialog) and navigates away.
      if (label && label !== currentLabel && label !== "Booking Done") {
        await opt.click();
        picked = true;
        break;
      }
    }
    test.skip(!picked, "Skipped: no alternate stage available to trigger confirmation.");

    // 1. AlertDialog appears with focus inside it.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const confirm = dialog.getByRole("button", { name: /^Confirm move|^Mark Lost$/ });
    await expect(cancel).toBeFocused();

    // 2. Focus trap: Tab cycles between Cancel and the confirm action.
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();

    // 3. Cancel closes the dialog and focus returns to the ORIGINATING
    //    Select trigger — the whole point of `stageTriggerRef` +
    //    `onCloseAutoFocus`. Without that restoration, focus would
    //    land on <body> because the Select portal had already unmounted
    //    by the time the dialog opened.
    await cancel.click();
    await expect(dialog).toBeHidden();

    const isSameNode = await page.evaluate((el) => document.activeElement === el, selectHandle);
    expect(
      isSameNode,
      "focus should return to the exact Select trigger that opened the confirmation",
    ).toBe(true);
  });
});
