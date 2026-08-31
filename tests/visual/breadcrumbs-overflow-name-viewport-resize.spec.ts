import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow trigger accessible-name stability across
 * viewport resizes, in both light and dark themes.
 *
 * Why this exists (separate from the base accessible-name spec):
 *   • That spec locks the name to itself between collapsed and expanded.
 *   • This spec locks the name across *layout reflows*: mobile → tablet →
 *     desktop. If a future refactor makes the collapse logic
 *     width-based instead of count-based, the label's "N hidden
 *     breadcrumb(s)" could silently drift between viewports, which is
 *     jarring for AT users who often resize (rotation, split view).
 *
 * Contract enforced here:
 *   1. At every tested viewport width the trigger renders and has a
 *      non-empty accessible name matching /^Show \d+ hidden breadcrumbs?$/.
 *   2. The name is identical across all viewports within a theme.
 *   3. The name is identical across light and dark themes.
 *   4. Opening the re-rendered menu after each resize surfaces exactly
 *      the number of menuitems the trigger label promises — the name
 *      never falls out of sync with the actual overflow contents.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

// Small phone → large phone → tablet portrait → tablet landscape → desktop.
// Chosen to straddle common Tailwind breakpoints (sm/md/lg/xl) so a width-
// based collapse refactor would flip at least one boundary.
const VIEWPORTS = [
  { name: "mobile-narrow", width: 360, height: 800 },
  { name: "mobile-wide", width: 480, height: 800 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1280, height: 900 },
  { name: "desktop-wide", width: 1600, height: 1000 },
] as const;

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

/** Resolve the accessible name the way an AT would (label → text). */
async function accessibleName(page: Page): Promise<string> {
  const trigger = page.locator(
    'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
  );
  await expect(trigger, "overflow trigger visible after reflow").toBeVisible();
  const label = (await trigger.getAttribute("aria-label")) ?? "";
  return label.trim();
}

async function openAndCountItems(page: Page): Promise<number> {
  const trigger = page.locator(
    'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
  );
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.focus();
    await trigger.press(" ");
    if (await menu.count()) break;
    await page.waitForTimeout(200);
  }
  await expect(menu, "menu opens after resize re-render").toBeVisible();
  const count = await menu.getByRole("menuitem").count();
  await page.keyboard.press("Escape");
  await expect(menu, "menu closes cleanly").toHaveCount(0);
  return count;
}

test.describe("Breadcrumbs overflow trigger — accessible name stable across viewport resize", () => {
  for (const theme of THEMES) {
    test(`${theme} · trigger name and menu contents stay consistent across viewports`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      // Start at the widest viewport, then progressively shrink and grow
      // so we exercise re-renders in both directions.
      await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const namePattern = /^Show \d+ hidden breadcrumbs?$/;
      const observed: Array<{ vp: string; name: string; itemCount: number }> = [];

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // Let the layout settle (Radix measure + React commit).
        await page.waitForTimeout(150);

        const name = await accessibleName(page);
        expect(name, `[${theme}/${vp.name}] name non-empty`).not.toBe("");
        expect(name, `[${theme}/${vp.name}] name matches "Show N hidden breadcrumb(s)"`).toMatch(
          namePattern,
        );

        // The number in the label must match the actual menu contents.
        const promised = Number(name.match(/\d+/)?.[0] ?? "0");
        const actual = await openAndCountItems(page);
        expect(actual, `[${theme}/${vp.name}] menu items match label count`).toBe(promised);
        // Singular/plural must agree with the count.
        const shouldBePlural = promised !== 1;
        expect(
          /breadcrumbs$/.test(name),
          `[${theme}/${vp.name}] plural form matches count ${promised}`,
        ).toBe(shouldBePlural);

        observed.push({ vp: vp.name, name, itemCount: actual });
      }

      // Cross-viewport invariant: every entry has the same name. If a
      // future refactor makes collapse width-based, this fails loudly.
      const distinctNames = new Set(observed.map((o) => o.name));
      expect(
        distinctNames.size,
        `[${theme}] trigger name identical across viewports (saw: ${JSON.stringify(observed)})`,
      ).toBe(1);
    });
  }

  test("trigger name is identical between light and dark at every viewport", async ({
    browser,
  }) => {
    async function collect(theme: "light" | "dark") {
      const context = await browser.newContext();
      const page = await context.newPage();
      await forceTheme(page, theme);
      await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const names: Record<string, string> = {};
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(150);
        names[vp.name] = await accessibleName(page);
      }
      await context.close();
      return names;
    }

    const [light, dark] = await Promise.all([collect("light"), collect("dark")]);
    for (const vp of VIEWPORTS) {
      expect(
        dark[vp.name],
        `[${vp.name}] dark accessible name matches light ("${light[vp.name]}" vs "${dark[vp.name]}")`,
      ).toBe(light[vp.name]);
    }
  });
});
