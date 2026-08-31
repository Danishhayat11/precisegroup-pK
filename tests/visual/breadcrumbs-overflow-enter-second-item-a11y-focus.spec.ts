import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs overflow · a11y · Enter on the SECOND highlighted item
 * navigates to the expected destination AND leaves focus on the
 * destination breadcrumb page (aria-current="page").
 *
 * Fixture: /crumb-fixture/alpha/beta/gamma/delta/epsilon
 *   Collapsed items (URL order):
 *     0 → Alpha  → /crumb-fixture/alpha
 *     1 → Beta   → /crumb-fixture/alpha/beta   ← target
 *     2 → Gamma  → /crumb-fixture/alpha/beta/gamma
 *
 * Why this spec (vs. the sibling `enter-on-second-item` spec):
 *   The sibling asserts URL + terminal-crumb text after activation.
 *   This one adds the a11y contract: after a keyboard-driven Enter
 *   on menu item index 1, focus must LAND on the destination
 *   breadcrumb page element (the new aria-current="page" crumb),
 *   not fall back to <body>. That's what a screen-reader user needs
 *   to hear the new location announced without hunting for it.
 *
 * Chromium only — matches the sibling a11y specs.
 */

test.describe.configure({ mode: "serial" });

const FIXTURE_SEGMENTS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
const FIXTURE_URL = `/crumb-fixture/${FIXTURE_SEGMENTS.join("/")}`;

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

test.describe("Breadcrumbs overflow · a11y · Enter on second item navigates and focuses destination crumb", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only a11y spec");

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} · Enter on index 1 → focus lands on destination "${EXPECTED_SECOND_LABEL}" crumb`, async ({
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

      // Baseline: we are not already on the destination.
      expect(
        new URL(page.url()).pathname,
        `[${theme}] fixture starts on the deep path, not the target`,
      ).not.toBe(EXPECTED_SECOND_HREF);

      // Open via keyboard (Space) so the whole activation stays on the
      // keyboard track — matches the a11y user journey we're locking.
      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu opens`).toBeVisible();
      await waitForHighlight(page, 0);

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, `[${theme}] fixture yields ≥ 2 hidden crumbs`).toBeGreaterThanOrEqual(2);

      // Advance to the SECOND item.
      await page.keyboard.press("ArrowDown");
      await waitForHighlight(page, 1);

      // Sanity: index 1 is Beta and points to the expected href.
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
      expect(
        secondItem!.text.toLowerCase(),
        `[${theme}] second item text is "${EXPECTED_SECOND_LABEL}"`,
      ).toBe(EXPECTED_SECOND_SEGMENT);
      expect(secondItem!.href, `[${theme}] second item href is ${EXPECTED_SECOND_HREF}`).toBe(
        EXPECTED_SECOND_HREF,
      );

      // Activate via keyboard.
      await page.keyboard.press("Enter");

      // URL navigated to the expected destination.
      await page.waitForFunction(
        (expected) => window.location.pathname === expected,
        EXPECTED_SECOND_HREF,
        { timeout: 5000 },
      );
      expect(
        new URL(page.url()).pathname,
        `[${theme}] Enter on second item navigated to ${EXPECTED_SECOND_HREF}`,
      ).toBe(EXPECTED_SECOND_HREF);

      // Menu is torn down.
      await expect(page.getByRole("menu"), `[${theme}] menu unmounts after Enter`).toHaveCount(0);

      // Wait for the destination breadcrumb trail to render its terminal crumb.
      await page.waitForFunction(
        (expected) => {
          const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
          if (!nav) return false;
          const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
          const text = (active?.textContent ?? "").trim().toLowerCase();
          return text === expected;
        },
        EXPECTED_SECOND_SEGMENT,
        { timeout: 5000 },
      );

      // ── The a11y assertion: focus landed on the destination crumb ──
      //
      // We accept any of:
      //   • activeElement IS the aria-current="page" node
      //   • activeElement is CONTAINED by the aria-current="page" node
      //     (e.g. the crumb wraps a <span> or icon)
      //   • activeElement CONTAINS the aria-current="page" node
      //     (e.g. focus is on the wrapping <a>/<button> whose child is
      //      the current-page marker)
      // Anything else — <body>, the (now unmounted) trigger, or a
      // sibling crumb — is a regression.
      const focusReport = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        const active = nav?.querySelector<HTMLElement>('[aria-current="page"]') ?? null;
        const ae = document.activeElement as HTMLElement | null;
        const describe = (el: Element | null) =>
          el
            ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}` +
              `${el.getAttribute("aria-current") ? `[aria-current="${el.getAttribute("aria-current")}"]` : ""}` +
              ` "${(el.textContent ?? "").trim().slice(0, 40)}"`
            : "null";
        return {
          activeIsBody: ae === document.body,
          activeMatchesCurrent:
            !!active && !!ae && (ae === active || active.contains(ae) || ae.contains(active)),
          activeText: (ae?.textContent ?? "").trim().toLowerCase(),
          activeDescribe: describe(ae),
          currentDescribe: describe(active),
        };
      });

      expect(
        focusReport.activeIsBody,
        `[${theme}] focus did not fall back to <body> after navigation ` +
          `(active=${focusReport.activeDescribe}, current=${focusReport.currentDescribe})`,
      ).toBe(false);

      expect(
        focusReport.activeMatchesCurrent,
        `[${theme}] focus lands on the destination crumb ` +
          `(active=${focusReport.activeDescribe}, current=${focusReport.currentDescribe})`,
      ).toBe(true);

      // Belt-and-braces: whatever holds focus reads as the destination crumb.
      expect(
        focusReport.activeText,
        `[${theme}] focused element text matches destination crumb`,
      ).toContain(EXPECTED_SECOND_SEGMENT);
    });
  }
});
