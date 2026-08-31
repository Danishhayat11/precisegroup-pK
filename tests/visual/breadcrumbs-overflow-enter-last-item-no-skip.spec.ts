import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs overflow · visual+keyboard · Enter on the LAST highlighted
 * overflow item navigates to that ancestor crumb AND the destination
 * page's aria-current="page" crumb matches the item's label — proving
 * roving focus walked to the last row without skipping any (no
 * accidental wrap, no double-step, no off-by-one on the tail).
 *
 * Fixture: /crumb-fixture/alpha/beta/gamma/delta/epsilon
 *   Collapsed items (URL order):
 *     0 → Alpha  → /crumb-fixture/alpha
 *     1 → Beta   → /crumb-fixture/alpha/beta
 *     2 → Gamma  → /crumb-fixture/alpha/beta/gamma   ← target (LAST)
 *
 * Walk (deliberately not `End`): starting highlight is index 0, we press
 * ArrowDown once per remaining item and assert the highlight advances
 * by exactly 1 each step. If a keydown ever skips (index 0 → 2), the
 * per-step assertion fails BEFORE Enter fires — which is the whole
 * point of "without skipping focus".
 *
 * Runs light + dark to cover the visual highlight token in both themes.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_SEGMENTS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
const FIXTURE_URL = `/crumb-fixture/${FIXTURE_SEGMENTS.join("/")}`;

// Collapsed crumbs are every segment except the first ("Home"/root is
// always visible) and the last two ("Delta", "Epsilon" — visible tail).
// So collapsed = [alpha, beta, gamma] and the LAST is gamma with a
// three-segment href.
const EXPECTED_LAST_SEGMENT = "gamma";
const EXPECTED_LAST_LABEL = "Gamma";
const EXPECTED_LAST_HREF = `/crumb-fixture/${FIXTURE_SEGMENTS.slice(0, 3).join("/")}`;

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

/** Which single item, if any, is currently `[data-highlighted]`. */
async function highlightedIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const hits = items
      .map((el, i) => (el.hasAttribute("data-highlighted") ? i : -1))
      .filter((i) => i >= 0);
    // Return -1 if none or >1 highlighted so the caller can assert on it.
    return hits.length === 1 ? hits[0] : -1;
  });
}

test.describe("Breadcrumbs overflow · Enter on LAST item navigates without skipping focus", () => {
  for (const theme of THEMES) {
    test(`${theme} · step-by-step ArrowDown to last item, Enter → "${EXPECTED_LAST_LABEL}" (${EXPECTED_LAST_HREF})`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, `[${theme}] overflow trigger renders`).toBeVisible();

      // Baseline: we are not on the destination yet.
      expect(new URL(page.url()).pathname, `[${theme}] starting URL differs from target`).not.toBe(
        EXPECTED_LAST_HREF,
      );

      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu open`).toBeVisible();
      await waitForHighlight(page, 0);

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, `[${theme}] fixture yields ≥ 2 hidden crumbs`).toBeGreaterThanOrEqual(2);

      const lastIdx = itemCount - 1;

      // ── Walk one step at a time. Every step must advance by exactly 1. ──
      for (let target = 1; target <= lastIdx; target++) {
        await page.keyboard.press("ArrowDown");
        await waitForHighlight(page, target);
        const actual = await highlightedIndex(page);
        expect(
          actual,
          `[${theme}] step ${target}: exactly one highlighted row, and it is index ${target}`,
        ).toBe(target);
      }

      // ── Confirm the last row's identity before pressing Enter. ──
      const lastItem = await page.evaluate((idx) => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        const el = items[idx];
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
      }, lastIdx);

      expect(lastItem, `[${theme}] last item exists`).not.toBeNull();
      expect(lastItem!.isHighlighted, `[${theme}] last item is [data-highlighted]`).toBe(true);
      expect(lastItem!.isFocused, `[${theme}] last item has DOM focus`).toBe(true);
      expect(
        lastItem!.text.toLowerCase(),
        `[${theme}] last item text is "${EXPECTED_LAST_LABEL}"`,
      ).toBe(EXPECTED_LAST_SEGMENT);
      expect(lastItem!.href, `[${theme}] last item href is ${EXPECTED_LAST_HREF}`).toBe(
        EXPECTED_LAST_HREF,
      );

      // ── Enter → navigate ──
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (expected) => window.location.pathname === expected,
        EXPECTED_LAST_HREF,
        { timeout: 5000 },
      );
      expect(
        new URL(page.url()).pathname,
        `[${theme}] Enter on last item navigated to ${EXPECTED_LAST_HREF}`,
      ).toBe(EXPECTED_LAST_HREF);

      await expect(page.getByRole("menu"), `[${theme}] menu unmounts after Enter`).toHaveCount(0);

      // ── Destination: aria-current="page" + terminal text match "gamma". ──
      await page.waitForFunction(
        (expected) => {
          const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
          if (!nav) return false;
          const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
          return (active?.textContent ?? "").trim().toLowerCase() === expected;
        },
        EXPECTED_LAST_SEGMENT,
        { timeout: 5000 },
      );

      const destination = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        if (!nav) return null;
        const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
        const items = nav.querySelectorAll<HTMLElement>("li");
        const last = items[items.length - 1];
        // Count aria-current="page" — must be exactly one.
        const currentCount = nav.querySelectorAll('[aria-current="page"]').length;
        return {
          currentCount,
          currentText: (active?.textContent ?? "").trim(),
          terminalText: last ? (last.textContent ?? "").trim() : null,
        };
      });

      expect(
        destination?.currentCount,
        `[${theme}] destination has exactly one aria-current="page"`,
      ).toBe(1);
      expect(
        destination?.currentText.toLowerCase(),
        `[${theme}] aria-current="page" reads "${EXPECTED_LAST_LABEL}"`,
      ).toBe(EXPECTED_LAST_SEGMENT);
      expect(
        destination?.terminalText?.toLowerCase(),
        `[${theme}] terminal breadcrumb text is "${EXPECTED_LAST_LABEL}"`,
      ).toContain(EXPECTED_LAST_SEGMENT);
    });
  }
});
