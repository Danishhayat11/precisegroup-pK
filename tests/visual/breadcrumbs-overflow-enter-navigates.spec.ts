import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow menu Enter-to-navigate contract.
 *
 * Pressing Enter on the highlighted row in the overflow dropdown must:
 *   1. Navigate to the exact href that row's <TanstackLink> points at.
 *   2. Close the menu (no lingering role="menu" in the DOM).
 *   3. Land on a URL that the app treats as that crumb's page.
 *
 * We prove #1 by reading the target row's own href before pressing
 * Enter and comparing it to the URL after navigation — the assertion
 * is source-of-truth-agnostic, so a refactor that reorders / renames
 * hidden crumbs still passes as long as Enter honors the row's link.
 *
 * We walk the menu with ArrowDown before pressing Enter so we cover
 * the "not the auto-highlighted first row" case too — a regression
 * that made Enter always fire the first item would slip past a
 * simpler test that only pressed Enter on open.
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

/**
 * Return the highlighted menuitem's own text + the pathname its
 * inner <a> points at. We read the actual anchor href instead of
 * reconstructing it, so the assertion tracks the link the user
 * would click with a mouse.
 */
async function readHighlightedTarget(page: Page): Promise<{ text: string; href: string }> {
  return page.evaluate(() => {
    const highlighted = document.querySelector<HTMLElement>('[role="menuitem"][data-highlighted]');
    if (!highlighted) throw new Error("no highlighted menuitem found");
    // Breadcrumbs uses `<DropdownMenuItem asChild><TanstackLink /></DropdownMenuItem>`,
    // so the menuitem element IS the <a>. Fall back to a descendant
    // anchor if a future refactor separates them again.
    const anchor =
      (highlighted.tagName === "A" ? (highlighted as HTMLAnchorElement) : null) ??
      highlighted.querySelector<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) throw new Error("highlighted menuitem exposes no href");
    return {
      text: (highlighted.textContent ?? "").trim(),
      // new URL() normalizes to pathname so string-compares later
      // aren't broken by protocol / host / trailing slash noise.
      href: new URL(href, window.location.origin).pathname,
    };
  });
}

test.describe("Breadcrumbs — overflow menu Enter navigates to the highlighted row", () => {
  for (const theme of THEMES) {
    test(`${theme} · Enter on a walked-to row navigates to that crumb's href`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();

      // Prove Enter fires the *currently* highlighted row (not always
      // the first) by advancing one step before we read the target.
      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, "fixture yields multiple hidden crumbs").toBeGreaterThan(1);

      // Wait for Radix to settle initial highlight before we walk it —
      // opening via Space may take a tick to auto-highlight the first
      // item, and pressing ArrowDown before that lands out of sync.
      await page.waitForFunction(
        () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
        undefined,
        { timeout: 2000 },
      );
      const initialIdx = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        return els.findIndex((el) => el.hasAttribute("data-highlighted"));
      });
      const targetIdx = Math.min(initialIdx + 1, itemCount - 1);

      if (targetIdx !== initialIdx) {
        await page.keyboard.press("ArrowDown");
        await page.waitForFunction(
          (idx) => {
            const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            return els[idx]?.hasAttribute("data-highlighted") ?? false;
          },
          targetIdx,
          { timeout: 2000 },
        );
      }

      // Snapshot the intended destination BEFORE pressing Enter — after
      // navigation the menu is gone and we can't recover the href from
      // the DOM. This is the "expected page" the assertion pivots on.
      const target = await readHighlightedTarget(page);
      expect(target.text.length, "highlighted row has visible text").toBeGreaterThan(0);
      expect(target.href.startsWith("/"), `href is an app-internal path (got ${target.href})`).toBe(
        true,
      );
      expect(
        target.href,
        "highlighted row does not point at the current URL (would make navigation a no-op)",
      ).not.toBe(new URL(FIXTURE_URL, "http://x").pathname);

      // Fire Enter and wait for the router to settle on the target URL.
      await page.keyboard.press("Enter");

      await page.waitForFunction((expected) => window.location.pathname === expected, target.href, {
        timeout: 5000,
      });

      // 1. URL matches the highlighted row's href exactly.
      expect(
        new URL(page.url()).pathname,
        `Enter navigated to the highlighted row "${target.text}"`,
      ).toBe(target.href);

      // 2. Menu closed — no orphan role="menu" left in the DOM.
      await expect(page.getByRole("menu"), "menu closes after Enter fires the row").toHaveCount(0);

      // 3. The app treats the new URL as a real page: the crumb-fixture
      //    splat re-renders <Breadcrumbs>, and the trail's *last* crumb
      //    should now match the row we navigated to. This is what
      //    "expected destination/page is selected" means end-to-end.
      const currentPageCrumb = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        if (!nav) return null;
        // aria-current="page" is applied by TanstackLink on the active
        // crumb, and Breadcrumbs also renders the terminal crumb as
        // non-link text — either signal identifies "the page we're on".
        const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
        if (active) return (active.textContent ?? "").trim();
        const items = nav.querySelectorAll<HTMLElement>("li");
        const last = items[items.length - 1];
        return last ? (last.textContent ?? "").trim() : null;
      });

      expect(
        currentPageCrumb,
        "the destination crumb is now the current page in the breadcrumb trail",
      ).toBe(target.text);
    });
  }
});
