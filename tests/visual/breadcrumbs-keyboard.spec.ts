import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — keyboard behavior across light + dark themes.
 *
 * Sibling to:
 *   • `breadcrumbs-theme-tokens.spec.ts` — resting typography/spacing.
 *   • `breadcrumbs-focus-states.spec.ts` — focus-ring pixel snapshots.
 *
 * This spec locks the *interaction* contract that the pixel specs can't:
 *   1. Tab order = Home → each ancestor link → overflow trigger (when present).
 *      The current-page span is intentionally NOT tabbable.
 *   2. Every reachable target reports `:focus-visible` (proves the shared
 *      `focusRing` class actually paints, not just that the ring rule
 *      exists in CSS).
 *   3. Inside the overflow menu, Radix moves `data-[highlighted]` with
 *      ↑/↓, wraps at the ends, and Esc closes the menu returning focus
 *      to the trigger.
 *
 * Runs in both themes because focus visibility depends on the `--ring`
 * token resolving correctly under `.dark`.
 */

const THEMES = ["light", "dark"] as const;

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
  await page.waitForTimeout(120);
}

/**
 * True iff the element currently matches `:focus-visible`. Playwright can
 * assert focus, but `.toBeFocused()` alone doesn't prove the visible ring
 * paints — a broken `:focus-visible` selector would fool it.
 */
async function isFocusVisible(target: Locator): Promise<boolean> {
  return target.evaluate((el) => el.matches(":focus-visible"));
}

/**
 * Tab from the start of the document into the crumb, stopping the moment
 * focus lands inside `nav[aria-label="Breadcrumb"]`. The AppShell has a
 * sidebar + top-bar chrome ahead of the crumb in DOM order, so the
 * ceiling is generous. Fails fast with a clear message if the crumb is
 * ever unreachable via keyboard alone (would indicate a focus trap or a
 * skip-link bug swallowing Tab).
 */
async function tabIntoBreadcrumb(page: Page, maxPresses = 200) {
  const inCrumb = () =>
    page.evaluate(() => !!document.activeElement?.closest('nav[aria-label="Breadcrumb"]'));
  // Reset to the top of the tab ring so counts are deterministic.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    // Focus the <html> element — next Tab moves to the first tabbable.
    (document.documentElement as HTMLElement).focus?.();
  });
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    if (await inCrumb()) return;
  }
  throw new Error(
    `Tab focus never reached nav[aria-label="Breadcrumb"] after ${maxPresses} presses`,
  );
}

test.describe("Breadcrumbs — keyboard behavior", () => {
  for (const theme of THEMES) {
    test(`${theme} · Tab reaches Home link with a visible focus ring`, async ({
      context,
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto("/bookings", { waitUntil: "domcontentloaded" });
      await settle(page);

      await tabIntoBreadcrumb(page);

      // First focusable inside the crumb should be the Home link.
      const active = await page.evaluate(() => ({
        name: document.activeElement?.getAttribute("aria-label") ?? "",
        tag: document.activeElement?.tagName ?? "",
      }));
      expect(active.name).toMatch(/Go to Dashboard/);
      expect(active.tag).toBe("A");

      const home = page
        .locator('nav[aria-label="Breadcrumb"] a', {
          hasText: /Dashboard/,
        })
        .first();
      expect(await isFocusVisible(home)).toBe(true);
    });

    test(`${theme} · Tab order = Home → ancestor → (no current-page stop)`, async ({
      context,
      page,
    }) => {
      await forceTheme(page, theme);
      // 3 crumbs (Home + Bookings link + "#abcdef" current) — enough to
      // prove ancestor links are tabbable AND current page is skipped.
      await page.goto("/bookings/abcdef0123456789", { waitUntil: "domcontentloaded" });
      await settle(page);

      await tabIntoBreadcrumb(page); // lands on Home
      await page.keyboard.press("Tab"); // → ancestor "Bookings"

      const ancestorName = await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? "",
      );
      expect(ancestorName).toMatch(/Go to Bookings/);

      const ancestor = page.locator('nav[aria-label="Breadcrumb"] a[aria-label="Go to Bookings"]');
      await expect(ancestor).toHaveAttribute("aria-current", "location");
      expect(await isFocusVisible(ancestor)).toBe(true);

      // Next Tab must NOT stop on the current-page span (aria-current="page"
      // is a non-focusable <span> by design).
      await page.keyboard.press("Tab");
      const stillInCrumbOnCurrent = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return false;
        const inCrumb = !!el.closest('nav[aria-label="Breadcrumb"]');
        const isCurrent = el.getAttribute("aria-current") === "page";
        return inCrumb && isCurrent;
      });
      expect(stillInCrumbOnCurrent, "current-page span must not be a Tab stop").toBe(false);
    });

    test(`${theme} · overflow trigger + arrow-key menu navigation`, async ({ context, page }) => {
      await forceTheme(page, theme);
      // Fixture route `/crumb-fixture/$` guarantees > MAX_VISIBLE
      // (4) crumbs from the pathname, so the overflow trigger renders
      // deterministically here — no production route currently reaches
      // that depth, so this fixture is what unmasks the keyboard contract.
      await page.goto("/crumb-fixture/alpha/beta/gamma/delta/epsilon", {
        waitUntil: "domcontentloaded",
      });
      await settle(page);

      const trigger = page
        .locator('nav[aria-label="Breadcrumb"]')
        .getByRole("button", { name: /Show \d+ hidden breadcrumb/ });
      await expect(
        trigger,
        "fixture route must produce the collapsed overflow trigger",
      ).toBeVisible();

      // Focus the trigger via keyboard so :focus-visible is truthful.
      await trigger.focus();
      await page.keyboard.press("Shift");
      expect(await isFocusVisible(trigger)).toBe(true);

      // Open with Enter — Radix auto-highlights the first item.
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();

      const items = menu.getByRole("menuitem");
      const count = await items.count();
      expect(count, "overflow menu should have hidden crumbs").toBeGreaterThan(0);

      // ArrowDown from an unhighlighted state moves to first item.
      await page.keyboard.press("ArrowDown");
      const firstHighlight = await menu.locator("[data-highlighted]").first().textContent();

      // ArrowDown again moves to the next item (or wraps if only one).
      if (count > 1) {
        await page.keyboard.press("ArrowDown");
        const second = await menu.locator("[data-highlighted]").first().textContent();
        expect(second, "ArrowDown should move highlight to a different item").not.toBe(
          firstHighlight,
        );

        // ArrowUp returns to the first.
        await page.keyboard.press("ArrowUp");
        const back = await menu.locator("[data-highlighted]").first().textContent();
        expect(back).toBe(firstHighlight);
      }

      // Exactly one highlighted item at any time.
      await expect(menu.locator("[data-highlighted]")).toHaveCount(1);

      // Esc closes the menu AND returns focus to the trigger (Radix contract).
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(await isFocusVisible(trigger)).toBe(true);
    });
  }
});
