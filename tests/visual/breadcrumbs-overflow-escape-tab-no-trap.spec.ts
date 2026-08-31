import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — Escape from a highlighted overflow row does NOT trap
 * focus: the next Tab moves to the next logical tabbable control on
 * the page, and the breadcrumb trail + URL are untouched.
 *
 * Concretely, after opening the overflow menu, walking the highlight
 * one row down, and pressing Escape:
 *   1. The menu is fully unmounted (no role="menu"/menuitem, no Radix
 *      popper/portal remnants).
 *   2. Focus lands back on the ellipsis trigger.
 *   3. Pressing Tab advances focus to the SAME element that the
 *      browser's own tab order would pick if we started from the
 *      trigger with no menu ever opened — i.e. no phantom stop, no
 *      focus trap, no "swallowed" Tab.
 *   4. That next focused element is a real, visible, tabbable control
 *      (not <body>, not the trigger again, not something inside the
 *      menu subtree).
 *   5. URL (pathname + search + hash) and breadcrumb <li> sequence +
 *      aria-current="page" are byte-identical to the pre-open state.
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
      search: window.location.search,
      hash: window.location.hash,
    };
  });
}

/**
 * Stamp a stable, unique tag on every currently-tabbable element so we
 * can compare focus targets by IDENTITY across a Tab press — not by
 * text/aria-label, which can collide.
 */
async function tagTabbables(page: Page): Promise<void> {
  await page.evaluate(() => {
    const isTabbable = (el: Element): boolean => {
      const he = el as HTMLElement;
      if (he.hasAttribute("disabled")) return false;
      const ti = he.getAttribute("tabindex");
      if (ti !== null && parseInt(ti, 10) < 0) return false;
      // Ignore anything visually hidden — matches how the browser
      // actually walks tab order well enough for this test.
      const rect = he.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const style = window.getComputedStyle(he);
      if (style.visibility === "hidden" || style.display === "none") return false;
      return true;
    };
    let n = 0;
    const nodes = document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]");
    nodes.forEach((el) => {
      if (!isTabbable(el)) return;
      (el as unknown as { __tabTag?: number }).__tabTag = ++n;
    });
  });
}

async function readTag(page: Page, locator: Locator): Promise<number | null> {
  return locator.evaluate((el) => (el as unknown as { __tabTag?: number }).__tabTag ?? null);
}

async function readActiveTag(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
      tag: (a as unknown as { __tabTag?: number } | null)?.__tabTag ?? null,
      tagName: a?.tagName ?? null,
      isBody: a === document.body,
      insideMenuSubtree: !!a?.closest?.(
        '[role="menu"], [data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-portal]',
      ),
    };
  });
}

test.describe("Breadcrumbs — Escape from highlighted row does not trap focus; Tab continues normally", () => {
  for (const theme of THEMES) {
    test(`${theme} · Escape from walked-to row → Tab lands on next logical control; trail unchanged`, async ({
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

      const before = await readBreadcrumbSnapshot(page);
      expect(before, "breadcrumb rendered pre-open").not.toBeNull();

      // ---- Establish the "no-menu" ground truth --------------------------
      // Focus the trigger and press Tab WITHOUT ever opening the menu.
      // Whatever element focus lands on now is the correct next tab
      // stop after the trigger. We tag every tabbable first so we can
      // recover this element by identity later.
      await tagTabbables(page);
      const triggerTag = await readTag(page, trigger);
      expect(triggerTag, "trigger is tabbable and tagged").not.toBeNull();

      await trigger.focus();
      await page.keyboard.press("Tab");
      const groundTruth = await readActiveTag(page);
      expect(groundTruth.isBody, "ground-truth next stop is not <body>").toBe(false);
      expect(groundTruth.tag, "ground-truth next stop is a tagged tabbable element").not.toBeNull();
      expect(groundTruth.tag, "ground-truth next stop is not the trigger itself").not.toBe(
        triggerTag,
      );

      // Return focus to the trigger for the real scenario.
      await trigger.focus();

      // ---- Real scenario: open, walk highlight, Escape, Tab --------------
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();

      // Wait for the initial highlight, then step one row down so
      // Escape fires from a "walked-to" row, not the auto-highlight.
      await page.waitForFunction(
        () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
        undefined,
        { timeout: 2000 },
      );
      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, "fixture yields multiple hidden crumbs").toBeGreaterThan(1);
      const initialIdx = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        return els.findIndex((el) => el.hasAttribute("data-highlighted"));
      });
      const walkTarget = Math.min(initialIdx + 1, itemCount - 1);
      if (walkTarget !== initialIdx) {
        await page.keyboard.press("ArrowDown");
        await page.waitForFunction(
          (idx) => {
            const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            return els[idx]?.hasAttribute("data-highlighted") ?? false;
          },
          walkTarget,
          { timeout: 2000 },
        );
      }

      // Escape from the highlighted row.
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.querySelectorAll('[role="menu"]').length === 0,
        undefined,
        { timeout: 2000 },
      );

      // ---- 1. Menu fully unmounted --------------------------------------
      const unmountState = await page.evaluate(() => ({
        menuNodes: document.querySelectorAll('[role="menu"]').length,
        menuItemNodes: document.querySelectorAll('[role="menuitem"]').length,
        popperWrappers: document.querySelectorAll(
          "[data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-portal]",
        ).length,
      }));
      expect(unmountState.menuNodes, 'no role="menu" after Escape').toBe(0);
      expect(unmountState.menuItemNodes, 'no role="menuitem" after Escape').toBe(0);
      expect(unmountState.popperWrappers, "no Radix popper/portal remnants after Escape").toBe(0);

      // ---- 2. Focus is back on the trigger ------------------------------
      await expect(trigger, "focus returned to the trigger").toBeFocused();
      await expect(trigger, "trigger aria-expanded reset").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // ---- 3 + 4. Tab moves to the SAME next stop as the ground truth ---
      await page.keyboard.press("Tab");
      const afterTab = await readActiveTag(page);

      expect(afterTab.isBody, "Tab did not fall through to <body>").toBe(false);
      expect(
        afterTab.insideMenuSubtree,
        "Tab did not land inside a stale menu/portal (no focus trap)",
      ).toBe(false);
      expect(
        afterTab.tag,
        `Tab landed on a tagged tabbable element (activeElement=${afterTab.tagName})`,
      ).not.toBeNull();
      expect(
        afterTab.tag,
        "Tab did NOT stay on the trigger — no focus trap on the ellipsis",
      ).not.toBe(triggerTag);
      expect(
        afterTab.tag,
        `Tab landed on the same next control as the no-menu ground truth (expected tag=${groundTruth.tag}, got ${afterTab.tag})`,
      ).toBe(groundTruth.tag);

      // ---- 5. Breadcrumb + URL unchanged --------------------------------
      const after = await readBreadcrumbSnapshot(page);
      expect(after, "breadcrumb still rendered").not.toBeNull();
      expect(after!.pathname, "pathname unchanged").toBe(before!.pathname);
      expect(after!.search, "search unchanged").toBe(before!.search);
      expect(after!.hash, "hash unchanged").toBe(before!.hash);
      expect(after!.trail, "breadcrumb trail text unchanged").toEqual(before!.trail);
      expect(after!.current, 'aria-current="page" crumb unchanged').toBe(before!.current);
    });
  }
});
