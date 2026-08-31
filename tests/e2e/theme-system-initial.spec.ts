import { expect, test } from "@playwright/test";

/**
 * Initial theme must follow `prefers-color-scheme` when localStorage is empty.
 *
 * The pre-hydration script in src/lib/theme.tsx defaults to `"system"` when
 * nothing is stored, then reads `window.matchMedia('(prefers-color-scheme: dark)')`
 * to decide whether to add `class="dark"` and set `color-scheme` / theme-color
 * meta before React hydrates.
 *
 * These tests spin up isolated browser contexts with an explicit `colorScheme`
 * emulation, ensure localStorage is empty, then assert the first paint reflects
 * the OS preference — no toggle interaction involved.
 */

const STORAGE_KEY = "precise.theme";
const LIGHT_COLOR = "#F8FAFC";
const DARK_COLOR = "#070B14";

for (const scheme of ["dark", "light"] as const) {
  test(`initial theme follows prefers-color-scheme: ${scheme} when localStorage is empty`, async ({
    browser,
  }) => {
    // Fresh context — guarantees empty storage and lets us pin the OS-level
    // color scheme independently of the project-level default.
    const context = await browser.newContext({ colorScheme: scheme });

    try {
      const page = await context.newPage();

      // Land somewhere that mounts ThemeProvider. `/site` renders the marketing
      // header (same surface the sibling theme-toggle spec exercises).
      await page.goto("/site", { waitUntil: "domcontentloaded" });

      // Sanity: nothing persisted — this is the "empty localStorage" precondition.
      const stored = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
      expect(stored, "localStorage must be empty for this test to be meaningful").toBeNull();

      const html = page.locator("html");
      const meta = page.locator("meta#app-theme-color");

      if (scheme === "dark") {
        await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
        await expect(html).toHaveAttribute("style", /color-scheme:\s*dark/);
        await expect(meta).toHaveAttribute("content", DARK_COLOR);
      } else {
        await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
        await expect(html).toHaveAttribute("style", /color-scheme:\s*light/);
        await expect(meta).toHaveAttribute("content", LIGHT_COLOR);
      }

      // The pre-hydration script must not persist anything — persistence only
      // happens when the user explicitly picks a theme via the toggle.
      const storedAfter = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
      expect(storedAfter, "system default must not write to localStorage").toBeNull();
    } finally {
      await context.close();
    }
  });
}
