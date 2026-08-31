import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — Escape close regression.
 *
 * Locks the three post-Escape guarantees in one spec so a regression to
 * any single one fails a clearly-named test rather than being masked by
 * the others:
 *
 *   1. `aria-expanded="false"` on the overflow trigger after Escape.
 *   2. Focus returns to the overflow trigger (not <body>, not a portal
 *      wrapper, not a stale menuitem).
 *   3. On the next open the roving highlight resets to menuitem 0 —
 *      it does NOT resume on whatever row was highlighted before Escape.
 *
 * Runs in light + dark: the Radix portal focus scope and focus rings
 * differ per theme and have historically regressed on one but not both.
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

test.describe("Breadcrumbs overflow · Escape close regression", () => {
  for (const theme of THEMES) {
    test(`${theme} · Escape resets aria-expanded, returns focus to trigger, and next open starts on item 0`, async ({
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

      // ── Open and walk highlight OFF item 0 so "reset to 0" is meaningful ──
      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, `[${theme}] menu open`).toBeVisible();
      await page.waitForFunction(
        () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
        undefined,
        { timeout: 2000 },
      );

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, `[${theme}] fixture yields several hidden crumbs`).toBeGreaterThanOrEqual(
        3,
      );

      const walkTarget = Math.min(2, itemCount - 1);
      const startIdx = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        return els.findIndex((el) => el.hasAttribute("data-highlighted"));
      });
      for (let i = startIdx; i < walkTarget; i++) {
        await page.keyboard.press("ArrowDown");
      }
      await page.waitForFunction(
        (idx) => {
          const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
          return els[idx]?.hasAttribute("data-highlighted") ?? false;
        },
        walkTarget,
        { timeout: 2000 },
      );

      // ── Close with Escape ────────────────────────────────────────────────
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu"), `[${theme}] menu unmounted`).toHaveCount(0);

      // (1) aria-expanded flips to "false"
      await expect(trigger, `[${theme}] trigger aria-expanded=false after Escape`).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // (2) Focus returns to the overflow trigger
      const afterEscape = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) {
          return { isBody: true, tag: "BODY", label: null, role: null };
        }
        return {
          isBody: false,
          tag: el.tagName,
          label: el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 60),
          role: el.getAttribute("role"),
        };
      });
      expect(afterEscape.isBody, `[${theme}] post-Escape focus not <body>`).toBe(false);
      expect(afterEscape.role, `[${theme}] post-Escape focus not on a stale menuitem`).not.toBe(
        "menuitem",
      );
      expect(afterEscape.tag, `[${theme}] post-Escape focus on a <button>`).toBe("BUTTON");
      expect(afterEscape.label, `[${theme}] post-Escape focus on the overflow trigger`).toMatch(
        /hidden breadcrumb/i,
      );

      // (3) Reopen — the highlight has reset to item 0, not the walked row
      const reopened = await openMenuByKeyboard(page, trigger);
      await expect(reopened, `[${theme}] menu reopened after Escape`).toBeVisible();
      await page.waitForFunction(
        () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
        undefined,
        { timeout: 2000 },
      );

      const highlighted = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        return els
          .map((el, idx) => ({ idx, highlighted: el.hasAttribute("data-highlighted") }))
          .filter((s) => s.highlighted);
      });
      expect(
        highlighted.length,
        `[${theme}] exactly one menuitem is highlighted on reopen (got ${highlighted.length})`,
      ).toBe(1);
      expect(
        highlighted[0].idx,
        `[${theme}] reopen highlights menuitem 0, not the pre-Escape row (walked to idx=${walkTarget})`,
      ).toBe(0);
    });
  }
});
