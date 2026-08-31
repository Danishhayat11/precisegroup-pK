import { expect, test } from "../visual/_overflowDebugFixture";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openMenu } from "../visual/_radixDropdownMenu";

/**
 * Breadcrumbs overflow · a11y · axe stays clean across open / closed states.
 *
 * Complements `breadcrumbs-overflow-escape-no-navigate.spec.ts` (which
 * scans axe only *after* Escape closes) by locking a stricter contract:
 * the overflow surface — trigger + menu portal — must produce ZERO
 * WCAG A/AA/best-practice violations in every state the user can put
 * it into.
 *
 * Three scan points:
 *   1. RESTING (menu closed at first paint) — catches trigger-level
 *      regressions: missing aria-label on the icon button, wrong
 *      aria-expanded default, aria-haspopup drift.
 *   2. OPEN (menu mounted, first item highlighted) — catches portal
 *      regressions the closed-state scan can't see: menu role/name,
 *      menuitem accessible names, aria-hidden on ancestors of the
 *      focused item, focus ring on the menuitem, dialog-vs-menu
 *      confusion, duplicate ids, nested-interactive.
 *   3. RE-CLOSED (Escape) — catches leftovers from the portal
 *      teardown: orphan aria-owns pointing at unmounted ids, stale
 *      aria-controls, focus-guard elements left tabbable.
 *
 * Scope: the scan `include`s the breadcrumb nav AND (when open) the
 * live `[role="menu"]` portal container. It does NOT scan the whole
 * page — unrelated marketing content shouldn't fail this spec.
 *
 * Chromium/Blink only — axe rules are tuned against Blink and the
 * sibling `escape-no-navigate` spec already established this project
 * boundary.
 */

const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] as const;

async function forceLight(page: Page) {
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

/**
 * Run axe scoped to the given include selectors. Returns a
 * human-readable failure message when violations exist so failures
 * print with rule id + node targets, not just a `.length` count.
 */
async function scanOverflowRegion(page: Page, includeSelectors: string[], stateLabel: string) {
  let builder = new AxeBuilder({ page });
  for (const sel of includeSelectors) {
    builder = builder.include(sel);
  }
  const results = await builder.withTags([...AXE_TAGS]).analyze();
  if (results.violations.length === 0) {
    expect(results.violations, `[${stateLabel}] clean`).toEqual([]);
    return;
  }
  const detail = results.violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            `      · ${n.target.join(" ")}${
              n.failureSummary ? `\n        ${n.failureSummary.replace(/\n/g, "\n        ")}` : ""
            }`,
        )
        .join("\n");
      return `  · [${v.impact ?? "n/a"}] ${v.id} — ${v.help}\n    ${v.helpUrl}\n${nodes}`;
    })
    .join("\n");
  throw new Error(`[${stateLabel}] ${results.violations.length} axe violation(s):\n${detail}`);
}

test.describe("Breadcrumbs overflow · a11y · axe clean in every menu state", () => {
  test("axe reports zero violations when overflow is closed, open, and re-closed", async ({
    page,
  }, testInfo) => {
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
    await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("menu"), "no menu at rest").toHaveCount(0);

    // ── 1. RESTING (menu closed) ────────────────────────────────────
    await scanOverflowRegion(page, ['nav[aria-label="Breadcrumb"]'], "resting · menu closed");

    // ── 2. OPEN (menu mounted, first item auto-highlighted) ─────────
    await trigger.focus();
    const menu = await openMenu(page, trigger, {
      activation: "Space",
      label: "overflow menu",
    });
    await expect(menu, "menu open").toBeVisible();
    await expect(trigger, "aria-expanded=true while open").toHaveAttribute("aria-expanded", "true");
    // Wait for Radix's auto-highlight so the menu is in the shape
    // assistive tech would inspect, not mid-transition.
    await page.waitForFunction(
      () => {
        const first = document.querySelector<HTMLElement>('[role="menuitem"]');
        return !!first && first.hasAttribute("data-highlighted");
      },
      undefined,
      { timeout: 2000 },
    );
    // Sanity: menu has real menuitems.
    expect(
      await page.locator('[role="menuitem"]').count(),
      "menu has menuitems for axe to evaluate",
    ).toBeGreaterThan(1);

    await scanOverflowRegion(
      page,
      ['nav[aria-label="Breadcrumb"]', '[role="menu"]'],
      "open · first item highlighted",
    );

    // ── 3. RE-CLOSED via Escape ─────────────────────────────────────
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu"), "menu torn down after Escape").toHaveCount(0);
    await expect(page.locator('[role="menuitem"]'), "no menuitems survive").toHaveCount(0);
    await expect(trigger, "aria-expanded=false after Escape").toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(trigger, "focus returned to trigger").toBeFocused();

    await scanOverflowRegion(page, ['nav[aria-label="Breadcrumb"]'], "re-closed · after Escape");
  });
});
