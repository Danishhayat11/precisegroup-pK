import { expect, test, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * Visual regression suite for the drifted authenticated dashboard/admin
 * pages — the ones grandfathered by `allow-raw-color-file` in the color-
 * audit guardrail (scripts/ci/no-hex-in-marketing-shell.mjs).
 *
 * Purpose: any future change to semantic color tokens in src/styles.css
 * (--background, --foreground, --success, --warning, --destructive,
 * --info, brand ramps) OR any refactor that swaps the raw palette
 * utilities for semantic tokens flips pixels on these pages. This suite
 * catches that drift immediately in both LIGHT and DARK themes.
 *
 * Baselines are auto-generated on first run into
 *   tests/visual/theme-drift-authed.spec.ts-snapshots/
 * and must be committed. Update with:
 *   bunx playwright test tests/visual/theme-drift-authed.spec.ts --update-snapshots
 *
 * Requires an injected Supabase session
 * (LOVABLE_BROWSER_AUTH_STATUS=injected). External/unmanaged projects
 * skip the suite; the guardrail script still runs in CI regardless.
 */

const PAGES = [
  { path: "/", name: "dashboard" }, // src/pages/Dashboard.tsx
  { path: "/audit", name: "audit-log" }, // src/pages/AuditLog.tsx
  { path: "/documents", name: "documents" }, // src/pages/Documents.tsx
  { path: "/my-requests", name: "my-requests" }, // src/pages/MyRequests.tsx
  { path: "/health", name: "data-health" }, // src/pages/DataHealth.tsx
  { path: "/reconciliation-diff", name: "reconciliation" }, // src/pages/ReconciliationDiff.tsx
  { path: "/import", name: "import-center" }, // src/pages/ImportCenter.tsx
] as const;

// Public route — no session needed, but is on the drifted list.
const PUBLIC_PAGES = [
  { path: "/login", name: "login" }, // src/pages/Login.tsx (auth hero)
] as const;

type ThemeMode = "light" | "dark";
const THEMES: readonly ThemeMode[] = ["light", "dark"];

/**
 * Freeze visual noise so screenshot diffs reflect token changes only,
 * never wall-clock timestamps, cursor blink, spinners, live query
 * indicators, or in-flight skeleton shimmer. Applied via addStyleTag
 * so it survives client-side navigations.
 */
const VISUAL_FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
  [data-testid="live-time"],
  [data-live-time],
  time,
  .relative-time { visibility: hidden !important; }
`;

async function setTheme(page: Page, mode: ThemeMode) {
  // Storage key mirrors THEME_STORAGE_KEY in src/lib/theme.tsx.
  await page.addInitScript((t: ThemeMode) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* noop */
    }
  }, mode);
  await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
}

/**
 * Wait for the app shell to settle. Authenticated pages fire many
 * queries in parallel and never reach `networkidle` (realtime channel
 * keeps a WS open) — instead we wait for the loading skeletons to
 * disappear and give React one paint to flush.
 */
async function waitForSettled(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page
    .waitForFunction(() => document.body && document.body.innerText.trim().length > 0, null, {
      timeout: 15_000,
    })
    .catch(() => {
      /* fall through — the screenshot will show the failure */
    });

  // Admin document gate flashes a "Verifying access…" state before hydration
  // resolves. Wait for it to clear so it can't half-render into the frame.
  await page
    .getByText(/Verifying access/i)
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {
      /* absent on non-admin pages */
    });

  // Any lingering skeletons — best-effort with short timeout.
  await page
    .locator('[data-loading="true"], .animate-pulse, [role="status"]')
    .first()
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {
      /* skeleton may persist for legit reasons */
    });

  // Give React one paint + one microtask cycle to flush the final layout.
  await page.waitForTimeout(500);
}

async function snapshot(page: Page, name: string) {
  await page.addStyleTag({ content: VISUAL_FREEZE_CSS });
  // Full-page screenshot with a generous but non-trivial diff budget:
  // token changes will move thousands of pixels; anti-alias noise
  // between runs is under 0.5% of the frame.
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.02,
    // Mask surfaces that carry data-derived text (counts, timestamps,
    // avatar chip, user email) — a background poll refreshing between
    // runs must not reshuffle the diff, and the guardrail's real job is
    // to catch token-color drift, not row-count drift.
    mask: [
      page.locator("[data-live-time]"),
      page.locator('[data-testid="live-time"]'),
      // OverdueAlertBar: "N clients have overdue installments" — count
      // varies with seed data + wall-clock cutoffs.
      page.getByText(/overdue installments\s+—/i),
      // Session chip in the shell header (avatar + email).
      page.locator('[data-testid="user-menu"], [data-user-chip]'),
    ],
  });
}

test.describe("drifted authed pages — token visual regression", () => {
  test.skip(
    !authAvailable(),
    "Requires an injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected). " +
      "Sign in via the Lovable preview so the session is minted, then re-run.",
  );

  for (const { path, name } of PAGES) {
    for (const theme of THEMES) {
      test(`${name} — ${theme}`, async ({ context, page }) => {
        await setTheme(page, theme);
        await restoreSupabaseSession(context, page);
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await waitForSettled(page);

        // Assert the theme actually applied — catches a silent regression
        // where the pre-hydration script fails and BOTH baselines drift
        // to the OS default.
        const cls = await page.evaluate(() => document.documentElement.className);
        if (theme === "dark") {
          expect(cls, `root should carry .dark on ${path}`).toContain("dark");
        } else {
          expect(cls, `root should not carry .dark on ${path}`).not.toContain("dark");
        }

        await snapshot(page, `${name}-${theme}.png`);
      });
    }
  }
});

test.describe("drifted public pages — token visual regression", () => {
  for (const { path, name } of PUBLIC_PAGES) {
    for (const theme of THEMES) {
      test(`${name} — ${theme}`, async ({ page }) => {
        await setTheme(page, theme);
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await waitForSettled(page);
        await snapshot(page, `${name}-${theme}.png`);
      });
    }
  }
});
