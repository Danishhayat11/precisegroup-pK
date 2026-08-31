import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — Tab reachability + pointer (mouse & tap) open.
 *
 * Two contracts, both exercised in light + dark themes:
 *
 *   1. Tab reachability — the overflow trigger is part of the document
 *      tab ring, lands with :focus-visible, and Shift+Tab moves off it
 *      (no focus trap on the closed trigger).
 *   2. Pointer open — a plain mouse click AND a touch tap both open the
 *      menu, flip aria-expanded, and reveal at least one menuitem.
 *
 * Kept separate from `breadcrumbs-overflow-keyboard.spec.ts` (which
 * covers Tab → Space/Enter → Escape end-to-end) so a regression in
 * either surface surfaces as an obviously-named failure.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

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

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);
}

/**
 * Walk the document's tab ring until focus lands on the overflow trigger.
 * A generous ceiling accounts for sidebar + top-bar chrome ahead of the
 * crumb; failing here means the trigger became unreachable via keyboard
 * (focus trap, tabindex=-1 regression, hidden ancestor, etc).
 */
async function tabToOverflowTrigger(page: Page, maxPresses = 200) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    // WebKit ignores documentElement.focus(); fall through to body.
    (document.body as HTMLElement | null)?.focus?.();
  });
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    const onTrigger = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return false;
      const inCrumb = !!el.closest('nav[aria-label="Breadcrumb"]');
      const label = el.getAttribute("aria-label") ?? "";
      return inCrumb && /hidden breadcrumb/i.test(label);
    });
    if (onTrigger) return i + 1;
  }
  throw new Error(`Tab focus never reached the overflow trigger after ${maxPresses} presses`);
}

async function getTrigger(page: Page): Promise<Locator> {
  const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
  // Radix flips the accessible name while the menu is open — match on the
  // stable substring "hidden breadcrumb" (case-insensitive) so a "Show 3"
  // → "Hide" rename doesn't break the locator mid-test.
  const trigger = crumb.locator('button[aria-label*="hidden breadcrumb" i]');
  await expect(trigger, "fixture route must render the collapsed overflow trigger").toBeVisible();
  return trigger;
}

test.describe("Breadcrumbs overflow — Tab reachability", () => {
  for (const theme of THEMES) {
    test(`${theme} · Tab reaches the overflow trigger with :focus-visible`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await settle(page);

      const trigger = await getTrigger(page);

      const presses = await tabToOverflowTrigger(page);
      await expect(trigger, `[${theme}] Tab focus lands on the overflow trigger`).toBeFocused();
      expect(
        presses,
        `[${theme}] Tab actually advanced focus (didn't start on trigger)`,
      ).toBeGreaterThan(0);

      // Keyboard-origin focus must paint :focus-visible. This is what
      // makes the ring appear for AT users; a pointerdown-focus regression
      // would silently drop it.
      const focusVisible = await trigger.evaluate((el) => el.matches(":focus-visible"));
      expect(focusVisible, `[${theme}] :focus-visible paints on keyboard-tabbed trigger`).toBe(
        true,
      );

      // Not focus-trapped: Shift+Tab must move focus OFF the trigger.
      await page.keyboard.press("Shift+Tab");
      const stillOnTrigger = await trigger.evaluate((el) => document.activeElement === el);
      expect(
        stillOnTrigger,
        `[${theme}] Shift+Tab moves focus off the trigger (no focus trap)`,
      ).toBe(false);
    });
  }
});

test.describe("Breadcrumbs overflow — pointer open (mouse & tap)", () => {
  for (const theme of THEMES) {
    test(`${theme} · mouse click opens the menu`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await settle(page);

      const trigger = await getTrigger(page);
      await expect(trigger, `[${theme}] aria-expanded starts false`).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      await trigger.click();

      const menu = page.getByRole("menu");
      await expect(menu, `[${theme}] menu opens on mouse click`).toBeVisible();
      await expect(trigger, `[${theme}] aria-expanded flips to true after click`).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      const items = menu.getByRole("menuitem");
      expect(
        await items.count(),
        `[${theme}] menu lists hidden crumbs after click`,
      ).toBeGreaterThan(0);
    });
  }

  test.describe("touch tap", () => {
    // hasTouch is a context-level option; scope it to this describe so the
    // Tab/click specs above keep the default (no touch) context.
    test.use({ hasTouch: true });

    for (const theme of THEMES) {
      test(`${theme} · touch tap opens the menu`, async ({ page }) => {
        await forceTheme(page, theme);
        await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
        await settle(page);

        const trigger = await getTrigger(page);
        await expect(trigger, `[${theme}] aria-expanded starts false`).toHaveAttribute(
          "aria-expanded",
          "false",
        );

        // Tap fires pointerdown/up + touchstart/end + click — the full
        // touch activation sequence Radix DropdownMenu listens for.
        await trigger.tap();

        const menu = page.getByRole("menu");
        await expect(menu, `[${theme}] menu opens on tap`).toBeVisible();
        await expect(trigger, `[${theme}] aria-expanded flips to true after tap`).toHaveAttribute(
          "aria-expanded",
          "true",
        );

        const items = menu.getByRole("menuitem");
        expect(
          await items.count(),
          `[${theme}] menu lists hidden crumbs after tap`,
        ).toBeGreaterThan(0);
      });
    }
  });
});
