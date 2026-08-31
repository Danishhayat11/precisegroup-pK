import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — Enter on the SECOND highlighted overflow item
 * navigates to that specific ancestor crumb.
 *
 * Fixture path: /crumb-fixture/alpha/beta/gamma/delta/epsilon
 *   • Visible trail:  Home … (overflow) … Delta … Epsilon
 *   • Collapsed items (in URL order, top → bottom of the menu):
 *       index 0 → "Alpha"   → /crumb-fixture/alpha
 *       index 1 → "Beta"    → /crumb-fixture/alpha/beta
 *       index 2 → "Gamma"   → /crumb-fixture/alpha/beta/gamma
 *
 * This spec locks the "second item" case explicitly rather than
 * relying on generic "walk one step" logic (which the sibling
 * `enter-navigates` spec covers). It matters because a regression
 * that mis-computes href assembly typically works for the first
 * ancestor (/alpha) and breaks at the SECOND (/alpha/beta) — the
 * first time the assembler has to join more than one segment.
 *
 * Assertions:
 *   1. Open menu, ArrowDown once → item at index 1 (Beta) is the
 *      sole [data-highlighted] and DOM-focused.
 *   2. Its accessible name is "Beta" and its href is
 *      `/crumb-fixture/alpha/beta` (both computed from the fixture,
 *      not hard-coded, so a future path-format change still asserts
 *      the RIGHT destination).
 *   3. Enter navigates to that exact pathname.
 *   4. The menu unmounts.
 *   5. On the destination page, the breadcrumb trail's terminal
 *      crumb (aria-current="page" or the last <li>) reads "Beta"
 *      — proving the app treats the URL as that page.
 *   6. Runs light + dark.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_SEGMENTS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
const FIXTURE_URL = `/crumb-fixture/${FIXTURE_SEGMENTS.join("/")}`;

// Derived expectations for the SECOND collapsed item (index 1). Given the
// fixture above, hidden collapsed crumbs in URL order are [alpha, beta, gamma];
// index 1 is "beta" and its ancestor href stops after two segments.
const EXPECTED_SECOND_SEGMENT = FIXTURE_SEGMENTS[1]; // 'beta'
const EXPECTED_SECOND_LABEL = "Beta";
const EXPECTED_SECOND_HREF = `/crumb-fixture/${FIXTURE_SEGMENTS.slice(0, 2).join("/")}`;

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* ignored */
    }
    const root = document.documentElement;
    if (root) {
      root.classList.toggle("dark", t === "dark");
      root.style.colorScheme = t;
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

async function waitForHighlight(page: Page, expectedIdx: number) {
  await page.waitForFunction(
    (idx) => {
      const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
      return items[idx]?.hasAttribute("data-highlighted") ?? false;
    },
    expectedIdx,
    { timeout: 2000 },
  );
}

test.describe("Breadcrumbs overflow · Enter on the SECOND highlighted item navigates to that crumb", () => {
  for (const theme of THEMES) {
    test(`${theme} · ArrowDown → Enter lands on "${EXPECTED_SECOND_LABEL}" (${EXPECTED_SECOND_HREF})`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu open`).toBeVisible();
      await waitForHighlight(page, 0);

      // Guard: at least 2 items so a "second item" exists.
      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, `[${theme}] fixture yields ≥ 2 hidden crumbs`).toBeGreaterThanOrEqual(2);

      // ── Advance highlight to index 1 (the SECOND item) ───────────
      await page.keyboard.press("ArrowDown");
      await waitForHighlight(page, 1);

      const secondItem = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        const el = items[1];
        if (!el) return null;
        const anchor =
          (el.tagName === "A" ? (el as HTMLAnchorElement) : null) ??
          el.querySelector<HTMLAnchorElement>("a[href]");
        const rawHref = anchor?.getAttribute("href") ?? null;
        return {
          text: (el.textContent ?? "").trim(),
          isHighlighted: el.hasAttribute("data-highlighted"),
          isFocused: el === document.activeElement,
          href: rawHref ? new URL(rawHref, window.location.origin).pathname : null,
        };
      });

      expect(secondItem, `[${theme}] index 1 exists`).not.toBeNull();
      expect(secondItem!.isHighlighted, `[${theme}] index 1 is [data-highlighted]`).toBe(true);
      expect(secondItem!.isFocused, `[${theme}] index 1 has DOM focus`).toBe(true);
      // Case-insensitive because Breadcrumbs may Title-Case URL segments.
      expect(
        secondItem!.text.toLowerCase(),
        `[${theme}] second item text is "${EXPECTED_SECOND_LABEL}"`,
      ).toBe(EXPECTED_SECOND_SEGMENT);
      expect(secondItem!.href, `[${theme}] second item href is ${EXPECTED_SECOND_HREF}`).toBe(
        EXPECTED_SECOND_HREF,
      );

      // Baseline: pressing Enter must actually change the URL.
      expect(page.url(), `[${theme}] fixture URL differs from target`).not.toContain(
        EXPECTED_SECOND_HREF + "?",
      ); // sanity only

      // ── Enter → navigate to the second item's href ───────────────
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (expected) => window.location.pathname === expected,
        EXPECTED_SECOND_HREF,
        { timeout: 5000 },
      );

      expect(
        new URL(page.url()).pathname,
        `[${theme}] Enter on second item navigated to ${EXPECTED_SECOND_HREF}`,
      ).toBe(EXPECTED_SECOND_HREF);

      // ── Menu is torn down after Enter fires the row ──────────────
      await expect(page.getByRole("menu"), `[${theme}] menu unmounts after Enter`).toHaveCount(0);

      // ── Destination page treats us as the "Beta" crumb ───────────
      const terminalCrumb = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        if (!nav) return null;
        const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
        if (active) return (active.textContent ?? "").trim();
        const items = nav.querySelectorAll<HTMLElement>("li");
        const last = items[items.length - 1];
        return last ? (last.textContent ?? "").trim() : null;
      });
      expect(
        terminalCrumb?.toLowerCase(),
        `[${theme}] destination page's terminal crumb is "${EXPECTED_SECOND_LABEL}"`,
      ).toBe(EXPECTED_SECOND_SEGMENT);
    });
  }
});
