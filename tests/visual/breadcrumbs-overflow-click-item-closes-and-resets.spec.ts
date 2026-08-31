import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu "click a row" close + re-open contract.
 *
 * Regression: earlier iterations of the overflow menu would leave
 * `aria-expanded="true"` on the trigger after a mouse-click activation
 * of a menu item (the click path skipped the same close-side effect
 * the keyboard Enter path fired), and the *next* open reused the last
 * clicked row's `data-highlighted` instead of resetting to the first
 * item — breaking arrow navigation on the second open.
 *
 * This spec verifies, in both themes:
 *
 *   1. `aria-expanded="true"` while the menu is open.
 *   2. Clicking a menuitem closes the menu (`role="menu"` removed) AND
 *      flips `aria-expanded` back to `"false"` on the trigger (if the
 *      trigger still exists after navigation — otherwise the menu is
 *      simply gone, which is a stronger form of "closed").
 *   3. Focus lands on the corresponding breadcrumb row for the clicked
 *      target — either the `aria-current="page"` crumb reflects the
 *      row we clicked, OR the active element is that crumb's anchor.
 *   4. Re-opening the overflow (after navigating back to a URL that
 *      still collapses crumbs) restarts the highlight at index 0 —
 *      no ghost highlight leaks from the previously-clicked row.
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

function overflowTrigger(page: Page) {
  return page.locator('nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]');
}

/**
 * Read the {text, href} of a menuitem at `index` before the click, so
 * we can compare against post-navigation state (the DOM is gone after
 * the router settles on the new URL).
 */
async function readMenuItem(page: Page, index: number): Promise<{ text: string; href: string }> {
  return page.evaluate((i) => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const el = items[i];
    if (!el) throw new Error(`no menuitem at index ${i}`);
    const anchor =
      (el.tagName === "A" ? (el as HTMLAnchorElement) : null) ??
      el.querySelector<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) throw new Error(`menuitem ${i} has no href`);
    return {
      text: (el.textContent ?? "").trim(),
      href: new URL(href, window.location.origin).pathname,
    };
  }, index);
}

test.describe("Breadcrumbs — overflow menu closes on item click and resets highlight on reopen", () => {
  for (const theme of THEMES) {
    test(`${theme} · click menuitem closes menu, focuses destination crumb, reopen restarts at index 0`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = overflowTrigger(page);
      await expect(trigger, "overflow trigger renders on deep fixture URL").toBeVisible();
      await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");

      // ── 1. Open via click (mouse path — the one the bug lived in). ──
      const menu = await openMenu(page, trigger, {
        activation: "click",
        label: `overflow menu (${theme}, first open)`,
      });
      await expect(menu, "menu visible after click open").toBeVisible();
      await expect(trigger, "aria-expanded reflects the open state").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, "fixture yields multiple hidden crumbs").toBeGreaterThan(1);

      // Pick a non-first item so the assertion also proves the click
      // path fires the row the user actually clicked, not row 0.
      const targetIdx = Math.min(1, itemCount - 1);
      const target = await readMenuItem(page, targetIdx);
      expect(target.text.length, "target row has visible text").toBeGreaterThan(0);
      expect(
        target.href.startsWith("/"),
        `target href is an app-internal path (got ${target.href})`,
      ).toBe(true);
      expect(
        target.href,
        "target row does not point at the current URL (would make navigation a no-op)",
      ).not.toBe(new URL(FIXTURE_URL, "http://x").pathname);

      // ── 2. Click the row. Router should navigate + menu should close. ──
      await page.locator('[role="menuitem"]').nth(targetIdx).click();

      await page.waitForFunction((expected) => window.location.pathname === expected, target.href, {
        timeout: 5000,
      });

      // Menu portal fully unmounts after item activation.
      await expect(page.getByRole("menu"), "menu closes after clicking a row").toHaveCount(0);

      // aria-expanded returns to "false". If the trigger no longer
      // renders (shorter path may not collapse), the menu-gone check
      // above is the stronger guarantee — skip the attribute assertion
      // in that case rather than fail on a missing element.
      const triggerAfter = overflowTrigger(page);
      if ((await triggerAfter.count()) > 0) {
        await expect(
          triggerAfter,
          "aria-expanded flips back to false after row click",
        ).toHaveAttribute("aria-expanded", "false");
      }

      // ── 3. Focus / current-page reflects the clicked destination. ──
      // TanstackLink marks the active crumb with aria-current="page";
      // Breadcrumbs also renders the terminal crumb as text. Either
      // signal means "the app treats this row's URL as the current page".
      const destinationCrumb = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        if (!nav) return null;
        const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
        if (active) return (active.textContent ?? "").trim();
        const items = nav.querySelectorAll<HTMLElement>("li");
        const last = items[items.length - 1];
        return last ? (last.textContent ?? "").trim() : null;
      });
      expect(destinationCrumb, "clicked row becomes the current-page crumb in the trail").toBe(
        target.text,
      );

      // ── 4. Re-open contract: highlight resets to first item, no drift. ──
      // Navigate back to a URL that still collapses crumbs so the
      // overflow trigger is guaranteed to be present.
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger2 = overflowTrigger(page);
      await expect(trigger2, "overflow trigger renders again after reload").toBeVisible();
      await expect(trigger2, "re-loaded trigger starts collapsed").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      const menu2 = await openMenu(page, trigger2, {
        activation: "Space",
        label: `overflow menu (${theme}, reopen)`,
      });
      await expect(menu2, "menu visible on reopen").toBeVisible();

      // Radix keyboard-opens auto-highlight index 0. Wait for that
      // settle so the assertion isn't racing hydration.
      await page.waitForFunction(
        () => {
          const first = document.querySelector<HTMLElement>('[role="menuitem"]');
          return !!first && first.hasAttribute("data-highlighted");
        },
        undefined,
        { timeout: 2000 },
      );

      const reopenState = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        const highlightedIndex = items.findIndex((el) => el.hasAttribute("data-highlighted"));
        const highlightedCount = items.filter((el) => el.hasAttribute("data-highlighted")).length;
        return {
          count: items.length,
          highlightedIndex,
          highlightedCount,
          firstText: (items[0]?.textContent ?? "").trim(),
        };
      });

      expect(reopenState.count, "reopened menu has items").toBeGreaterThan(0);
      expect(
        reopenState.highlightedCount,
        "exactly one item is highlighted on reopen (no ghost from previous click)",
      ).toBe(1);
      expect(reopenState.highlightedIndex, "highlight resets to the first item on reopen").toBe(0);
      // Ensure the reset highlight isn't just "still on the previously-clicked row" —
      // that row's text would leak in if state weren't cleared.
      // (When the previously-clicked row happens to sort first, this
      // still passes because index 0 is the correct target either way.)
      expect(reopenState.firstText.length, "first item has visible text on reopen").toBeGreaterThan(
        0,
      );
    });
  }
});
