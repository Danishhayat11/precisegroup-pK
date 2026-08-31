import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — Escape on the ellipsis trigger.
 *
 * With the overflow menu open and focus on the ellipsis trigger,
 * pressing Escape must:
 *   1. Close the overflow menu (fully unmounted — no role="menu",
 *      no menuitems, no Radix popper/portal remnants).
 *   2. Return focus to that same trigger element by IDENTITY —
 *      not a re-rendered clone with matching aria-label.
 *   3. Leave the breadcrumb trail unchanged (URL identical, trail
 *      text sequence identical, aria-current="page" unchanged).
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

async function openMenuByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

async function readBreadcrumbSnapshot(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
    if (!nav) return null;
    const trail = Array.from(nav.querySelectorAll<HTMLElement>("li")).map((li) =>
      (li.textContent ?? "").trim(),
    );
    const currentPage = nav.querySelector<HTMLElement>('[aria-current="page"]');
    return {
      trail,
      current: currentPage ? (currentPage.textContent ?? "").trim() : null,
      pathname: window.location.pathname,
    };
  });
}

test.describe("Breadcrumbs — Escape on ellipsis trigger closes menu, restores focus, leaves trail unchanged", () => {
  for (const theme of THEMES) {
    test(`${theme} · Escape from trigger unmounts menu, refocuses same trigger, trail unchanged`, async ({
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

      // Tag the trigger node so we can compare identity across Escape.
      // A regression that re-mounts the trigger and moves focus to
      // "a fresh button with the same aria-label" would drop this tag.
      await trigger.evaluate((el) => {
        (el as unknown as { __escTriggerTag?: number }).__escTriggerTag = Math.floor(
          Math.random() * 1e9,
        );
      });
      const tagBefore = await trigger.evaluate(
        (el) => (el as unknown as { __escTriggerTag?: number }).__escTriggerTag ?? null,
      );
      expect(tagBefore, "trigger tagged pre-open").not.toBeNull();

      const before = await readBreadcrumbSnapshot(page);
      expect(before, "breadcrumb rendered pre-open").not.toBeNull();

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();

      // Move focus BACK to the trigger explicitly. On some Radix
      // builds Space keeps focus on the trigger while opening; on
      // others focus jumps into the menu. We're testing the "focus
      // on trigger" case, so normalize before pressing Escape.
      await trigger.focus();
      const focusOnTrigger = await page.evaluate(() => {
        const t = document.querySelector<HTMLElement>(
          'nav[aria-label="Breadcrumb"] button[aria-haspopup="menu"]',
        );
        return t !== null && document.activeElement === t;
      });
      expect(focusOnTrigger, "focus is on the ellipsis trigger before Escape").toBe(true);

      await page.keyboard.press("Escape");

      // ---- 1. Menu fully unmounted --------------------------------------
      await page.waitForFunction(
        () => document.querySelectorAll('[role="menu"]').length === 0,
        undefined,
        { timeout: 2000 },
      );
      const unmountState = await page.evaluate(() => ({
        menuNodes: document.querySelectorAll('[role="menu"]').length,
        menuItemNodes: document.querySelectorAll('[role="menuitem"]').length,
        popperWrappers: document.querySelectorAll(
          "[data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-portal]",
        ).length,
        triggerExpanded:
          document
            .querySelector<HTMLElement>('nav[aria-label="Breadcrumb"] button[aria-haspopup="menu"]')
            ?.getAttribute("aria-expanded") ?? null,
      }));
      expect(unmountState.menuNodes, 'no role="menu" after Escape').toBe(0);
      expect(unmountState.menuItemNodes, 'no role="menuitem" after Escape').toBe(0);
      expect(unmountState.popperWrappers, "no Radix popper/portal remnants after Escape").toBe(0);
      expect(unmountState.triggerExpanded, "trigger aria-expanded reset").toBe("false");

      // ---- 2. Focus returned to SAME trigger element (by identity) ------
      const focusState = await page.evaluate((expectedTag) => {
        const active = document.activeElement as HTMLElement | null;
        const trig = document.querySelector<HTMLElement>(
          'nav[aria-label="Breadcrumb"] button[aria-haspopup="menu"]',
        );
        const activeTag =
          (active as unknown as { __escTriggerTag?: number } | null)?.__escTriggerTag ?? null;
        const trigTag =
          (trig as unknown as { __escTriggerTag?: number } | null)?.__escTriggerTag ?? null;
        return {
          activeIsTrigger: active !== null && trig !== null && active === trig,
          triggerStillTagged: trigTag === expectedTag,
          activeTagMatches: activeTag === expectedTag,
          activeTagName: active?.tagName ?? null,
        };
      }, tagBefore);
      expect(
        focusState.triggerStillTagged,
        "trigger element identity preserved (not remounted)",
      ).toBe(true);
      expect(focusState.activeIsTrigger, "activeElement is the trigger").toBe(true);
      expect(
        focusState.activeTagMatches,
        `focus returned to the SAME trigger node (got activeElement=${focusState.activeTagName})`,
      ).toBe(true);

      // ---- 3. Breadcrumb trail unchanged --------------------------------
      const after = await readBreadcrumbSnapshot(page);
      expect(after, "breadcrumb still rendered post-Escape").not.toBeNull();
      expect(after!.pathname, "URL unchanged after Escape").toBe(before!.pathname);
      expect(after!.trail, "breadcrumb trail text unchanged after Escape").toEqual(before!.trail);
      expect(after!.current, 'aria-current="page" crumb unchanged after Escape').toBe(
        before!.current,
      );
    });
  }
});
