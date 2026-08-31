import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end dark-mode toggle behavior on the marketing header.
 *
 * Exercises the full user path — click the sun/moon dropdown, pick a
 * theme, verify:
 *
 *   1. The <html class="dark"> and <html style="color-scheme"> flip in
 *      place (no reload — see `__noReload` marker below).
 *   2. The `<meta name="theme-color">` content swaps to the seeded
 *      literal (#F8FAFC light / #070B14 dark), and stays a single
 *      element (no dedupe regressions from the swap).
 *   3. localStorage['precise.theme'] persists the choice.
 *   4. A subsequent hard reload rehydrates the SAME theme — proves the
 *      pre-hydration script in __root.tsx reads persisted state.
 *
 * The ThemeToggle lives in SiteHeader (mounted on every /site route)
 * with aria-label starting with "Theme:" and ending in "Change theme.".
 * Its dropdown uses Radix RadioGroup, so items expose role="menuitemradio"
 * named "Light", "Dark", "System" (with an extra hint appended via
 * aria-label — matched with a starts-with regex below).
 */

const STORAGE_KEY = "precise.theme";
const LIGHT_COLOR = "#F8FAFC";
const DARK_COLOR = "#070B14";

async function openThemeMenu(page: Page) {
  // Radix dropdown trigger. Both a desktop and a mobile ThemeToggle
  // mount inside <header> — only one is visible per viewport, so
  // filter by `:visible` to pick the right instance.
  const trigger = page.locator('header button[aria-label*="Change theme"]:visible').first();
  await expect(trigger, "header ThemeToggle trigger must be visible").toBeVisible();
  await expect(trigger).toHaveAttribute("data-state", "closed");

  // Under SSR, the server ships the trigger with data-state="closed"
  // before React attaches click listeners. Clicking during that
  // hydration gap is a no-op and Radix stays closed. Retry until the
  // click actually flips data-state — bounded so a real regression
  // still fails fast.
  await expect(async () => {
    await trigger.click();
    await expect(trigger).toHaveAttribute("data-state", "open", { timeout: 500 });
  }).toPass({ intervals: [100, 200, 400, 800], timeout: 5000 });
}

async function pickTheme(page: Page, label: "Light" | "Dark" | "System") {
  await openThemeMenu(page);
  // Radix menu portals outside <header>; match at page scope. Use an
  // anchored regex so "Light" doesn't accidentally match "System" via
  // substring.
  // Items are role="menuitemradio" and their aria-label starts with the
  // visible label ("Light. Always light theme."), so anchor the regex.
  const item = page.getByRole("menuitemradio", { name: new RegExp(`^${label}\\b`) });
  await item.click();
}

async function readState(page: Page) {
  return page.evaluate(
    (key) => ({
      hasDarkClass: document.documentElement.classList.contains("dark"),
      colorScheme: document.documentElement.style.colorScheme,
      stored: window.localStorage.getItem(key),
      themeColorCount: document.head.querySelectorAll('meta[name="theme-color"]').length,
      themeColorContent:
        document.head.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
      // performance.timeOrigin is stable for the lifetime of a document
      // and changes on every full document load (reload / cross-doc nav).
      // Comparing two snapshots is a reliable "did we reload?" check
      // that no window property can mimic.
      timeOrigin: performance.timeOrigin,
    }),
    STORAGE_KEY,
  );
}

test("header dark-mode toggle persists and swaps theme without reload", async ({ page }) => {
  // Emulate a light OS preference so 'System' == light — makes the
  // dark/light distinction unambiguous when we toggle.
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/site", { waitUntil: "load" });
  // Wait for full hydration before interacting — clicking Radix
  // triggers pre-hydration is a no-op AND (under Vite dev) triggers a
  // reload as HMR settles, which corrupts the timeOrigin check below.
  await page.waitForLoadState("networkidle");

  // ---- Baseline: light theme, no persisted preference yet -----------
  const initial = await readState(page);
  expect(initial.hasDarkClass, "starts in light (no .dark on <html>)").toBe(false);
  expect(initial.colorScheme, "color-scheme reflects light").toBe("light");
  expect(initial.themeColorCount, 'exactly one <meta name="theme-color">').toBe(1);
  expect(initial.themeColorContent).toBe(LIGHT_COLOR);
  const initialOrigin = initial.timeOrigin;

  // ---- Click Dark -----------------------------------------------------
  await pickTheme(page, "Dark");
  // Radix animates the dropdown close; wait for the DOM mutation to
  // land rather than a fixed sleep.
  await expect
    .poll(async () => (await readState(page)).hasDarkClass, {
      message: "clicking Dark should add .dark to <html>",
      timeout: 2000,
    })
    .toBe(true);

  const afterDark = await readState(page);
  expect(afterDark.colorScheme).toBe("dark");
  expect(afterDark.themeColorCount, "theme-color meta must not duplicate on swap").toBe(1);
  expect(afterDark.themeColorContent, "theme-color content swaps to dark literal").toBe(DARK_COLOR);
  expect(afterDark.stored, "localStorage persists the choice").toBe("dark");
  expect(afterDark.timeOrigin, "toggle must NOT reload the page").toBe(initialOrigin);

  // ---- Click Light — swap back -----------------------------------------
  await pickTheme(page, "Light");
  await expect
    .poll(async () => (await readState(page)).hasDarkClass, { timeout: 2000 })
    .toBe(false);

  const afterLight = await readState(page);
  expect(afterLight.colorScheme).toBe("light");
  expect(afterLight.themeColorCount).toBe(1);
  expect(afterLight.themeColorContent).toBe(LIGHT_COLOR);
  expect(afterLight.stored).toBe("light");
  expect(afterLight.timeOrigin, "second swap also must not reload").toBe(initialOrigin);

  // ---- Re-select Dark, then hard reload — persistence check -----------
  await pickTheme(page, "Dark");
  await expect.poll(async () => (await readState(page)).stored, { timeout: 2000 }).toBe("dark");

  await page.reload({ waitUntil: "load" });

  const afterReload = await readState(page);
  expect(afterReload.timeOrigin, "reload must actually reload (new timeOrigin)").not.toBe(
    initialOrigin,
  );
  expect(afterReload.stored, "localStorage survives reload").toBe("dark");
  expect(afterReload.hasDarkClass, "pre-hydration script re-applies dark on cold load").toBe(true);
  expect(afterReload.colorScheme).toBe("dark");
  expect(afterReload.themeColorCount, "reload must not duplicate theme-color meta").toBe(1);
  expect(afterReload.themeColorContent).toBe(DARK_COLOR);
});
