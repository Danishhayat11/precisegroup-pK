import { expect, test, type Page } from "@playwright/test";

/**
 * Keyboard-only theme toggle flow.
 *
 * Radix DropdownMenu exposes `aria-expanded` and `aria-haspopup` on the
 * trigger, plus `role="menuitemradio"` items with `aria-checked` inside a
 * `role="menu"` popover. This test drives the whole interaction from the
 * keyboard — no `.click()` calls on the toggle or the items — and asserts:
 *
 *   1. Tab moves focus onto the header ThemeToggle trigger.
 *   2. Trigger starts with aria-expanded="false".
 *   3. Enter opens the menu → aria-expanded="true", focus lands inside the menu.
 *   4. ArrowDown moves focus between menuitemradio rows in DOM order
 *      (Light → Dark → System).
 *   5. Enter on "Dark" selects it: menu closes, aria-expanded flips back to
 *      "false", focus returns to the trigger (Radix default), <html> gains
 *      the `dark` class, and localStorage persists `"dark"`.
 *
 * Runs on /site so the marketing header (which mounts ThemeToggle) is present.
 * Starts in a fresh context with `colorScheme: 'light'` so the initial
 * resolved theme is deterministic and switching to Dark is an observable change.
 */

const STORAGE_KEY = "precise.theme";

async function focusThemeTrigger(page: Page) {
  // Programmatically focus the visible header trigger so the test isn't
  // coupled to the exact number of Tab presses (which varies with skip-links,
  // logo links, and nav items across breakpoints). We still exercise
  // keyboard-only interaction from that point forward.
  const trigger = page.locator('header button[aria-label*="Change theme"]:visible').first();
  await expect(trigger, "header ThemeToggle trigger must be visible").toBeVisible();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  return trigger;
}

test("keyboard: opens theme menu, navigates items, selects Dark, focus returns", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "light" });
  try {
    const page = await context.newPage();
    await page.goto("/site", { waitUntil: "load" });
    // Full hydration must land before keyboard input reaches Radix listeners;
    // pressing Enter during the SSR-to-hydrated gap is a no-op and the menu
    // stays closed (same gotcha as the mouse-driven theme-toggle spec).
    await page.waitForLoadState("networkidle");

    // Clean slate — no persisted theme, so system (light) is the starting point.
    await page.evaluate((k) => window.localStorage.removeItem(k), STORAGE_KEY);
    await page.reload({ waitUntil: "load" });
    await page.waitForLoadState("networkidle");

    const html = page.locator("html");
    await expect(html, "starts in light before user interacts").not.toHaveClass(/(^|\s)dark(\s|$)/);

    const trigger = await focusThemeTrigger(page);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toHaveAttribute("aria-haspopup", /menu|true/);

    // Enter opens the Radix menu. Retry across the hydration gap — bounded so
    // a real regression still fails quickly.
    await expect(async () => {
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveAttribute("data-state", "open", { timeout: 500 });
    }).toPass({ intervals: [100, 200, 400, 800], timeout: 5000 });
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const menu = page.locator('[role="menu"]').filter({ hasText: "Appearance" });
    await expect(menu, "dropdown menu opens after Enter").toBeVisible();

    const items = menu.locator('[role="menuitemradio"]');
    await expect(items).toHaveCount(3);

    // Radix focuses the first item on open.
    const lightItem = items.nth(0);
    const darkItem = items.nth(1);
    const systemItem = items.nth(2);
    await expect(lightItem).toContainText("Light");
    await expect(darkItem).toContainText("Dark");
    await expect(systemItem).toContainText("System");
    await expect(lightItem).toBeFocused();

    // Arrow keys walk items in DOM order.
    await page.keyboard.press("ArrowDown");
    await expect(darkItem).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(systemItem).toBeFocused();

    // Wrap-around / walk back up to Dark to prove ArrowUp also works.
    await page.keyboard.press("ArrowUp");
    await expect(darkItem).toBeFocused();

    // aria-checked reflects current selection BEFORE we commit.
    await expect(lightItem).toHaveAttribute("aria-checked", "false");
    await expect(darkItem).toHaveAttribute("aria-checked", "false");
    await expect(systemItem).toHaveAttribute("aria-checked", "true");

    // Commit the selection with Enter — menu closes, focus returns to trigger.
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger, "focus returns to trigger after selection").toBeFocused();

    // Effects: <html class="dark"> flips and the choice persists.
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBe("dark");

    // Reopen with Space (the other documented activator) and verify the new
    // aria-checked state is on Dark now.
    await page.keyboard.press(" ");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();
    await expect(items.nth(1)).toHaveAttribute("aria-checked", "true");

    // Escape closes and restores focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});
