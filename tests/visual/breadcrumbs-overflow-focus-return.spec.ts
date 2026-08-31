import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow menu focus management contract.
 *
 * Keyboard focus MUST behave predictably around the overflow dropdown:
 *   1. Opening the menu moves focus onto the first menuitem (Radix's
 *      auto-focus contract for keyboard-triggered dropdowns).
 *   2. Pressing Escape closes the menu AND returns focus to the trigger
 *      so keyboard users don't get dumped at <body>.
 *   3. Selecting a row (Enter) closes the menu and — because navigation
 *      replaces the trigger — either lands focus back on the fresh
 *      overflow trigger or, if the destination has no overflow, on a
 *      breadcrumb element (never on a stale/detached node or <body>).
 *
 * We assert focus by reading document.activeElement inside the page so
 * the test tracks what an AT / keyboard user actually experiences,
 * not just DOM structure.
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

/** Describe the currently focused element in a form we can assert on. */
async function readActive(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { tag: el?.tagName ?? "BODY", role: null, label: null, isBody: true };
    }
    return {
      tag: el.tagName,
      role: el.getAttribute("role"),
      label: el.getAttribute("aria-label"),
      isBody: false,
    };
  });
}

test.describe("Breadcrumbs — overflow menu focus returns to trigger", () => {
  for (const theme of THEMES) {
    test(`${theme} · opening moves focus to first item; Escape returns focus to trigger`, async ({
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

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();

      // 1. Focus lands on the first menuitem after keyboard-open.
      //    Radix highlights the first item AND moves DOM focus to it.
      await page.waitForFunction(
        () => {
          const active = document.activeElement as HTMLElement | null;
          return !!active && active.getAttribute("role") === "menuitem";
        },
        undefined,
        { timeout: 2000 },
      );

      const firstItemFocused = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        const active = document.activeElement as HTMLElement | null;
        return items.length > 0 && items[0] === active;
      });
      expect(firstItemFocused, "first menuitem receives focus on open").toBe(true);

      // 2. Escape closes the menu and restores focus to the trigger.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu"), "menu closes on Escape").toHaveCount(0);

      await page.waitForFunction(
        () => {
          const active = document.activeElement as HTMLElement | null;
          const label = active?.getAttribute("aria-label") ?? "";
          return active?.tagName === "BUTTON" && /hidden breadcrumb/i.test(label);
        },
        undefined,
        { timeout: 2000 },
      );

      const afterEscape = await readActive(page);
      expect(afterEscape.isBody, "focus is not dropped to <body> after Escape").toBe(false);
      expect(afterEscape.tag, "focus returns to a button element").toBe("BUTTON");
      expect(afterEscape.label ?? "", "focus returns to the overflow trigger").toMatch(
        /hidden breadcrumb/i,
      );
    });

    test(`${theme} · selecting a row closes the menu without stranding focus on <body>`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger).toBeVisible();

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu).toBeVisible();

      // Enter fires the highlighted row (first item after auto-highlight).
      await page.waitForFunction(
        () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
        undefined,
        { timeout: 2000 },
      );
      await page.keyboard.press("Enter");

      // Menu must close.
      await expect(page.getByRole("menu"), "menu closes after selection").toHaveCount(0);

      // Wait for the router to settle (URL changed away from fixture end).
      await page.waitForFunction((start) => window.location.pathname !== start, FIXTURE_URL, {
        timeout: 5000,
      });

      // Focus must not be stranded at <body>. Radix restores focus to
      // the trigger on close; after navigation the trigger may have
      // re-rendered, so accept either the new overflow trigger OR any
      // element inside the breadcrumb nav — but never bare <body>.
      const active = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        return {
          isBody: !el || el === document.body,
          insideBreadcrumb: !!(nav && el && nav.contains(el)),
          tag: el?.tagName ?? "BODY",
          label: el?.getAttribute("aria-label") ?? null,
        };
      });

      expect(active.isBody, "focus is not stranded on <body> after selection").toBe(false);
      expect(
        active.insideBreadcrumb,
        `focus stays within the breadcrumb after selection (got <${active.tag}> "${active.label ?? ""}")`,
      ).toBe(true);
    });
  }
});
