import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — outside click closes the overflow menu, restores focus
 * to the ellipsis trigger, and leaves the trail + URL unchanged.
 *
 * Concretely, after opening the menu and clicking on an inert area of
 * the page (not the trigger, not a menuitem, not any breadcrumb link):
 *   1. The menu is fully unmounted (no role="menu"/menuitem, no Radix
 *      popper/portal remnants, trigger aria-expanded="false").
 *   2. document.activeElement is the SAME trigger node (compared by
 *      identity via a tag set on the element pre-open, so a remount
 *      that lands focus on a "fresh" button with matching aria-label
 *      still fails this test).
 *   3. The URL is byte-identical (pathname + search + hash) and the
 *      breadcrumb trail's <li> text sequence and aria-current="page"
 *      crumb are unchanged.
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
 * Pick a point on the page that is guaranteed to be outside the menu,
 * outside the trigger, and NOT on top of any interactive element that
 * could steal focus or navigate. We scan a grid of candidate points in
 * the lower half of the viewport and return the first one whose
 * elementFromPoint resolves to inert content (or the <main>/<body>).
 */
async function findOutsideClickPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const isInert = (el: Element | null): boolean => {
      if (!el) return true;
      // Any ancestor that is the trigger, the menu, a link, or a
      // button disqualifies this point — clicking it could navigate,
      // reopen the menu, or focus a different control.
      for (let node: Element | null = el; node; node = node.parentElement) {
        const tag = node.tagName;
        if (tag === "A" || tag === "BUTTON") return false;
        if (node.getAttribute("role") === "menu") return false;
        if (node.getAttribute("role") === "menuitem") return false;
        if (node.closest?.('nav[aria-label="Breadcrumb"]') === node) return false;
        if (
          node.hasAttribute("data-radix-popper-content-wrapper") ||
          node.hasAttribute("data-radix-menu-content") ||
          node.hasAttribute("data-radix-portal")
        ) {
          return false;
        }
      }
      // Also reject anything inside the breadcrumb nav itself.
      if ((el as HTMLElement).closest?.('nav[aria-label="Breadcrumb"]')) return false;
      return true;
    };

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Scan lower two-thirds of the viewport where header/nav chrome
    // is least likely to sit. Step in ~40px increments.
    for (let y = Math.floor(vh * 0.55); y < vh - 20; y += 40) {
      for (let x = 20; x < vw - 20; x += 60) {
        const el = document.elementFromPoint(x, y);
        if (isInert(el)) return { x, y };
      }
    }
    return null;
  });

  if (!point) throw new Error("no inert click point found in viewport");
  return point;
}

test.describe("Breadcrumbs — outside click closes overflow, restores trigger focus, leaves trail intact", () => {
  for (const theme of THEMES) {
    test(`${theme} · outside click dismisses menu, refocuses same trigger, URL + trail unchanged`, async ({
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

      // Tag the trigger DOM node so post-click focus can be compared by
      // identity, not just by "a button with the same aria-label".
      await trigger.evaluate((el) => {
        (el as unknown as { __outsideClickTriggerTag?: number }).__outsideClickTriggerTag =
          Math.floor(Math.random() * 1e9);
      });
      const tagBefore = await trigger.evaluate(
        (el) =>
          (el as unknown as { __outsideClickTriggerTag?: number }).__outsideClickTriggerTag ?? null,
      );
      expect(tagBefore, "trigger tagged pre-open").not.toBeNull();

      const before = await readBreadcrumbSnapshot(page);
      expect(before, "breadcrumb rendered pre-open").not.toBeNull();

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();

      // Sanity: trigger reports the menu open before we click away.
      await expect(trigger, "trigger aria-expanded=true pre-outside-click").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // Click a point that is provably outside the menu, the trigger,
      // and every interactive element (see findOutsideClickPoint).
      const point = await findOutsideClickPoint(page);
      await page.mouse.click(point.x, point.y);

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
      expect(unmountState.menuNodes, 'no role="menu" after outside click').toBe(0);
      expect(unmountState.menuItemNodes, 'no role="menuitem" after outside click').toBe(0);
      expect(
        unmountState.popperWrappers,
        "no Radix popper/portal remnants after outside click",
      ).toBe(0);
      expect(unmountState.triggerExpanded, "trigger aria-expanded reset").toBe("false");

      // ---- 2. Focus returned to the SAME trigger element ----------------
      const focusState = await page.evaluate((expectedTag) => {
        const active = document.activeElement as HTMLElement | null;
        const trig = document.querySelector<HTMLElement>(
          'nav[aria-label="Breadcrumb"] button[aria-haspopup="menu"]',
        );
        const activeTag =
          (active as unknown as { __outsideClickTriggerTag?: number } | null)
            ?.__outsideClickTriggerTag ?? null;
        const trigTag =
          (trig as unknown as { __outsideClickTriggerTag?: number } | null)
            ?.__outsideClickTriggerTag ?? null;
        return {
          activeIsTrigger: active !== null && trig !== null && active === trig,
          triggerStillTagged: trigTag === expectedTag,
          activeTagMatches: activeTag === expectedTag,
          activeTagName: active?.tagName ?? null,
          activeIsBody: active === document.body,
        };
      }, tagBefore);
      expect(
        focusState.triggerStillTagged,
        "trigger element identity preserved (not remounted)",
      ).toBe(true);
      expect(focusState.activeIsBody, "focus did not fall through to <body>").toBe(false);
      expect(focusState.activeIsTrigger, "activeElement is the trigger").toBe(true);
      expect(
        focusState.activeTagMatches,
        `focus returned to the SAME trigger node (activeElement=${focusState.activeTagName})`,
      ).toBe(true);

      // ---- 3. URL + breadcrumb trail unchanged --------------------------
      const after = await readBreadcrumbSnapshot(page);
      expect(after, "breadcrumb still rendered post-outside-click").not.toBeNull();
      expect(after!.pathname, "pathname unchanged").toBe(before!.pathname);
      expect(after!.search, "search unchanged").toBe(before!.search);
      expect(after!.hash, "hash unchanged").toBe(before!.hash);
      expect(after!.trail, "breadcrumb trail text unchanged").toEqual(before!.trail);
      expect(after!.current, 'aria-current="page" crumb unchanged').toBe(before!.current);
    });
  }
});
