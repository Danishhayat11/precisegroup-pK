import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs — active entry inside the overflow menu exposes the
 * correct WAI-ARIA breadcrumb attributes, and deliberately does NOT
 * borrow the listbox/tab `aria-selected` idiom.
 *
 * Contract:
 *   • Every collapsed entry carries `aria-current` — "page" when its
 *     href matches the current URL, otherwise "location" (per WAI-ARIA
 *     Authoring Practices for breadcrumbs).
 *   • Exactly one crumb across the whole trail owns `aria-current="page"`.
 *   • No overflow entry uses `aria-selected` — that attribute belongs to
 *     `listbox`/`tab`/`option`, not menu items, and mixing it in confuses
 *     screen readers that already announce the "menuitem" role.
 *   • Each overflow entry advertises its position with `aria-posinset`
 *     and `aria-setsize` so SRs announce "2 of 3".
 *
 * Runs in light + dark because the ARIA wiring must not depend on
 * theme-specific class hooks.
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

async function openMenu(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.focus();
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

test.describe("Breadcrumbs overflow · active entry ARIA (aria-current, not aria-selected)", () => {
  for (const theme of THEMES) {
    test(`${theme} · overflow entries expose aria-current and never aria-selected`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      const menu = await openMenu(page, trigger);
      await expect(menu, "overflow menu opens").toBeVisible();

      const items = menu.getByRole("menuitem");
      const count = await items.count();
      expect(count, "overflow menu has at least one menuitem").toBeGreaterThan(0);

      // ── Per-item accessibility contract ────────────────────────
      for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        // The menuitem wraps a TanstackLink that carries the ARIA — check
        // both the menuitem and its inner anchor so we catch either shape.
        const link = item.locator("a").first();
        const linkCount = await link.count();
        const source = linkCount > 0 ? link : item;

        const current = await source.getAttribute("aria-current");
        expect(current, `[${theme}] item ${i} has aria-current`).not.toBeNull();
        expect(current, `[${theme}] item ${i} aria-current is "page" or "location"`).toMatch(
          /^(page|location)$/,
        );

        // aria-selected must NOT appear — wrong role family for menuitem.
        const selected = await source.getAttribute("aria-selected");
        expect(
          selected,
          `[${theme}] item ${i} must not use aria-selected (menuitem, not option/tab)`,
        ).toBeNull();
        const selectedOnItem = await item.getAttribute("aria-selected");
        expect(
          selectedOnItem,
          `[${theme}] menuitem wrapper ${i} must not use aria-selected either`,
        ).toBeNull();

        // Positional metadata so SRs can announce "N of M".
        const posinset = await source.getAttribute("aria-posinset");
        const setsize = await source.getAttribute("aria-setsize");
        expect(Number(posinset), `[${theme}] item ${i} aria-posinset = ${i + 1}`).toBe(i + 1);
        expect(Number(setsize), `[${theme}] item ${i} aria-setsize = ${count}`).toBe(count);
      }

      // ── Whole-trail invariant: exactly one aria-current="page" ─
      // Combine the visible crumbs and the open menu; only the true
      // current URL (the last crumb, "epsilon") should own it.
      const pageMarked = await page
        .locator(
          'nav[aria-label="Breadcrumb"] [aria-current="page"], [role="menu"] [aria-current="page"]',
        )
        .count();
      expect(pageMarked, `[${theme}] exactly one aria-current="page" across trail + overflow`).toBe(
        1,
      );
    });
  }
});
