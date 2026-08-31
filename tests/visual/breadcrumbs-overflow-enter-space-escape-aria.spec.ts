import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow dropdown keyboard open/close ARIA contract.
 *
 * WAI-ARIA menu-button pattern: Enter AND Space must both open the menu,
 * Escape must close it, and `aria-expanded` must reflect the open state
 * at every transition. We run the whole cycle in light + dark so a
 * theme-specific regression (e.g. a portal that only mounts in one
 * theme, or a stale class-based state hook) surfaces here.
 *
 * The overflow trigger only exists in the collapsed state, so we use
 * the 5-segment fixture that forces `crumbs.length > MAX_VISIBLE`.
 */

const THEMES = ["light", "dark"] as const;
const OPEN_KEYS = ["Enter", " "] as const; // Space is the literal ' '
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

/**
 * Radix can drop the very first keydown after hydration. Retry the
 * requested open key a handful of times before failing so the assertion
 * that matters (aria-expanded flipping) isn't hidden by a flake.
 */
async function openMenuByKey(page: Page, trigger: Locator, key: string): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.focus();
    await trigger.press(key);
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

test.describe("Breadcrumbs overflow · Enter/Space open, Escape close, aria-expanded toggles", () => {
  for (const theme of THEMES) {
    for (const key of OPEN_KEYS) {
      const label = key === " " ? "Space" : key;
      test(`${theme} · ${label} opens, Escape closes, aria-expanded round-trips`, async ({
        page,
      }) => {
        await forceTheme(page, theme);
        await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts?.ready);
        await page.waitForTimeout(300);

        const trigger = page.locator(
          'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
        );
        await expect(trigger, "overflow trigger renders in collapsed state").toBeVisible();

        // ── Resting: menu closed, aria-expanded=false ──────────────
        await expect(trigger, `[${theme}/${label}] resting expanded=false`).toHaveAttribute(
          "aria-expanded",
          "false",
        );
        await expect(page.getByRole("menu"), `[${theme}/${label}] no menu at rest`).toHaveCount(0);

        // ── Open via the target key ────────────────────────────────
        const menu = await openMenuByKey(page, trigger, key);
        await expect(menu, `[${theme}/${label}] menu opens on ${label}`).toBeVisible();
        await expect(trigger, `[${theme}/${label}] expanded flips to true`).toHaveAttribute(
          "aria-expanded",
          "true",
        );

        // ── Close via Escape ───────────────────────────────────────
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("menu"),
          `[${theme}/${label}] menu unmounts on Escape`,
        ).toHaveCount(0);
        await expect(trigger, `[${theme}/${label}] expanded resets to false`).toHaveAttribute(
          "aria-expanded",
          "false",
        );

        // Escape returns focus to the trigger — required for keyboard users.
        const focusedLabel = await page.evaluate(
          () => document.activeElement?.getAttribute("aria-label") ?? null,
        );
        expect(focusedLabel, `[${theme}/${label}] focus returned to trigger after Escape`).toMatch(
          /hidden breadcrumb/i,
        );

        // ── Re-open with the same key to prove the toggle is idempotent ──
        const menu2 = await openMenuByKey(page, trigger, key);
        await expect(menu2, `[${theme}/${label}] menu re-opens on ${label}`).toBeVisible();
        await expect(trigger, `[${theme}/${label}] expanded true again`).toHaveAttribute(
          "aria-expanded",
          "true",
        );

        await page.keyboard.press("Escape");
        await expect(
          trigger,
          `[${theme}/${label}] expanded back to false after 2nd Escape`,
        ).toHaveAttribute("aria-expanded", "false");
      });
    }
  }
});
