import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow dropdown highlight & focus-ring token guard.
 *
 * Lightweight sibling to `breadcrumbs-overflow-keyboard.spec.ts`. Instead of
 * pixel-snapshotting the interaction flow, this spec inspects the DOM
 * *contract* that gives the highlighted row its accent tint and the
 * trigger its focus-visible ring — both live entirely on tokenized
 * classes. If those class strings ever drift off-token (e.g. someone
 * swaps `bg-accent` for `bg-neutral-200`), no screenshot needs to fail
 * for this test to catch it.
 *
 * Assertions per theme (light + dark):
 *   1. Tabbing to the overflow trigger yields `:focus-visible`.
 *   2. The trigger's className carries the shared focus-ring tokens
 *        `focus-visible:ring-2`, `focus-visible:ring-ring`,
 *        `focus-visible:ring-offset-2`, `focus-visible:ring-offset-background`.
 *   3. Space opens the Radix menu; ArrowDown moves highlight to item 0.
 *   4. The highlighted item exposes `data-highlighted` and its className
 *      carries `data-[highlighted]:bg-accent` +
 *      `data-[highlighted]:text-accent-foreground`.
 *   5. Its computed background is NOT transparent (accent token cascaded).
 *   6. After Escape closes the menu, focus returns to the trigger and
 *      the focus-visible ring token is still applied.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

const FOCUS_RING_TOKENS = [
  "focus-visible:ring-2",
  "focus-visible:ring-ring",
  "focus-visible:ring-offset-2",
  "focus-visible:ring-offset-background",
];
const HIGHLIGHT_TOKENS = [
  "data-[highlighted]:bg-accent",
  "data-[highlighted]:text-accent-foreground",
];

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

/** Radix can miss the first keydown right after hydration — retry Space. */
async function openMenuByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

async function tabToOverflowTrigger(page: Page, max = 200) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    (document.documentElement as HTMLElement).focus?.();
  });
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const onTrigger = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return false;
      const inCrumb = !!el.closest('nav[aria-label="Breadcrumb"]');
      const label = el.getAttribute("aria-label") ?? "";
      return inCrumb && /Show \d+ hidden breadcrumb/.test(label);
    });
    if (onTrigger) return;
  }
  throw new Error("Never reached the overflow trigger via Tab");
}

function classHas(regex: string) {
  return new RegExp(`(?:^|\\s)${regex.replace(/[/[\]]/g, (m) => `\\${m}`)}(?:\\s|$)`);
}

test.describe("Breadcrumbs — overflow dropdown token contract", () => {
  for (const theme of THEMES) {
    test(`${theme} · highlight + focus-ring tokens survive keyboard flow`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      // 1 — Tab focus lands on the overflow trigger.
      await tabToOverflowTrigger(page);
      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger).toBeFocused();
      expect(
        await trigger.evaluate((el) => el.matches(":focus-visible")),
        "trigger paints :focus-visible after Tab",
      ).toBe(true);

      // 2 — Trigger className carries every focus-ring token.
      for (const token of FOCUS_RING_TOKENS) {
        await expect(trigger, `trigger keeps ${token}`).toHaveClass(classHas(token));
      }

      // 3 — Open the menu; ArrowDown highlights item 0.
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu opens on Space").toBeVisible();
      await page.keyboard.press("ArrowDown");

      const highlighted = menu.locator("[data-highlighted]").first();
      await expect(highlighted, "first item receives data-highlighted").toBeVisible();
      await expect(highlighted).toHaveAttribute("data-highlighted", /.*/);

      // 4 — Highlighted item carries the accent tokens.
      for (const token of HIGHLIGHT_TOKENS) {
        await expect(highlighted, `highlighted keeps ${token}`).toHaveClass(classHas(token));
      }

      // 5 — Runtime sanity: accent token actually cascaded (not transparent).
      const bg = await highlighted.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, "highlighted background non-empty").not.toBe("");
      expect(bg, "highlighted background not fully transparent").not.toMatch(
        /rgba?\([^)]*,\s*0\s*\)$/,
      );
      expect(bg, 'highlighted background not the "transparent" keyword').not.toBe(
        "rgba(0, 0, 0, 0)",
      );

      // 6 — Escape closes the menu, focus returns to trigger, ring still on.
      await page.keyboard.press("Escape");
      await expect(menu, "menu closes on Escape").toHaveCount(0);
      await expect(trigger, "focus restored to trigger").toBeFocused();
      expect(
        await trigger.evaluate((el) => el.matches(":focus-visible")),
        "trigger keeps :focus-visible after Escape",
      ).toBe(true);
      for (const token of FOCUS_RING_TOKENS) {
        await expect(trigger, `trigger still keeps ${token} post-Escape`).toHaveClass(
          classHas(token),
        );
      }
    });
  }
});
