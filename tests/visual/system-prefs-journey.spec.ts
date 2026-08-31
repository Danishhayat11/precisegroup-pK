import { expect, test, type Page } from "@playwright/test";

/**
 * Integration: system preference sync across a multi-route user journey.
 *
 * This spec complements `os-theme-swap.spec.ts` (which pins first-paint and
 * live-flip contracts on 1-2 routes) by asserting the SAME invariants hold
 * across a real navigation flow between multiple public routes, and that
 * `prefers-reduced-motion` is honored alongside `prefers-color-scheme`.
 *
 * Invariants per navigation step:
 *   1. <html>.classList.contains("dark") matches emulated color-scheme
 *   2. <html>.style.colorScheme === emulated color-scheme
 *   3. <html>[data-reduced-motion] === "reduce" | "no-preference"
 *   4. CSS variable --motion-scale on :root === "0" (reduce) | "1" (no-pref)
 *   5. <meta id="app-theme-color"> content matches THEME_COLOR_{LIGHT,DARK}
 *
 * Media flips happen DURING the journey (not just at first paint), so the
 * ThemeProvider's matchMedia listeners must react without a reload and
 * without a stale-state flash across TanStack Router client-side transitions.
 *
 * Run:  bunx playwright test tests/visual/system-prefs-journey.spec.ts
 *       bun run test:visual:system-prefs
 */

const THEME_STORAGE_KEY = "precise.theme";
const THEME_META_ID = "app-theme-color";
const THEME_COLOR_LIGHT = "#F8FAFC";
const THEME_COLOR_DARK = "#070B14";

// A three-route journey across the public marketing shell. All are SSR'd
// and reachable without auth, so the pre-hydration script runs on every
// hop and we can assert :root state immediately after navigation.
const JOURNEY = ["/", "/site", "/site/services"] as const;

type ColorScheme = "light" | "dark";
type MotionPref = "reduce" | "no-preference";

type RootState = {
  hasDark: boolean;
  colorScheme: string;
  dataReducedMotion: string | null;
  motionScale: string;
  themeColor: string | null;
};

async function clearStoredTheme(page: Page) {
  await page.addInitScript((k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  }, THEME_STORAGE_KEY);
}

async function readRootState(page: Page): Promise<RootState> {
  return page.evaluate((metaId) => {
    const root = document.documentElement;
    const meta = document.getElementById(metaId) as HTMLMetaElement | null;
    return {
      hasDark: root.classList.contains("dark"),
      colorScheme: root.style.colorScheme,
      dataReducedMotion: root.getAttribute("data-reduced-motion"),
      // Read the CSS custom property from the computed style of :root — this
      // is what components actually see when they do `var(--motion-scale)`.
      motionScale: getComputedStyle(root).getPropertyValue("--motion-scale").trim(),
      themeColor: meta?.getAttribute("content") ?? null,
    };
  }, THEME_META_ID);
}

function expectedThemeColor(scheme: ColorScheme) {
  return (scheme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT).toUpperCase();
}

async function expectRootMatchesPrefs(
  page: Page,
  scheme: ColorScheme,
  motion: MotionPref,
  ctx: string,
) {
  // Poll: matchMedia("change") → useSyncExternalStore → useLayoutEffect →
  // DOM mutation is synchronous but hydration and initial paint can race
  // with the assertion on a slow sandbox. Polling keeps this deterministic
  // without masking a genuine miss (the assertion still fails on timeout).
  await expect
    .poll(async () => await readRootState(page), { timeout: 3_000 })
    .toMatchObject({
      hasDark: scheme === "dark",
      colorScheme: scheme,
      dataReducedMotion: motion,
      motionScale: motion === "reduce" ? "0" : "1",
      themeColor: expect.any(String),
    });

  const state = await readRootState(page);
  expect(state.themeColor!.toUpperCase(), `theme-color meta @ ${ctx}`).toBe(
    expectedThemeColor(scheme),
  );
}

/**
 * Client-side navigation via TanStack Router's <Link>. Using the router's
 * own click semantics (not page.goto) is what exercises hydration + SPA
 * transitions — a full reload would re-run the pre-hydration script and
 * hide any stale-state bugs in the provider.
 */
async function clientNavigate(page: Page, href: (typeof JOURNEY)[number]) {
  // TanStack Router renders <a href="..."> under the hood. There can be
  // multiple links to the same route (header + footer + inline) — first is fine.
  const link = page.locator(`a[href="${href}"]`).first();
  if ((await link.count()) === 0) {
    // Fall back to a hard nav if the target isn't linked from the current page
    // (e.g. deep site route not in the current nav). This still validates
    // first-paint prefs sync, just not the SPA-transition path.
    await page.goto(href, { waitUntil: "domcontentloaded" });
    return;
  }
  await Promise.all([
    page.waitForURL((url) => url.pathname === href, { timeout: 5_000 }),
    link.click(),
  ]);
}

// ---------- 1. Full-journey matrix: every (scheme × motion) combo ----------
for (const scheme of ["light", "dark"] as const) {
  for (const motion of ["reduce", "no-preference"] as const) {
    test(`journey: :root tracks scheme=${scheme} motion=${motion} across ${JOURNEY.length} routes`, async ({
      page,
    }) => {
      await clearStoredTheme(page);
      // Emulate BEFORE first navigation so THEME_INIT_SCRIPT (in <head>)
      // sees the target prefs on first paint — no flash, no reconciliation.
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: motion });

      await page.goto(JOURNEY[0], { waitUntil: "domcontentloaded" });
      await expectRootMatchesPrefs(page, scheme, motion, `first paint ${JOURNEY[0]}`);

      for (const route of JOURNEY.slice(1)) {
        await clientNavigate(page, route);
        // After a client-side transition the ThemeProvider is NOT remounted,
        // so :root state must remain in sync without any reconciliation gap.
        await expectRootMatchesPrefs(page, scheme, motion, `after nav → ${route}`);
      }
    });
  }
}

// ---------- 2. Live media flips DURING the journey ----------
test("journey: live prefers-color-scheme flip propagates after each SPA nav", async ({ page }) => {
  await clearStoredTheme(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(JOURNEY[0], { waitUntil: "domcontentloaded" });
  // Provider's matchMedia listener attaches in useEffect — wait past that.
  await page.waitForLoadState("networkidle");
  await expectRootMatchesPrefs(page, "light", "reduce", `first paint ${JOURNEY[0]}`);

  // Alternate scheme on each hop. Route change + OS flip in the same step
  // is the worst-case race for stale state / flicker.
  const sequence: Array<{ route: (typeof JOURNEY)[number]; scheme: ColorScheme }> = [
    { route: JOURNEY[1], scheme: "dark" },
    { route: JOURNEY[2], scheme: "light" },
  ];

  for (const { route, scheme } of sequence) {
    await page.emulateMedia({ colorScheme: scheme });
    await clientNavigate(page, route);
    await expectRootMatchesPrefs(page, scheme, "reduce", `${route} @ scheme=${scheme}`);
  }
});

test("journey: live prefers-reduced-motion flip propagates after each SPA nav", async ({
  page,
}) => {
  await clearStoredTheme(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto(JOURNEY[0], { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await expectRootMatchesPrefs(page, "light", "no-preference", `first paint ${JOURNEY[0]}`);

  const sequence: Array<{ route: (typeof JOURNEY)[number]; motion: MotionPref }> = [
    { route: JOURNEY[1], motion: "reduce" },
    { route: JOURNEY[2], motion: "no-preference" },
  ];

  for (const { route, motion } of sequence) {
    await page.emulateMedia({ reducedMotion: motion });
    await clientNavigate(page, route);
    await expectRootMatchesPrefs(page, "light", motion, `${route} @ motion=${motion}`);
  }
});

// ---------- 3. Explicit stored theme is immune to OS flips across routes ----------
// Guardrail: when the user has pinned "dark", walking through the journey
// while the OS pref oscillates must NOT recolor :root. This proves the SPA
// transitions don't accidentally re-subscribe to the media query when
// theme !== "system".
test("journey: pinned theme survives OS flips across SPA navigations", async ({ page }) => {
  await page.addInitScript(
    ([k, v]) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage unavailable */
      }
    },
    [THEME_STORAGE_KEY, "dark"] as const,
  );
  // Start with the OPPOSITE OS pref to prove the stored value wins.
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

  await page.goto(JOURNEY[0], { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await expectRootMatchesPrefs(page, "dark", "reduce", `first paint ${JOURNEY[0]}`);

  // Flip OS pref between every hop — pinned "dark" must hold.
  const sequence: Array<{ route: (typeof JOURNEY)[number]; osFlip: ColorScheme }> = [
    { route: JOURNEY[1], osFlip: "dark" },
    { route: JOURNEY[2], osFlip: "light" },
  ];

  for (const { route, osFlip } of sequence) {
    await page.emulateMedia({ colorScheme: osFlip });
    await clientNavigate(page, route);
    // Stored "dark" must remain regardless of OS pref oscillation.
    await expectRootMatchesPrefs(page, "dark", "reduce", `${route} @ OS=${osFlip}`);
  }
});
