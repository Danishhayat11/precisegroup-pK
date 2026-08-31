import { expect, test, type Page } from "@playwright/test";

/**
 * Rapid light/dark toggle stress: after every flip the runtime must keep
 * exactly ONE <meta name="theme-color"> in <head> AND its `content` must
 * match the just-selected theme. This guards against two subtle regressions:
 *
 *   1. Duplicate meta insertion — if the ThemeProvider ever mounts a fresh
 *      <meta> instead of mutating the existing one, repeated toggles
 *      accumulate stale tags in <head>.
 *   2. Stale content — if the class swap and the meta-content update fall
 *      out of sync (e.g. one runs in a layout effect, the other in an
 *      effect), a fast toggle can leave the meta stuck on the previous
 *      theme's color even though <html.dark> already flipped.
 *
 * Toggling is done through the real ThemeToggle UI (menu → item click) —
 * no direct localStorage writes — so this exercises the same code path a
 * user hits.
 */

const STORAGE_KEY = "precise.theme";
const LIGHT_COLOR = "#F8FAFC";
const DARK_COLOR = "#070B14";
const CYCLES = 6; // 6 alternations → 12 total flips

async function openThemeMenu(page: Page) {
  const trigger = page.locator('header button[aria-label*="Change theme"]:visible').first();
  await expect(trigger).toBeVisible();
  await expect(async () => {
    await trigger.click();
    await expect(trigger).toHaveAttribute("data-state", "open", { timeout: 500 });
  }).toPass({ intervals: [100, 200, 400, 800], timeout: 5000 });
}

async function pickTheme(page: Page, label: "Light" | "Dark") {
  await openThemeMenu(page);
  const item = page.getByRole("menuitemradio", { name: new RegExp(`^${label}\\b`) });
  await item.click();
  // Wait for Radix to fully unmount the menu portal — clicking the trigger
  // again while it's mid-close reopens it into the same state and breaks
  // the next iteration.
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
}

async function readThemeMeta(page: Page) {
  return page.evaluate(() => {
    const metas = Array.from(
      document.head.querySelectorAll('meta[name="theme-color"]'),
    ) as HTMLMetaElement[];
    return {
      count: metas.length,
      contents: metas.map((m) => m.getAttribute("content") ?? ""),
      hasDarkClass: document.documentElement.classList.contains("dark"),
      colorScheme: document.documentElement.style.colorScheme,
    };
  });
}

test("rapid light/dark toggle: theme-color meta count stays 1 and content tracks the active theme", async ({
  page,
}) => {
  // Deterministic OS pref + starting theme so "Light" is a real change from
  // any prior test's leftover state, and animations are pinned off.
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript((k) => {
    try {
      localStorage.setItem(k, "light");
    } catch {}
  }, STORAGE_KEY);

  await page.goto("/site", { waitUntil: "load" });
  await page.waitForLoadState("networkidle");

  // Baseline invariant before any interaction.
  const baseline = await readThemeMeta(page);
  expect(baseline.count, "baseline: one theme-color meta").toBe(1);
  expect(baseline.contents[0]).toBe(LIGHT_COLOR);
  expect(baseline.hasDarkClass).toBe(false);

  // Alternating Dark / Light picks. After each pick we assert the
  // full invariant snapshot — count === 1, content === expected literal,
  // <html class="dark"> and color-scheme in agreement.
  const sequence: Array<{ pick: "Dark" | "Light"; expectedColor: string; expectedDark: boolean }> =
    [];
  for (let i = 0; i < CYCLES; i++) {
    sequence.push({ pick: "Dark", expectedColor: DARK_COLOR, expectedDark: true });
    sequence.push({ pick: "Light", expectedColor: LIGHT_COLOR, expectedDark: false });
  }

  for (const [i, step] of sequence.entries()) {
    await pickTheme(page, step.pick);

    // Wait for the DOM to reach the expected state — the class swap and
    // meta-content update should both happen inside the same layout effect,
    // so this settles within a frame. Bounded so a real hang fails fast.
    await expect
      .poll(async () => (await readThemeMeta(page)).contents[0], {
        message: `step ${i} (${step.pick}): meta content should be ${step.expectedColor}`,
        timeout: 2000,
      })
      .toBe(step.expectedColor);

    const snap = await readThemeMeta(page);
    expect(
      snap.count,
      `step ${i} (${step.pick}): exactly one <meta name="theme-color"> (got ${JSON.stringify(snap.contents)})`,
    ).toBe(1);
    expect(snap.hasDarkClass, `step ${i}: .dark class matches pick`).toBe(step.expectedDark);
    expect(snap.colorScheme, `step ${i}: color-scheme matches pick`).toBe(
      step.expectedDark ? "dark" : "light",
    );
  }

  // Final sanity: the ONE meta element identity is preserved across the
  // whole run (i.e. the app mutated the same node, never replaced or
  // shadowed it). If the element had been swapped, `id` would remain but
  // a stale duplicate might too — we already checked count above, this
  // just confirms the survivor is the original app-managed node.
  const finalMetaId = await page.evaluate(
    () => document.head.querySelector('meta[name="theme-color"]')?.getAttribute("id") ?? null,
  );
  expect(finalMetaId, "the surviving theme-color meta is the app-managed one").toBe(
    "app-theme-color",
  );
});
