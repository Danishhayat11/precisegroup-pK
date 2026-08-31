import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — after Escape closes the overflow menu, sequential Tab
 * presses walk the *breadcrumb controls* (overflow trigger → each
 * following crumb link) in DOM order without skipping any of them.
 *
 * Distinct from `breadcrumbs-overflow-tab-after-escape.spec.ts`, which
 * only asserts the very first Tab lands on the next tabbable anywhere
 * on the page. This spec is scoped to the breadcrumb `<nav>` itself and
 * asserts the *full* forward order (and its Shift+Tab reverse) so a
 * regression that silently drops one crumb from the tab sequence is
 * caught.
 *
 * Runs in light + dark because portal wrappers and focus rings differ
 * per theme and have historically leaked tabindex state across themes.
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
    if (root) {
      root.classList.toggle("dark", t === "dark");
      root.style.colorScheme = t;
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

/**
 * Return the ordered list of tabbable breadcrumb controls (overflow
 * trigger + each visible crumb link) as `{ tag, label, href }` — the
 * same shape `readActive` produces, so we can compare element-by-element.
 */
async function readBreadcrumbControls(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Breadcrumb"]');
    if (!nav) return [];
    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const cs = window.getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    };
    const isTabbable = (el: HTMLElement) => {
      if ((el as HTMLButtonElement).disabled) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      if (el.closest("[inert]")) return false;
      if (el.tabIndex < 0) return false;
      return isVisible(el);
    };
    // Only controls INSIDE the breadcrumb nav; excludes the hidden
    // ancestors list that is portal-rendered / inert when closed.
    const nodes = Array.from(nav.querySelectorAll<HTMLElement>("a[href], button")).filter(
      isTabbable,
    );
    return nodes.map((el) => ({
      tag: el.tagName,
      label:
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.textContent ?? "").trim().slice(0, 60),
      href: el.getAttribute("href"),
    }));
  });
}

async function readActive(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { tag: "BODY", label: null, href: null, isBody: true };
    }
    return {
      tag: el.tagName,
      label:
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.textContent ?? "").trim().slice(0, 60),
      href: el.getAttribute("href"),
      isBody: false,
    };
  });
}

function sameControl(
  a: { tag: string; label: string | null; href: string | null },
  b: { tag: string; label: string | null; href: string | null },
) {
  if (a.tag !== b.tag) return false;
  if (b.href) return a.href === b.href;
  return a.label === b.label;
}

test.describe("Breadcrumbs overflow · Escape → Tab walks breadcrumb controls in order", () => {
  for (const theme of THEMES) {
    test(`${theme} · Tab after Escape visits each following crumb control in DOM order`, async ({
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

      // ── Snapshot the expected control order BEFORE opening the menu ──
      const controls = await readBreadcrumbControls(page);
      const triggerIdx = controls.findIndex((c) => /hidden breadcrumb/i.test(c.label ?? ""));
      expect(triggerIdx, `[${theme}] trigger present in control list`).toBeGreaterThanOrEqual(0);
      const following = controls.slice(triggerIdx + 1);
      expect(
        following.length,
        `[${theme}] at least one crumb control follows the trigger`,
      ).toBeGreaterThan(0);

      // ── Open menu, walk into a row, dismiss with Escape ─────────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu open`).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu"), `[${theme}] menu unmounted`).toHaveCount(0);
      await expect(trigger, `[${theme}] aria-expanded=false`).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      const afterEscape = await readActive(page);
      expect(afterEscape.isBody, `[${theme}] post-Escape focus not <body>`).toBe(false);
      expect(afterEscape.label, `[${theme}] post-Escape focus on trigger`).toMatch(
        /hidden breadcrumb/i,
      );

      // ── Forward Tab walk: each press must land on the next crumb control ──
      for (let i = 0; i < following.length; i++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(30);
        const active = await readActive(page);
        expect(
          active.isBody,
          `[${theme}] Tab #${i + 1} after Escape did not fall through to <body>`,
        ).toBe(false);
        expect(
          sameControl(active, following[i]),
          `[${theme}] Tab #${i + 1} landed on "${active.label}" (href=${active.href}), expected "${following[i].label}" (href=${following[i].href})`,
        ).toBe(true);
      }

      // ── Reverse Shift+Tab walk: back to the trigger, in reverse order ──
      for (let i = following.length - 2; i >= 0; i--) {
        await page.keyboard.press("Shift+Tab");
        await page.waitForTimeout(30);
        const active = await readActive(page);
        expect(
          sameControl(active, following[i]),
          `[${theme}] Shift+Tab back to index ${i} landed on "${active.label}", expected "${following[i].label}"`,
        ).toBe(true);
      }
      await page.keyboard.press("Shift+Tab");
      await page.waitForTimeout(30);
      const backAtTrigger = await readActive(page);
      expect(
        backAtTrigger.label,
        `[${theme}] Shift+Tab returns focus to the overflow trigger`,
      ).toMatch(/hidden breadcrumb/i);
    });
  }
});
