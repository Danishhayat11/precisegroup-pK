import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — Escape on a highlighted overflow row returns focus
 * to the ellipsis (overflow) trigger AND leaves the breadcrumb
 * component byte-identical to its pre-open state.
 *
 * The sibling spec
 * `breadcrumbs-overflow-escape-from-highlighted-row-focus` locks the
 * focus-return contract. This spec adds the "breadcrumb unchanged"
 * contract that Escape must ALSO guarantee:
 *
 *   • URL is byte-identical (no navigation fired from the highlighted
 *     row — a regression that bubbled Escape into the row's link
 *     handler would surface here).
 *   • The rendered breadcrumb trail is structurally identical:
 *       - same number of visible crumbs
 *       - same labels in the same order
 *       - same href on each linked crumb
 *       - the aria-current="page" crumb is the same one
 *   • The overflow trigger's own accessible identity is unchanged:
 *       - same aria-label (hidden count didn't shift)
 *       - aria-expanded flipped back to "false"
 *   • Focus lands on the SAME trigger DOM node that opened the menu
 *     (not a re-rendered sibling).
 *
 * Runs light + dark to guard theme-specific portal/hydration paths.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";
const HIGHLIGHT_TARGET_INDEX = 2; // walk deep enough to prove roving state teardown

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

async function waitForHighlightIndex(page: Page, idx: number) {
  await page.waitForFunction(
    (i) => {
      const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
      return items[i]?.hasAttribute("data-highlighted") ?? false;
    },
    idx,
    { timeout: 2000 },
  );
}

type CrumbDescriptor = {
  text: string;
  href: string | null;
  ariaCurrent: string | null;
  tag: string;
};

type BreadcrumbSnapshot = {
  url: string;
  triggerAriaLabel: string | null;
  triggerAriaExpanded: string | null;
  crumbs: CrumbDescriptor[];
  activeCrumbText: string | null;
};

async function snapshotBreadcrumbs(page: Page): Promise<BreadcrumbSnapshot> {
  const url = page.url();
  const dom = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Breadcrumb"]');
    if (!nav) return null;
    const trigger = nav.querySelector<HTMLElement>('button[aria-label*="hidden breadcrumb" i]');
    // Walk each <li> in the crumb list, capturing the linked element's
    // label + href + aria-current. Skip the overflow trigger item — its
    // own aria-expanded flips as the menu opens/closes and is snapshotted
    // separately.
    const items = Array.from(nav.querySelectorAll<HTMLElement>("li"));
    const crumbs = items
      .map((li) => {
        // Prefer the interactive child (a or span with aria-current); if
        // the li itself is only wrapper markup, fall back to its text.
        const linked = li.querySelector<HTMLElement>("a[href], [aria-current]") ?? li;
        // Exclude the overflow trigger from the crumb list — the trigger
        // is a BUTTON with aria-haspopup, and its expanded state changes
        // legitimately across open/close cycles.
        if (linked.tagName === "BUTTON" && linked.getAttribute("aria-haspopup")) {
          return null;
        }
        return {
          text: (linked.textContent ?? "").trim(),
          href: linked.getAttribute("href"),
          ariaCurrent: linked.getAttribute("aria-current"),
          tag: linked.tagName,
        };
      })
      .filter((c): c is CrumbDescriptor => c !== null);
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    return {
      triggerAriaLabel: trigger?.getAttribute("aria-label") ?? null,
      triggerAriaExpanded: trigger?.getAttribute("aria-expanded") ?? null,
      crumbs,
      activeCrumbText: active ? (active.textContent ?? "").trim() : null,
    };
  });
  if (!dom) throw new Error("breadcrumb nav not found");
  return { url, ...dom };
}

function assertBreadcrumbUnchanged(
  before: BreadcrumbSnapshot,
  after: BreadcrumbSnapshot,
  theme: string,
) {
  expect(after.url, `[${theme}] URL unchanged (Escape did not navigate)`).toBe(before.url);
  expect(
    after.triggerAriaLabel,
    `[${theme}] overflow trigger aria-label unchanged (hidden count intact)`,
  ).toBe(before.triggerAriaLabel);
  expect(after.crumbs.length, `[${theme}] same number of visible crumbs`).toBe(
    before.crumbs.length,
  );
  expect(
    after.crumbs.map((c) => c.text),
    `[${theme}] crumb labels unchanged in order`,
  ).toEqual(before.crumbs.map((c) => c.text));
  expect(
    after.crumbs.map((c) => c.href),
    `[${theme}] crumb hrefs unchanged`,
  ).toEqual(before.crumbs.map((c) => c.href));
  expect(
    after.crumbs.map((c) => c.ariaCurrent),
    `[${theme}] aria-current placement unchanged`,
  ).toEqual(before.crumbs.map((c) => c.ariaCurrent));
  expect(after.activeCrumbText, `[${theme}] the "current page" crumb is still the same`).toBe(
    before.activeCrumbText,
  );
}

test.describe("Breadcrumbs overflow · Escape from highlighted row keeps breadcrumb unchanged and refocuses ellipsis", () => {
  for (const theme of THEMES) {
    test(`${theme} · Escape from item ${HIGHLIGHT_TARGET_INDEX} refocuses trigger, breadcrumb identical`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "ellipsis (overflow) trigger renders").toBeVisible();

      // Freeze the ORIGINAL trigger node so we can prove focus returns
      // to the same DOM element, not a re-rendered lookalike.
      const originalTriggerHandle = await trigger.elementHandle();
      expect(originalTriggerHandle, "trigger handle resolved").not.toBeNull();

      // ── Baseline snapshot of the breadcrumb component ────────────
      const before = await snapshotBreadcrumbs(page);
      expect(before.crumbs.length, `[${theme}] baseline has crumbs`).toBeGreaterThan(0);
      expect(before.triggerAriaExpanded, `[${theme}] baseline aria-expanded=false`).toBe("false");

      // ── Open menu, walk highlight to a non-initial row ───────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu open`).toBeVisible();
      await waitForHighlightIndex(page, 0);

      // Clamp target to the actual item count in case the fixture ever shrinks.
      const itemCount = await page.locator('[role="menuitem"]').count();
      const targetIdx = Math.min(HIGHLIGHT_TARGET_INDEX, itemCount - 1);
      for (let step = 1; step <= targetIdx; step++) {
        await page.keyboard.press("ArrowDown");
        await waitForHighlightIndex(page, step);
      }
      // Sanity: the highlighted row is DOM-focused (roving focus).
      const highlightedIsFocused = await page.evaluate((idx) => {
        const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
        return items[idx] && document.activeElement === items[idx];
      }, targetIdx);
      expect(highlightedIsFocused, `[${theme}] roving focus on item ${targetIdx}`).toBe(true);

      // ── Escape ──────────────────────────────────────────────────
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu"), `[${theme}] menu unmounted`).toHaveCount(0);
      await expect(trigger, `[${theme}] aria-expanded resets to false`).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // ── Focus returned to the ORIGINAL ellipsis trigger node ─────
      await expect(trigger, `[${theme}] trigger is focused after Escape`).toBeFocused();
      const focusedIsOriginalNode = await page.evaluate(
        (orig) => document.activeElement === orig,
        originalTriggerHandle,
      );
      expect(
        focusedIsOriginalNode,
        `[${theme}] focus is on the ORIGINAL trigger node (not a re-render)`,
      ).toBe(true);

      // ── Breadcrumb component is byte-identical to baseline ───────
      const after = await snapshotBreadcrumbs(page);
      assertBreadcrumbUnchanged(before, after, theme);

      // No stale highlight or menuitem markup survived teardown.
      await expect(
        page.locator('[role="menuitem"]'),
        `[${theme}] no menuitems remain after Escape`,
      ).toHaveCount(0);
      await expect(
        page.locator("[data-highlighted]"),
        `[${theme}] no lingering data-highlighted`,
      ).toHaveCount(0);
    });
  }
});
