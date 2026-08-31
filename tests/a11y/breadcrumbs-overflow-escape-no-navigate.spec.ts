import { expect, test } from "../visual/_overflowDebugFixture";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openMenu } from "../visual/_radixDropdownMenu";

/**
 * Breadcrumbs — a11y-focused Escape close contract.
 *
 * Runs against real Chromium (chromium-reduced-motion project) to
 * exercise the SAME keyboard + focus behavior an assistive-tech user
 * relies on:
 *
 *   1. Open the overflow menu with the keyboard.
 *   2. Press Escape.
 *   3. Confirm — with real browser focus, not simulated events — that:
 *        • the menu is fully unmounted (no lingering [role="menu"] /
 *          [role="menuitem"] / [data-highlighted]),
 *        • the URL is byte-identical to before the menu opened (Escape
 *          MUST NOT navigate — a common regression is bubbling Escape
 *          into the highlighted anchor's click handler),
 *        • DOM focus AND the browser's :focus-visible pseudo-class
 *          both resolve to the overflow trigger,
 *        • the Playwright accessibility snapshot names the focused
 *          node as the trigger (aria-expanded=false, name matching
 *          the "hidden breadcrumb" label) — this is what a screen
 *          reader would announce,
 *        • axe-core reports zero WCAG A/AA/best-practice violations
 *          in the region right after Escape closes the menu.
 *
 * This spec is intentionally narrow: it does not re-verify open/arrow/
 * roving-tabindex/highlight state (those live in sibling specs). Its
 * sole purpose is to lock the real-browser Escape → close → restore
 * → no-navigate a11y outcome.
 */

const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

async function forceLight(page: Page) {
  // Pick one theme to keep the a11y assertion crisp; per-theme visual
  // coverage already exists in the visual specs. Using light avoids
  // color-contrast noise from dark-mode overrides.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("precise.theme", "light");
    } catch {
      /* ignored */
    }
    const root = document.documentElement;
    if (root) {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

test.describe("Breadcrumbs overflow · a11y · Escape closes without navigating", () => {
  test("Escape returns real browser focus to the trigger, unmounts menu, and does not navigate", async ({
    page,
  }, testInfo) => {
    // Explicitly guard the project — this spec is a Chromium-only
    // real-browser a11y check. Other projects (webkit) would still
    // pass the behavior but axe rules are tuned against Blink.
    test.skip(
      !testInfo.project.name.startsWith("chromium"),
      "a11y contract is asserted against Chromium/Blink only",
    );

    await forceLight(page);
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(300);

    const nav = page.locator('nav[aria-label="Breadcrumb"]');
    const trigger = nav.locator('button[aria-label*="hidden breadcrumb" i]');
    await expect(trigger, "overflow trigger renders").toBeVisible();

    // ── Baseline: URL + resting a11y state ────────────────────────
    const urlBefore = page.url();
    await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("menu"), "no menu at rest").toHaveCount(0);

    // Focus + open via keyboard. Use Shift beforehand to ensure the
    // browser marks focus as keyboard-originated (drives :focus-visible).
    await trigger.focus();
    await page.keyboard.press("Shift");
    const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
    await expect(menu, "menu open").toBeVisible();
    await expect(trigger, "aria-expanded=true while open").toHaveAttribute("aria-expanded", "true");

    // Move highlight so we know Escape has to tear down real state,
    // not just hide an empty popover.
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator("[data-highlighted]")).toHaveCount(1);

    // ── Escape ────────────────────────────────────────────────────
    await page.keyboard.press("Escape");
    await expect(menu, "menu unmounted after Escape").toBeHidden();

    // 1. No navigation — URL byte-identical.
    expect(page.url(), "Escape must not navigate — URL unchanged from pre-open").toBe(urlBefore);

    // 2. Menu fully torn down.
    await expect(page.getByRole("menu"), 'no [role="menu"] survives').toHaveCount(0);
    await expect(page.locator('[role="menuitem"]'), "no menuitems survive").toHaveCount(0);
    await expect(page.locator("[data-highlighted]"), "no [data-highlighted] survives").toHaveCount(
      0,
    );
    await expect(trigger, "aria-expanded=false after Escape").toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // 3. DOM focus back on the trigger.
    await expect(trigger, "DOM focus restored to trigger").toBeFocused();

    // 4. Real-browser :focus-visible resolves on the trigger — this
    //    is what makes the focus ring appear for keyboard users. A
    //    regression that restores focus without keyboard heuristics
    //    (e.g. programmatic .focus({ preventScroll: true }) without
    //    a keydown source) would fail this check.
    const focusVisible = await trigger.evaluate((el) => el.matches(":focus-visible"));
    expect(focusVisible, "trigger shows :focus-visible after Escape").toBe(true);

    // 5. Accessibility surface: the focused element resolves via the
    //    ARIA role/name path an assistive tech would use, and reports
    //    the collapsed state a screen reader announces. Using
    //    getByRole exercises the accessible-name computation instead
    //    of the raw DOM.
    const a11yTrigger = page.getByRole("button", { name: /hidden breadcrumb/i });
    await expect(a11yTrigger, "accessible-name resolves the focused trigger").toBeFocused();
    await expect(
      a11yTrigger,
      "trigger announced as collapsed (aria-expanded=false)",
    ).toHaveAttribute("aria-expanded", "false");

    // 6. axe-core: zero violations in the breadcrumb region after close.
    //    Scope to the nav to keep the check about this component, not
    //    page-wide unrelated content.
    const axe = await new AxeBuilder({ page })
      .include('nav[aria-label="Breadcrumb"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(
      axe.violations,
      `axe violations after Escape close: ${axe.violations
        .map((v) => `${v.id} (${v.nodes.length})`)
        .join(", ")}`,
    ).toEqual([]);
  });
});
