import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — Enter activation regression.
 *
 * Opens the overflow dropdown via keyboard, walks the highlight to a
 * non-initial row, presses Enter, and locks the three post-activation
 * guarantees in one test so a regression to any single one fails a
 * clearly-named case:
 *
 *   1. The dropdown is torn down — no orphan `role="menu"` in the DOM.
 *   2. `aria-expanded` on the overflow trigger is `"false"` (or the
 *      trigger no longer exists in the re-rendered breadcrumb trail,
 *      which is an even stronger closure signal).
 *   3. Focus lands on the breadcrumb entry corresponding to the row
 *      that was activated — the destination crumb, not `<body>` and
 *      not a stale menuitem inside a leaked portal.
 *
 * Complements `breadcrumbs-overflow-enter-navigates.spec.ts`, which
 * only asserts URL + menu teardown. This spec is the aria-expanded +
 * focus-return regression.
 *
 * Runs in light + dark: Radix's focus scope tear-down and the app's
 * post-navigation focus handoff have both regressed per-theme in the past.
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

async function openMenuByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

async function readHighlightedTarget(page: Page): Promise<{ text: string; href: string }> {
  return page.evaluate(() => {
    const highlighted = document.querySelector<HTMLElement>('[role="menuitem"][data-highlighted]');
    if (!highlighted) throw new Error("no highlighted menuitem found");
    const anchor =
      (highlighted.tagName === "A" ? (highlighted as HTMLAnchorElement) : null) ??
      highlighted.querySelector<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) throw new Error("highlighted menuitem exposes no href");
    return {
      text: (highlighted.textContent ?? "").trim(),
      href: new URL(href, window.location.origin).pathname,
    };
  });
}

test.describe("Breadcrumbs overflow · Enter activation regression", () => {
  for (const theme of THEMES) {
    test(`${theme} · Enter closes menu, flips aria-expanded, and focuses the destination crumb`, async ({
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

      // ── Open menu by keyboard and walk one row down ─────────────────────
      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, `[${theme}] menu open`).toBeVisible();

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, `[${theme}] fixture yields multiple hidden crumbs`).toBeGreaterThan(1);

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

      const target = await readHighlightedTarget(page);
      expect(target.text.length, `[${theme}] highlighted row has visible text`).toBeGreaterThan(0);
      expect(
        target.href,
        `[${theme}] highlighted row is not the current URL (would make activation a no-op)`,
      ).not.toBe(new URL(FIXTURE_URL, "http://x").pathname);

      // ── Activate with Enter ─────────────────────────────────────────────
      await page.keyboard.press("Enter");

      // Wait for the router to settle on the destination.
      await page.waitForFunction((expected) => window.location.pathname === expected, target.href, {
        timeout: 5000,
      });

      // (1) Menu is gone.
      await expect(page.getByRole("menu"), `[${theme}] menu closed after Enter`).toHaveCount(0);

      // (2) aria-expanded resolved to false. After navigation the crumb
      //     trail may re-collapse differently and the trigger may no
      //     longer be present — that is an even stronger "closed" signal,
      //     so accept either outcome but forbid `aria-expanded="true"`.
      const triggerCount = await trigger.count();
      if (triggerCount > 0) {
        await expect(trigger, `[${theme}] trigger aria-expanded=false after Enter`).toHaveAttribute(
          "aria-expanded",
          "false",
        );
      }

      // (3) Focus moves to the destination breadcrumb entry (the newly-
      //     current crumb in the re-rendered trail). Match by
      //     aria-current="page" first, then by text equality inside the
      //     breadcrumb nav — either identifies the intended landing spot.
      const active = await page.evaluate((expectedText) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) {
          return {
            isBody: true,
            insideNav: false,
            matchesTarget: false,
            tag: "BODY",
            label: null,
            role: null,
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
          tag: el.tagName,
          label,
          role: el.getAttribute("role"),
        };
      }, target.text);

      expect(active.isBody, `[${theme}] focus did not fall through to <body> after Enter`).toBe(
        false,
      );
      expect(
        active.role,
        `[${theme}] focus is not stuck on a stale menuitem in a leaked portal`,
      ).not.toBe("menuitem");
      expect(
        active.insideNav,
        `[${theme}] post-Enter focus lives inside the breadcrumb nav (got tag=${active.tag}, label="${active.label}")`,
      ).toBe(true);
      expect(
        active.matchesTarget,
        `[${theme}] post-Enter focus is on the destination crumb "${target.text}" (got "${active.label}")`,
      ).toBe(true);
    });
  }
});
