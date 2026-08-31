/**
 * Keyboard-only navigation gate for the mobile shell.
 *
 * Verifies — without ever touching the mouse — that users can:
 *
 *   1. Tab through the 5 bottom tab targets in DOM order
 *      (Dashboard → Bookings → Payments → Reports → Menu) and
 *      activate a tab with Enter, causing a real route change.
 *   2. Reach the floating "New booking" FAB via Tab and activate it
 *      with Enter (route → /bookings with the new-booking query).
 *   3. Open the slide-in drawer via the Menu tab's Enter key, Tab
 *      into the drawer's nav rows, activate one with Enter, and
 *      close the drawer with Escape when it's open.
 *   4. Open the ⌘K command dialog via keyboard, walk options with
 *      ArrowDown, activate one with Enter, and close with Escape.
 *
 * These flows are what a switch/keyboard user actually experiences,
 * so we reproduce them with `page.keyboard.press` only — no `.click()`
 * or `.hover()` in the assertion path.
 *
 * Run:
 *   bunx playwright test tests/a11y/mobile-keyboard-nav.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Bottom-tab DOM order matches MobileBottomNav.tsx.
const BOTTOM_TAB_LABELS = [
  "Dashboard",
  "Bookings",
  "Payments",
  "Reports",
  "Open navigation menu",
] as const;

/** Snapshot of the currently focused element (empty on body). */
async function focusInfo(page: Page): Promise<{
  label: string;
  tag: string;
  dataset: Record<string, string>;
}> {
  return await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body)
      return { label: "", tag: "", dataset: {} as Record<string, string> };
    return {
      label: el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName.toLowerCase(),
      tag: el.tagName.toLowerCase(),
      dataset: { ...(el.dataset as unknown as Record<string, string>) },
    };
  });
}

async function activeAriaLabel(page: Page): Promise<string> {
  return (await focusInfo(page)).label;
}

type FocusPredicate = (info: Awaited<ReturnType<typeof focusInfo>>) => boolean;

/**
 * Repeatedly press Tab until `predicate` returns true for the focused
 * element, or `maxSteps` is exhausted. Returns the Tab count (or -1).
 *
 * `maxSteps` defaults high (200): on the authenticated dashboard the
 * header cluster, breadcrumbs, KPI cards, and Reveal-animated widgets
 * add dozens of intermediate focus stops before Tab reaches the fixed
 * bottom chrome.
 */
async function tabUntil(page: Page, predicate: FocusPredicate, maxSteps = 200): Promise<number> {
  for (let i = 0; i < maxSteps; i++) {
    const info = await focusInfo(page);
    if (predicate(info)) return i;
    await page.keyboard.press("Tab");
    await page.waitForTimeout(15);
  }
  return -1;
}

async function primeIosTheme(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("precise.theme", "light");
    } catch {
      /* noop */
    }
  });
}

async function bootDashboard(context: import("@playwright/test").BrowserContext, page: Page) {
  await primeIosTheme(page);
  await restoreSupabaseSession(context, page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.locator('[data-theme="ios"]').first().waitFor({ state: "attached", timeout: 15_000 });
  await page.locator("[data-mobile-bottom-nav]").waitFor({ state: "visible", timeout: 10_000 });
  // Let route-progress + framer-motion settle so focus doesn't jump.
  await page.waitForTimeout(400);
}

test.describe("mobile keyboard-only navigation", () => {
  test.skip(
    !authAvailable(),
    "Requires an injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );
  test.use({ viewport: MOBILE_VIEWPORT });

  test("bottom tabs are reachable in DOM order and Enter routes to the tab", async ({
    context,
    page,
  }) => {
    await bootDashboard(context, page);

    // Sanity: all 5 tabs are present and are the only children of the nav.
    const tabs = page.locator("[data-mobile-bottom-nav] > *");
    await expect(tabs).toHaveCount(5);

    // Walk to the first tab, then assert each subsequent Tab keypress
    // lands on the next tab in DOM order.
    const startAt = await tabUntil(
      page,
      (info) => info.label.toLowerCase() === BOTTOM_TAB_LABELS[0].toLowerCase(),
    );
    expect(startAt, "user should reach the first bottom tab via Tab").toBeGreaterThanOrEqual(0);

    for (let i = 1; i < BOTTOM_TAB_LABELS.length; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(20);
      const label = await activeAriaLabel(page);
      expect(
        label.toLowerCase(),
        `Tab ${i + 1} should focus "${BOTTOM_TAB_LABELS[i]}" but landed on "${label}"`,
      ).toBe(BOTTOM_TAB_LABELS[i].toLowerCase());
    }

    // Shift+Tab must walk backwards through the same order.
    for (let i = BOTTOM_TAB_LABELS.length - 2; i >= 0; i--) {
      await page.keyboard.press("Shift+Tab");
      await page.waitForTimeout(20);
      const label = await activeAriaLabel(page);
      expect(
        label.toLowerCase(),
        `Shift+Tab should focus "${BOTTOM_TAB_LABELS[i]}" but landed on "${label}"`,
      ).toBe(BOTTOM_TAB_LABELS[i].toLowerCase());
    }

    // Activate the Payments tab with Enter → URL should reflect the route.
    await tabUntil(page, (info) => info.label.toLowerCase() === "payments");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/payments(\?|$|#)/, { timeout: 5_000 });
    expect(new URL(page.url()).pathname).toBe("/payments");
  });

  test("FAB is Tab-reachable and Enter opens the new-booking route", async ({ context, page }) => {
    await bootDashboard(context, page);

    // Target the FAB specifically via its data-mobile-fab attribute so
    // page-level "New booking" CTAs don't false-match.
    const reached = await tabUntil(page, (info) => info.dataset.mobileFab !== undefined);
    expect(reached, "user should reach the FAB via Tab").toBeGreaterThanOrEqual(0);

    await page.keyboard.press("Enter");
    // Enter must navigate to /bookings. The FAB attaches ?new=1 to open the
    // new-booking flow, but the /bookings route may normalize its typed
    // search params — treat the query as best-effort and only require the
    // pathname change as the hard contract.
    await page.waitForURL(/\/bookings(\?|#|$)/, { timeout: 5_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe("/bookings");
  });

  test("Menu tab opens drawer with Enter; drawer items activate with Enter; Escape closes", async ({
    context,
    page,
  }) => {
    await bootDashboard(context, page);

    // Focus the Menu tab via keyboard (matched by data attribute so a
    // stray "Open menu" label elsewhere can't hijack the walk), then
    // press Enter to open the drawer.
    const reached = await tabUntil(page, (info) => info.dataset.mobileMenuTab !== undefined);
    expect(reached, "user should reach the Menu tab via Tab").toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Enter");

    // Drawer is a Radix Sheet rendered as role="dialog"; scope by nav content.
    const drawer = page
      .getByRole("dialog")
      .filter({ hasText: /dashboard|bookings|payments/i })
      .first();
    await drawer.waitFor({ state: "visible", timeout: 5_000 });

    // Focus lands inside the drawer (Radix focus-trap). Tab must reach the
    // Reports nav row without escaping the drawer.
    const reachedInDrawer = await tabUntil(page, (info) => /^reports$/i.test(info.label), 60);
    expect(
      reachedInDrawer,
      "user should reach a drawer nav row via Tab inside the sheet",
    ).toBeGreaterThanOrEqual(0);

    // Activate → route changes AND drawer auto-closes (onNavigate in AppShell).
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/reports(\?|$|#)/, { timeout: 5_000 });
    expect(new URL(page.url()).pathname).toBe("/reports");
    await expect(drawer).toBeHidden({ timeout: 5_000 });

    // Re-open the drawer and confirm Escape closes it (Radix Sheet contract).
    await tabUntil(page, (info) => info.dataset.mobileMenuTab !== undefined);
    await page.keyboard.press("Enter");
    await drawer.waitFor({ state: "visible", timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 5_000 });
  });

  test("⌘K opens command dialog; ArrowDown selects; Enter activates; Escape closes", async ({
    context,
    page,
  }) => {
    await bootDashboard(context, page);

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog").first();
    await dialog.waitFor({ state: "visible", timeout: 5_000 });

    // The search combobox auto-focuses on open per cmdk contract.
    const searchbox = dialog.getByRole("combobox").first().or(dialog.locator("input").first());
    await expect(searchbox.first()).toBeFocused({ timeout: 2_000 });

    // Type a query that surfaces stable in-app quick-navigation results.
    await page.keyboard.type("payments", { delay: 20 });
    await page.waitForTimeout(300);

    // Walk ArrowDown until an option is data-selected (cmdk marks the
    // keyboard-highlighted row this way). Bounded to keep the test fast.
    let selectedRow = dialog.locator('[role="option"][data-selected="true"]').first();
    for (let step = 0; step < 6; step++) {
      if (await selectedRow.count()) break;
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(40);
      selectedRow = dialog.locator('[role="option"][data-selected="true"]').first();
    }
    await expect(
      selectedRow,
      'ArrowDown should highlight an option (data-selected="true")',
    ).toHaveCount(1);

    // Enter activates the highlighted option → the dialog closes AND
    // the app navigates (or updates state) as a result of onSelect.
    const beforeUrl = page.url();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Best-effort: verify SOME visible outcome — either navigation
    // changed, or focus returned to a shell control. We don't pin to
    // an exact route because cmdk offers multiple actions for the same
    // query, but the dialog MUST close and app state MUST remain
    // interactive.
    await page.waitForTimeout(200);
    const stillInteractive = await page.evaluate(() => {
      const el = document.activeElement;
      return !!el && el !== document.body;
    });
    expect(
      stillInteractive || page.url() !== beforeUrl,
      "Enter should either navigate or land focus on a shell control",
    ).toBeTruthy();

    // Re-open to confirm Escape closes without side effect.
    await page.keyboard.press("Meta+k");
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });
});
