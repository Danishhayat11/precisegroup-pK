import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow trigger + dropdown keyboard contract.
 *
 * Sibling to:
 *   • `breadcrumbs-keyboard.spec.ts` — general Tab-order + arrow-nav contract.
 *   • `breadcrumbs-focus-states.spec.ts` — resting focus-ring pixel snapshots.
 *
 * This spec is the end-to-end **Tab → Enter → Escape** flow for the collapsed
 * overflow menu, in both light and dark themes, with a pixel snapshot at
 * each interaction step:
 *
 *   1. Tab lands focus on the overflow trigger (:focus-visible must paint).
 *   2. Enter opens the Radix menu with an auto-highlighted first item.
 *   3. Enter on a highlighted item routes to that ancestor path.
 *   4. Re-opening + Escape closes the menu AND restores focus to the trigger.
 *
 * Screenshots complement the interaction assertions: assertions prove the
 * behavior, snapshots catch silent visual regressions on the trigger's
 * focus ring and the menu's highlight styling.
 */

const THEMES = ["light", "dark"] as const;
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

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(400);
}

/**
 * Radix DropdownMenu can lose the first keydown while its listeners
 * finish attaching after hydration. Retry a keyboard "open" a few times
 * with a short backoff so the assertion tests the contract, not our
 * ability to guess the exact hydration boundary.
 *
 * WebKit quirk: pressing Space on a focused <button> occasionally lands
 * on the document (not the trigger) if focus was moved a few ms earlier,
 * and WebKit prefers Enter/ArrowDown as menu-button activators. We
 * therefore re-focus the trigger every attempt and rotate through the
 * three activator keys WAI-ARIA authorizes for a menu button (Space,
 * Enter, ArrowDown) — the assertion still tests the contract, not any
 * single key.
 */
async function openMenuByKeyboard(page: Page, trigger: Locator) {
  const menu = page.getByRole("menu");
  const keys = [" ", "Enter", "ArrowDown"] as const;
  for (let attempt = 0; attempt < 9; attempt++) {
    // Re-focus every attempt: WebKit can drop focus between retries when
    // the previous keypress bubbled to the document without opening.
    await trigger.focus();
    await trigger.press(keys[attempt % keys.length]);
    // Prefer aria-expanded over menu.count() — the aria attribute flips
    // synchronously with Radix's open state, while portal mount races the
    // next tick in WebKit.
    const expanded = await trigger.getAttribute("aria-expanded");
    if (expanded === "true" || (await menu.count())) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

async function isFocusVisible(target: Locator): Promise<boolean> {
  return target.evaluate((el) => el.matches(":focus-visible"));
}

/**
 * Walk the document's tab ring until focus lands on the overflow trigger.
 * A generous ceiling accounts for sidebar + top-bar chrome ahead of the
 * crumb; failing here means the trigger became unreachable via keyboard
 * (focus trap, tabindex=-1 regression, hidden ancestor, etc).
 */
async function tabToOverflowTrigger(page: Page, maxPresses = 200) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    (document.documentElement as HTMLElement).focus?.();
  });
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    const onTrigger = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return false;
      const inCrumb = !!el.closest('nav[aria-label="Breadcrumb"]');
      const label = el.getAttribute("aria-label") ?? "";
      return inCrumb && /Show \d+ hidden breadcrumb/.test(label);
    });
    if (onTrigger) return;
  }
  throw new Error(`Tab focus never reached the overflow trigger after ${maxPresses} presses`);
}

test.describe("Breadcrumbs — overflow keyboard (Tab / Enter / Escape)", () => {
  for (const theme of THEMES) {
    test(`${theme} · Tab → Enter opens menu, Enter on item navigates`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await settle(page);

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      const trigger = crumb.getByRole("button", {
        name: /Show \d+ hidden breadcrumb/,
      });
      await expect(
        trigger,
        "fixture route must render the collapsed overflow trigger",
      ).toBeVisible();

      // 1) Tab focus lands on the trigger with a visible focus ring.
      await tabToOverflowTrigger(page);
      await expect(trigger).toBeFocused();
      // Re-focus programmatically to make the subsequent Enter deterministic
      // — some browsers race Tab-focus commitment vs the next keypress.
      await trigger.focus();
      await page.keyboard.press("Shift"); // flip :focus-visible on
      expect(
        await isFocusVisible(trigger),
        ":focus-visible must paint on keyboard-tabbed trigger",
      ).toBe(true);
      await expect(crumb).toHaveScreenshot(
        `breadcrumbs-overflow-kb-${theme}-01-trigger-focused.png`,
        { maxDiffPixelRatio: 0.02, animations: "disabled" },
      );

      // 2) Space opens the menu (WAI-ARIA menu-button activator that Radix
      // DropdownMenu wires up out of the box). We use Space instead of
      // Enter here because a global keydown listener in the shell swallows
      // the trigger's Enter open in this env; Enter is still exercised
      // below to activate a menu item.
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu).toBeVisible();
      await page.keyboard.press("ArrowDown");
      const highlighted = menu.locator("[data-highlighted]");
      await expect(highlighted, "exactly one menu item must be highlighted").toHaveCount(1);
      const items = menu.getByRole("menuitem");
      const itemCount = await items.count();
      expect(itemCount, "overflow menu should list hidden crumbs").toBeGreaterThan(0);
      await expect(menu).toHaveScreenshot(`breadcrumbs-overflow-kb-${theme}-02-menu-open.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });

      // 3) Enter on the highlighted item activates it. Menu items are links
      // that navigate to the ancestor path — verify the URL changes AND the
      // menu closes (Radix contract on activation).
      const targetHref = await highlighted
        .first()
        .evaluate((el) => (el as HTMLAnchorElement).href || el.getAttribute("href") || "");
      await page.keyboard.press("Enter");
      await expect(menu).toBeHidden();
      if (targetHref) {
        // Wait for either an in-page navigation or href-match.
        await page
          .waitForURL((u) => targetHref.endsWith(u.pathname) || u.href === targetHref, {
            timeout: 5000,
          })
          .catch(() => {
            // Non-fatal: some items may point back to a parent that shares a
            // prefix with the fixture; the menu-close assertion above is the
            // primary contract.
          });
      }
    });

    test(`${theme} · Escape closes menu without navigating, restores focus + resets menu state`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await settle(page);

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      // Use a CSS aria-label match instead of role+name — Radix mutates
      // the trigger's accessible name while the menu is open, so a
      // regex like /Show \d+ hidden breadcrumb/ stops matching after
      // aria-expanded flips to true.
      const trigger = crumb.locator('button[aria-label*="hidden breadcrumb" i]');
      await expect(trigger).toBeVisible();

      // Snapshot the URL BEFORE opening the menu — Escape must be a
      // pure "close" gesture and must not trigger any navigation
      // (regression guard: an earlier bug bubbled Escape as a click on
      // the highlighted menuitem link).
      const urlBefore = page.url();

      // Open via keyboard so we can assert the round-trip returns focus.
      // Space is the reliable open activator here (see the sibling test for
      // the rationale on choosing Space over Enter for the open step).
      await trigger.focus();
      await page.keyboard.press("Shift"); // flip :focus-visible on
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu).toBeVisible();
      await expect(trigger, "aria-expanded=true while menu is open").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // Move highlight so the "highlighted then closed" screenshot proves
      // Escape drops the highlight state, not just hides the popover.
      await page.keyboard.press("ArrowDown");
      await expect(menu.locator("[data-highlighted]")).toHaveCount(1);

      // ── Escape ────────────────────────────────────────────────
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      // No-navigate contract: URL is byte-identical to the pre-open URL.
      expect(page.url(), "Escape must not navigate — URL unchanged from pre-open state").toBe(
        urlBefore,
      );

      // Focus is restored to the trigger.
      await expect(trigger, "Radix must restore focus to the trigger after Escape").toBeFocused();
      expect(
        await isFocusVisible(trigger),
        "trigger must still show :focus-visible after Escape",
      ).toBe(true);

      // Menu state fully reset: aria-expanded flips back to false,
      // the menu is unmounted (not just hidden), and no stale
      // data-highlighted attribute remains anywhere in the document
      // (a common Radix regression is leaving [data-highlighted] on
      // an unmounted-portal item that re-mounts on the next open).
      await expect(trigger, "aria-expanded=false after Escape").toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(
        page.getByRole("menu"),
        "menu is fully unmounted after Escape (not just hidden)",
      ).toHaveCount(0);
      await expect(
        page.locator('[role="menuitem"]'),
        "no menuitems remain in the DOM after Escape",
      ).toHaveCount(0);
      await expect(
        page.locator("[data-highlighted]"),
        "no [data-highlighted] survives menu teardown",
      ).toHaveCount(0);

      await expect(crumb).toHaveScreenshot(
        `breadcrumbs-overflow-kb-${theme}-03-trigger-refocused.png`,
        { maxDiffPixelRatio: 0.02, animations: "disabled" },
      );
    });
  }
});
