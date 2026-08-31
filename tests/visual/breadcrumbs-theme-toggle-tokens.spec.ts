import { expect, test, type Page } from "@playwright/test";

/**
 * Breadcrumbs — cross-theme token stability (single page, live toggle).
 *
 * Complements `breadcrumbs-chevron-divider-tokens.spec.ts` (which loads
 * each theme fresh via `addInitScript`). This spec navigates ONCE, then
 * flips the theme in place on the running page and re-asserts the
 * chevron/divider token classes. If a future refactor conditionally
 * re-renders the trail on theme change and drops the tokenized classes,
 * that regression only shows up under a live toggle — not a cold reload.
 *
 * Exercises the full toggle matrix on both fixture states:
 *   • Expanded  (`/crumb-fixture/alpha/beta`)     — 3 chevrons, no overflow
 *   • Collapsed (`/crumb-fixture/a/b/c/d/e/f`)    — 4 chevrons + ellipsis
 *
 * For each state:
 *   light → assert → toggle → dark  → assert
 *   dark  → assert → toggle → light → assert
 *
 * So each state runs FOUR class-name checks (2 initial + 2 post-toggle).
 */

const CHEVRON_TOKEN = "text-muted-foreground/60";
const NAV_TOKEN = "text-muted-foreground";

const STATES = [
  { name: "expanded", url: "/crumb-fixture/alpha/beta", chevrons: 3, hasOverflow: false },
  { name: "collapsed", url: "/crumb-fixture/a/b/c/d/e/f", chevrons: 4, hasOverflow: true },
] as const;

const TOGGLE_SEQUENCES = [["light", "dark"] as const, ["dark", "light"] as const];

/** Pre-hydration theme write so first paint matches. */
async function primeTheme(page: Page, theme: "light" | "dark") {
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
 * Flip the theme on the LIVE page — mirrors what the in-app ThemeToggle
 * does: writes `precise.theme`, flips the `.dark` class on <html>, and
 * dispatches a `storage` event so any cross-tab listener re-syncs.
 */
async function switchThemeInPlace(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.evaluate((t) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* ignored */
    }
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
    root.style.colorScheme = t;
    window.dispatchEvent(new StorageEvent("storage", { key: "precise.theme", newValue: t }));
  }, theme);
}

/** Re-usable assertion pack; runs after every navigation AND every toggle. */
async function assertTokens(
  page: Page,
  state: (typeof STATES)[number],
  theme: "light" | "dark",
  phase: "initial" | "after-toggle",
) {
  const nav = page.locator('nav[aria-label="Breadcrumb"]').first();
  await expect(nav, `[${theme}/${phase}] breadcrumb nav visible`).toBeVisible();

  // Theme class actually lands on <html> — confirms the toggle applied.
  await expect(page.locator("html"), `[${theme}/${phase}] <html> reflects theme class`).toHaveClass(
    theme === "dark" ? /(?:^|\s)dark(?:\s|$)/ : /^(?!.*\bdark\b).*$/,
  );

  // 1. Nav wrapper keeps the base muted token.
  await expect(nav, `[${theme}/${phase}] nav keeps ${NAV_TOKEN}`).toHaveClass(
    new RegExp(`(?:^|\\s)${NAV_TOKEN}(?:\\s|$)`),
  );

  // 2. Chevron count is stable across themes (structure is theme-independent).
  const chevrons = nav.locator("svg.lucide-chevron-right");
  await expect(chevrons, `[${theme}/${phase}] chevron count`).toHaveCount(state.chevrons);

  // 3. Every chevron keeps the tokenized divider class.
  const total = await chevrons.count();
  for (let i = 0; i < total; i++) {
    await expect(
      chevrons.nth(i),
      `[${theme}/${phase}] chevron[${i}] keeps ${CHEVRON_TOKEN}`,
    ).toHaveClass(new RegExp(`(?:^|\\s)${CHEVRON_TOKEN.replace("/", "\\/")}(?:\\s|$)`));
  }

  // 4. Overflow trigger presence tracks the state, not the theme.
  const trigger = nav.locator('button[aria-label*="hidden breadcrumb" i]');
  if (state.hasOverflow) {
    await expect(trigger, `[${theme}/${phase}] overflow trigger visible`).toBeVisible();
  } else {
    await expect(trigger, `[${theme}/${phase}] no overflow trigger`).toHaveCount(0);
  }

  // 5. Chevron color resolves to a real, non-transparent value in this theme.
  //    We don't hard-code an rgb because Tailwind v4 compiles `/60` into an
  //    oklab color-mix whose serialised form varies by engine; the class-name
  //    contract above is the authoritative guard.
  const chevronColor = await chevrons.first().evaluate((el) => getComputedStyle(el).color);
  expect(chevronColor, `[${theme}/${phase}] chevron color non-empty`).not.toBe("");
  expect(chevronColor, `[${theme}/${phase}] chevron not fully transparent`).not.toMatch(
    /\/\s*0\s*\)$/,
  );
}

test.describe("Breadcrumbs — token classes survive live theme toggle", () => {
  for (const state of STATES) {
    for (const [from, to] of TOGGLE_SEQUENCES) {
      test(`${state.name} · ${from} → ${to} (in-place toggle)`, async ({ page }) => {
        await primeTheme(page, from);
        await page.goto(state.url, { waitUntil: "domcontentloaded" });

        // Let fonts + first paint settle so class attributes are final.
        await page.evaluate(() => document.fonts?.ready);
        await page.waitForTimeout(120);

        // Round 1 — initial theme, fresh navigation.
        await assertTokens(page, state, from, "initial");

        // Live toggle without reloading.
        await switchThemeInPlace(page, to);
        await page.waitForTimeout(120);

        // Round 2 — same DOM, opposite theme.
        await assertTokens(page, state, to, "after-toggle");
      });
    }
  }
});
