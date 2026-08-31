import { expect, test, type Page, type Locator } from "@playwright/test";

/**
 * Visual regression for the marketing header + hero area, captured in BOTH
 * light and dark AFTER toggling the theme in place — no reload between
 * captures. The point is to prove that:
 *
 *   1. The runtime theme swap (ThemeProvider's `useLayoutEffect` applying
 *      `.dark` and `color-scheme`) actually repaints every themed pixel in
 *      the header/hero — no stale server-rendered colors linger.
 *   2. Both modes render pixel-stably run-over-run so downstream token /
 *      component edits that inadvertently break dark mode surface here as
 *      a snapshot diff instead of a silent regression.
 *
 * Snapshots are element screenshots (not full-page) scoped to the
 * `<header>` and the hero `<section>` on `/site`, so unrelated below-the-fold
 * content churn (project cards, footer copy) doesn't flap this suite.
 *
 * Baselines live in `tests/visual/theme-toggle-header-hero.spec.ts-snapshots/`
 * (Playwright default). Bootstrap or refresh with:
 *
 *   bunx playwright test tests/visual/theme-toggle-header-hero.spec.ts \
 *     --update-snapshots --project=chromium-reduced-motion
 */

const STORAGE_KEY = "precise.theme";

async function openThemeMenu(page: Page) {
  const trigger = page.locator('header button[aria-label*="Change theme"]:visible').first();
  await expect(trigger).toBeVisible();
  // Retry across the SSR→hydration gap: clicking before Radix binds is a no-op.
  await expect(async () => {
    await trigger.click();
    await expect(trigger).toHaveAttribute("data-state", "open", { timeout: 500 });
  }).toPass({ intervals: [100, 200, 400, 800], timeout: 5000 });
}

async function pickTheme(page: Page, label: "Light" | "Dark") {
  await openThemeMenu(page);
  // Menu items are portalled outside <header>; anchor by name so "Light"
  // can't fuzzy-match "System" via substring.
  const item = page.getByRole("menuitemradio", { name: new RegExp(`^${label}\\b`) });
  await item.click();
  // Wait until Radix has fully closed the menu — capturing during the
  // close animation would introduce flake between runs.
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
}

async function settleForCapture(page: Page, hero: Locator) {
  // Hero uses a background <img> that's `fetchpriority="high"` + preloaded,
  // but wait until it's actually decoded so the snapshot isn't a race.
  const heroImg = hero.locator("img").first();
  if (await heroImg.count()) {
    await heroImg.evaluate((el: HTMLImageElement) =>
      el.complete ? null : el.decode().catch(() => null),
    );
  }
  // Web fonts (DM Serif Display + Fira Sans) — swap-in shifts metrics.
  await page.evaluate(() => document.fonts?.ready);
  // Steady the layout: kill blinking carets and pending transitions.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
}

test("header + hero: toggle from light → dark without reload matches snapshots", async ({
  page,
}) => {
  // Deterministic starting point. `emulateMedia` locks the system pref so
  // "System" resolves to light and reduced-motion pins animations off.
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

  // Seed an explicit "light" override BEFORE first navigation so the
  // pre-hydration script paints light immediately (no flash) regardless of
  // whatever the previous test left in this context's storage.
  await page.addInitScript(
    ([k]) => {
      try {
        localStorage.setItem(k, "light");
      } catch {}
    },
    [STORAGE_KEY] as const,
  );

  await page.goto("/site", { waitUntil: "load" });
  await page.waitForLoadState("networkidle");

  const header = page.locator("header").first();
  const hero = page.locator("main section").first();
  await expect(header).toBeVisible();
  await expect(hero).toBeVisible();

  // ---- Capture 1: LIGHT ------------------------------------------------
  await settleForCapture(page, hero);
  await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
  await expect(header).toHaveScreenshot("header-light.png", {
    maxDiffPixelRatio: 0.01,
    animations: "disabled",
  });
  await expect(hero).toHaveScreenshot("hero-light.png", {
    maxDiffPixelRatio: 0.01,
    animations: "disabled",
  });

  // ---- Toggle to Dark IN PLACE (no reload) ----------------------------
  await pickTheme(page, "Dark");
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  // Prove no reload happened — a full document reload resets timeOrigin.
  const originAfterToggle = await page.evaluate(() => performance.timeOrigin);
  const originAgain = await page.evaluate(() => performance.timeOrigin);
  expect(originAgain).toBe(originAfterToggle);

  // ---- Capture 2: DARK -------------------------------------------------
  await settleForCapture(page, hero);
  await expect(header).toHaveScreenshot("header-dark.png", {
    maxDiffPixelRatio: 0.01,
    animations: "disabled",
  });
  await expect(hero).toHaveScreenshot("hero-dark.png", {
    maxDiffPixelRatio: 0.01,
    animations: "disabled",
  });

  // ---- Toggle back to Light — must match the ORIGINAL light snapshot ---
  // (guards against irreversible mutations like leftover inline styles or
  // classnames appended by the toggle path.)
  await pickTheme(page, "Light");
  await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
  await settleForCapture(page, hero);
  await expect(header).toHaveScreenshot("header-light.png", {
    maxDiffPixelRatio: 0.01,
    animations: "disabled",
  });
  await expect(hero).toHaveScreenshot("hero-light.png", {
    maxDiffPixelRatio: 0.01,
    animations: "disabled",
  });
});
