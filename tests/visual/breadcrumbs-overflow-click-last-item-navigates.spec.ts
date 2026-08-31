import { expect, test, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — pointer click on the LAST overflow row.
 *
 * Opens the overflow dropdown by clicking the trigger, then clicks the
 * *last* menuitem (the deepest hidden ancestor, most likely to expose
 * an off-by-one in the collapsed slice) and locks the post-activation
 * contract:
 *
 *   1. URL navigation — location.pathname matches the row's own href.
 *   2. Destination crumb carries `aria-current="page"` in the
 *      re-rendered breadcrumb trail — proves the app treats the new
 *      URL as that crumb's page (not the previous URL, not a stale
 *      match).
 *   3. Focus lands inside the breadcrumb nav on the destination crumb
 *      — never `<body>`, never a leaked menuitem, never a portal
 *      wrapper the Radix focus scope forgot to release.
 *
 * We select the last row by index (not by text) so a fixture rename
 * still exercises the deepest hidden crumb, and we snapshot the row's
 * href BEFORE clicking so the assertion tracks the actual link the
 * user would follow — not a reconstructed one.
 *
 * Runs in light + dark: focus rings and portal tear-down differ per
 * theme and have historically regressed independently.
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
    if (root) {
      root.classList.toggle("dark", t === "dark");
      root.style.colorScheme = t;
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

test.describe("Breadcrumbs overflow · click LAST menuitem navigates and updates aria-current + focus", () => {
  for (const theme of THEMES) {
    test(`${theme} · mouse click on the last overflow row navigates, sets aria-current, and focuses that crumb`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, `[${theme}] overflow trigger renders`).toBeVisible();

      // ── Open via pointer ────────────────────────────────────────────────
      await trigger.click();
      const menu = page.getByRole("menu");
      await expect(menu, `[${theme}] menu open after pointer click`).toBeVisible();
      await page.waitForFunction(
        () => document.querySelectorAll('[role="menuitem"]').length > 0,
        undefined,
        { timeout: 2000 },
      );

      const items = page.locator('[role="menuitem"]');
      const itemCount = await items.count();
      expect(
        itemCount,
        `[${theme}] fixture yields multiple hidden crumbs so "last" is a meaningful pick`,
      ).toBeGreaterThan(1);

      const lastItem = items.nth(itemCount - 1);

      // Snapshot the destination BEFORE clicking — after nav the menu is
      // gone and we can't recover the row's href from the DOM.
      const target = await lastItem.evaluate((el) => {
        const anchor =
          (el.tagName === "A" ? (el as HTMLAnchorElement) : null) ??
          el.querySelector<HTMLAnchorElement>("a[href]");
        const href = anchor?.getAttribute("href");
        if (!href) throw new Error("last menuitem exposes no href");
        return {
          text: (el.textContent ?? "").trim(),
          href: new URL(href, window.location.origin).pathname,
        };
      });
      expect(target.text.length, `[${theme}] last row has visible text`).toBeGreaterThan(0);
      expect(
        target.href,
        `[${theme}] last row does not point at the current URL (would make click a no-op)`,
      ).not.toBe(new URL(FIXTURE_URL, "http://x").pathname);

      // ── Click the last row ──────────────────────────────────────────────
      await lastItem.click();

      // Wait for the router to settle on the destination.
      await page.waitForFunction((expected) => window.location.pathname === expected, target.href, {
        timeout: 5000,
      });

      // (1) URL matches the row's href exactly.
      expect(
        new URL(page.url()).pathname,
        `[${theme}] click on last overflow row navigated to "${target.text}"`,
      ).toBe(target.href);

      // Menu tears down as part of the activation.
      await expect(
        page.getByRole("menu"),
        `[${theme}] menu closed after pointer activation`,
      ).toHaveCount(0);

      // (2) aria-current="page" is on the destination crumb in the
      //     re-rendered trail. Match against a nav-scoped element whose
      //     text OR aria-label equals the clicked row.
      const currentCrumb = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        if (!nav) return null;
        const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
        if (!active) return null;
        return {
          text: (active.textContent ?? "").trim(),
          label: active.getAttribute("aria-label") || (active.textContent ?? "").trim(),
          tag: active.tagName,
        };
      });
      expect(
        currentCrumb,
        `[${theme}] a breadcrumb entry carries aria-current="page"`,
      ).not.toBeNull();
      expect(
        currentCrumb!.text === target.text || currentCrumb!.label === target.text,
        `[${theme}] aria-current="page" is on the clicked crumb "${target.text}" (got "${currentCrumb!.text}")`,
      ).toBe(true);

      // (3) Focus lands inside the breadcrumb nav on the destination crumb.
      const active = await page.evaluate((expectedText) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) {
          return {
            isBody: true,
            insideNav: false,
            matchesTarget: false,
            role: null,
            tag: "BODY",
            label: null,
          };
        }
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        const insideNav = !!(nav && nav.contains(el));
        const text = (el.textContent ?? "").trim();
        const label = el.getAttribute("aria-label") || text.slice(0, 60);
        const matchesTarget =
          el.getAttribute("aria-current") === "page" ||
          text === expectedText ||
          label === expectedText;
        return {
          isBody: false,
          insideNav,
          matchesTarget,
          role: el.getAttribute("role"),
          tag: el.tagName,
          label,
        };
      }, target.text);

      expect(active.isBody, `[${theme}] focus not left on <body> after pointer activation`).toBe(
        false,
      );
      expect(
        active.role,
        `[${theme}] focus not stuck on a stale menuitem in a leaked portal`,
      ).not.toBe("menuitem");
      expect(
        active.insideNav,
        `[${theme}] post-click focus lives inside breadcrumb nav (got tag=${active.tag}, label="${active.label}")`,
      ).toBe(true);
      expect(
        active.matchesTarget,
        `[${theme}] post-click focus on destination crumb "${target.text}" (got "${active.label}")`,
      ).toBe(true);
    });
  }
});
