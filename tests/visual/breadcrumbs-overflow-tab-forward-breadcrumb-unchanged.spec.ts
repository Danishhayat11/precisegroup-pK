import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — Tab while the overflow menu is OPEN closes the menu,
 * advances focus forward in document order, and leaves the breadcrumb
 * component byte-identical (no navigation, no crumb reordering, no
 * hidden-count shift, no active-crumb change).
 *
 * The sibling `breadcrumbs-overflow-tab-exit` spec locks the roving-
 * tabindex + "next tabbable" landing contract. This spec adds the
 * complementary destination-unchanged contract that Tab must ALSO
 * uphold:
 *
 *   1. Menu is open, item 0 highlighted + DOM-focused.
 *   2. Press Tab.
 *   3. Menu unmounts, `aria-expanded` flips back to `false`.
 *   4. Focus lands FORWARD of the trigger — the new activeElement
 *      appears AFTER the trigger in DOM order (strict `compare
 *      DocumentPosition`), never on the trigger itself, never on
 *      <body>, never on a menuitem.
 *   5. Page URL is byte-identical to the pre-Tab URL — Tab must not
 *      bubble into the highlighted row's link handler.
 *   6. The rendered breadcrumb trail is structurally identical to
 *      the pre-open snapshot (same labels/hrefs/order, same
 *      aria-current="page" placement, same overflow-trigger label /
 *      hidden-count).
 *   7. Runs light + dark.
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

type CrumbDescriptor = {
  text: string;
  href: string | null;
  ariaCurrent: string | null;
};

type BreadcrumbSnapshot = {
  url: string;
  triggerAriaLabel: string | null;
  crumbs: CrumbDescriptor[];
  activeCrumbText: string | null;
};

async function snapshotBreadcrumbs(page: Page): Promise<BreadcrumbSnapshot> {
  const url = page.url();
  const dom = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Breadcrumb"]');
    if (!nav) return null;
    const trigger = nav.querySelector<HTMLElement>('button[aria-label*="hidden breadcrumb" i]');
    const items = Array.from(nav.querySelectorAll<HTMLElement>("li"));
    const crumbs = items
      .map((li) => {
        const linked = li.querySelector<HTMLElement>("a[href], [aria-current]") ?? li;
        if (linked.tagName === "BUTTON" && linked.getAttribute("aria-haspopup")) {
          return null;
        }
        return {
          text: (linked.textContent ?? "").trim(),
          href: linked.getAttribute("href"),
          ariaCurrent: linked.getAttribute("aria-current"),
        };
      })
      .filter((c): c is CrumbDescriptor => c !== null);
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    return {
      triggerAriaLabel: trigger?.getAttribute("aria-label") ?? null,
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
  expect(after.url, `[${theme}] URL unchanged (Tab did not navigate)`).toBe(before.url);
  expect(after.triggerAriaLabel, `[${theme}] overflow trigger aria-label unchanged`).toBe(
    before.triggerAriaLabel,
  );
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
  expect(after.activeCrumbText, `[${theme}] terminal "current page" crumb unchanged`).toBe(
    before.activeCrumbText,
  );
}

test.describe("Breadcrumbs overflow · Tab-while-open moves focus forward, closes menu, breadcrumb unchanged", () => {
  for (const theme of THEMES) {
    test(`${theme} · Tab from open menu → close + forward focus + breadcrumb identical`, async ({
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

      // Freeze the ORIGINAL trigger DOM node so we can compare
      // compareDocumentPosition of the post-Tab activeElement against it.
      const originalTriggerHandle = await trigger.elementHandle();
      expect(originalTriggerHandle, "trigger handle resolved").not.toBeNull();

      // ── Baseline snapshot BEFORE opening the menu ────────────────
      const before = await snapshotBreadcrumbs(page);
      expect(before.crumbs.length, `[${theme}] baseline has crumbs`).toBeGreaterThan(0);

      // ── Open menu, roving highlight settles on item 0 ────────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu open`).toBeVisible();
      await expect(trigger, `[${theme}] aria-expanded=true while open`).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await waitForHighlight(page, 0);

      // ── Tab: close + advance focus ───────────────────────────────
      await page.keyboard.press("Tab");

      // Menu unmounted.
      await expect(menu, `[${theme}] menu closed by Tab`).toHaveCount(0);
      await expect(page.getByRole("menu"), `[${theme}] no menu remains`).toHaveCount(0);
      await expect(trigger, `[${theme}] aria-expanded=false after Tab`).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(
        page.locator('[role="menuitem"]'),
        `[${theme}] no menuitems remain after Tab`,
      ).toHaveCount(0);
      await expect(
        page.locator("[data-highlighted]"),
        `[${theme}] no lingering data-highlighted`,
      ).toHaveCount(0);

      // ── Focus advanced FORWARD of the trigger ────────────────────
      const focusInfo = await page.evaluate((orig) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) {
          return {
            isBody: true,
            isTrigger: false,
            isMenuItem: false,
            isForward: false,
            tag: "BODY",
          };
        }
        const isTrigger = el === orig;
        const isMenuItem = el.getAttribute("role") === "menuitem";
        // Node.DOCUMENT_POSITION_FOLLOWING = 4 → `el` follows `orig`
        // in DOM order — i.e., focus advanced FORWARD relative to the trigger.
        const isForward = !!(
          orig &&
          (orig as HTMLElement).compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
        );
        return {
          isBody: false,
          isTrigger,
          isMenuItem,
          isForward,
          tag: el.tagName,
        };
      }, originalTriggerHandle);

      expect(focusInfo.isBody, `[${theme}] focus not dropped to <body>`).toBe(false);
      expect(focusInfo.isMenuItem, `[${theme}] focus not on a stale menuitem`).toBe(false);
      expect(focusInfo.isTrigger, `[${theme}] focus advanced OFF the trigger`).toBe(false);
      expect(
        focusInfo.isForward,
        `[${theme}] focus is FORWARD of the trigger in DOM order (compareDocumentPosition)`,
      ).toBe(true);

      // ── Breadcrumb unchanged (no navigation, no re-render) ───────
      const after = await snapshotBreadcrumbs(page);
      assertBreadcrumbUnchanged(before, after, theme);
    });
  }
});
