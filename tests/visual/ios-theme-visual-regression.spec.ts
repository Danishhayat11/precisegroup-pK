import { expect, test, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * Visual regression suite for the iOS dashboard theme (`[data-theme="ios"]`).
 *
 * Covers the surfaces that carry the pearl-glass palette and are most
 * exposed to token drift:
 *   - route bodies (tables, KPIs, forms)
 *   - the app shell header (topbar chrome, sidebar rail, global search trigger)
 *   - overlay surfaces: CommandDialog (⌘K search), user DropdownMenu popover
 *
 * Runs each route at two viewports so a change to the pearl-glass tokens or
 * responsive breakpoints is caught on both desktop and tablet.
 *
 * Baselines are auto-generated on first run into
 *   tests/visual/ios-theme-visual-regression.spec.ts-snapshots/
 * and must be committed. Update with:
 *   bunx playwright test tests/visual/ios-theme-visual-regression.spec.ts --update-snapshots
 *
 * Requires an injected Supabase session
 * (LOVABLE_BROWSER_AUTH_STATUS=injected). External / unmanaged projects
 * skip the suite gracefully.
 */

type Viewport = { name: "desktop" | "tablet"; width: number; height: number };

const VIEWPORTS: readonly Viewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 1366 },
];

// Route surfaces to snapshot. Chosen for coverage of iOS theme primitives:
//   dashboard → KPIs + gradient canvas
//   bookings  → data table + pearl-glass row chrome
//   ledger    → dense table + numeric alignment
//   payments  → forms + inputs + badges
//   reports   → cards + charts
//   settings  → tabs + section panels
const ROUTES = [
  { path: "/dashboard", name: "dashboard" },
  { path: "/bookings", name: "bookings" },
  { path: "/ledger", name: "ledger" },
  { path: "/payments", name: "payments" },
  { path: "/reports", name: "reports" },
  { path: "/settings", name: "settings" },
] as const;

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

async function primeIosTheme(page: Page) {
  // The iOS palette is toggled via `[data-theme="ios"]` on the AppShell.
  // Reduced motion + light color-scheme keep the pearl-glass baseline stable.
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("precise.theme", "light");
    } catch {
      /* noop */
    }
  });
}

async function waitForSettled(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  // The AppShell root carries data-theme="ios" — wait for it so we never
  // snapshot the pre-hydration marketing shell.
  await page
    .locator('[data-theme="ios"]')
    .first()
    .waitFor({ state: "attached", timeout: 15_000 })
    .catch(() => {
      /* screenshot will surface the failure */
    });

  await page
    .locator('[data-loading="true"], .animate-pulse, [role="status"]')
    .first()
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {
      /* skeleton may legitimately persist */
    });

  await page.waitForTimeout(400);
}

async function snapshot(page: Page, name: string) {
  await page.addStyleTag({ content: VISUAL_FREEZE_CSS });
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.02,
    mask: [
      page.locator("[data-live-time]"),
      page.locator('[data-testid="live-time"]'),
      page.locator('[data-testid="user-menu"], [data-user-chip]'),
      page.getByText(/overdue installments\s+—/i),
    ],
  });
}

test.describe("iOS dashboard theme — route bodies", () => {
  test.skip(
    !authAvailable(),
    "Requires an injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );

  for (const viewport of VIEWPORTS) {
    for (const { path, name } of ROUTES) {
      test(`${name} — ${viewport.name}`, async ({ context, page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await primeIosTheme(page);
        await restoreSupabaseSession(context, page);
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await waitForSettled(page);

        // Guard against silent theme regression — the iOS shell must have
        // mounted before we spend time on a pixel-diff.
        const hasIos = await page.locator('[data-theme="ios"]').first().count();
        expect(hasIos, `[data-theme="ios"] must be present on ${path}`).toBeGreaterThan(0);

        await snapshot(page, `${name}-${viewport.name}.png`);
      });
    }
  }
});

test.describe("iOS dashboard theme — shell chrome & overlays", () => {
  test.skip(
    !authAvailable(),
    "Requires an injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );

  test("header topbar — desktop", async ({ context, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await primeIosTheme(page);
    await restoreSupabaseSession(context, page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForSettled(page);
    await page.addStyleTag({ content: VISUAL_FREEZE_CSS });

    const header = page.locator("header").first();
    await expect(header).toBeVisible();
    await expect(header).toHaveScreenshot("header-topbar-desktop.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.02,
      mask: [page.locator('[data-testid="user-menu"], [data-user-chip]')],
    });
  });

  test("command dialog (⌘K search modal) — desktop", async ({ context, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await primeIosTheme(page);
    await restoreSupabaseSession(context, page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForSettled(page);

    // Open via keyboard hotkey wired up by useGlobalSearchHotkey.
    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog").first();
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(200);
    await page.addStyleTag({ content: VISUAL_FREEZE_CSS });

    await expect(dialog).toHaveScreenshot("command-dialog-empty-desktop.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.02,
    });
  });

  test("user dropdown popover — desktop", async ({ context, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await primeIosTheme(page);
    await restoreSupabaseSession(context, page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForSettled(page);

    // The user chip is the only DropdownMenuTrigger in the topbar.
    const trigger = page
      .locator('header [data-slot="dropdown-menu-trigger"], header button:has-text("@")')
      .first();
    // Fall back to any button inside the header that opens a menu.
    const menuTrigger = (await trigger.count())
      ? trigger
      : page.locator('header button[aria-haspopup="menu"]').first();
    await menuTrigger.click();

    const menu = page.getByRole("menu").first();
    await menu.waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(150);
    await page.addStyleTag({ content: VISUAL_FREEZE_CSS });

    await expect(menu).toHaveScreenshot("user-dropdown-menu-desktop.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.02,
    });
  });
});
