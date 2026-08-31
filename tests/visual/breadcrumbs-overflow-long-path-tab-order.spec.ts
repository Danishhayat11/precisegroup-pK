import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";
import { openMenu, closeMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — parameterized tab-order & overflow-item-order tests
 * for several long pathnames. Locks the collapse logic:
 *
 *   • MAX_VISIBLE = 4
 *   • When crumbs.length > MAX_VISIBLE:
 *        visible  = [first, secondLast, last]
 *        collapsed = crumbs.slice(1, -2)   ← the middle
 *
 * For each fixture URL we verify:
 *   1. Trigger accessible name = `Show K hidden breadcrumb(s)` with
 *      correct K and singular/plural agreement.
 *   2. Overflow menu items EQUAL the collapsed middle segments, in
 *      the same order as the URL (== document order).
 *   3. `aria-posinset` on each menuitem increases 1..K and matches
 *      that same URL order.
 *   4. Tab from the top of the breadcrumb container visits, in this
 *      exact order: first crumb link → overflow trigger → each of
 *      the remaining visible ancestor links. The current page crumb
 *      is a <span>, not a link, so it is NOT in the tab sequence.
 *   5. Repeated Tab never lands on a menuitem while the menu is
 *      closed (no stale roving tabindex leaks).
 *
 * Runs in a single Chromium project — this covers Playwright logic,
 * not theming. Escape / focus-return contracts live in their own
 * dedicated specs.
 */

// Path segments AFTER `/crumb-fixture/`. Each becomes a crumb (title-cased
// by the app). We deliberately pick lengths that exercise different
// truncation shapes and singular/plural label boundaries.
const CASES = [
  // 5 segments → 6 crumbs (Home + 5) → 3 hidden.
  { name: "5-segment · balanced", segments: ["alpha", "beta", "gamma", "delta", "epsilon"] },
  // 4 segments → 5 crumbs → 2 hidden (plural).
  { name: "4-segment · minimum-collapsed", segments: ["one", "two", "three", "four"] },
  // 6 segments → 7 crumbs → 4 hidden.
  { name: "6-segment · deep", segments: ["a1", "b2", "c3", "d4", "e5", "f6"] },
  // 8 segments → 9 crumbs → 6 hidden.
  { name: "8-segment · very-deep", segments: ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"] },
] as const;

// Radix's DropdownMenuItem `asChild` makes the anchor carry role="menuitem".
async function readMenuItems(menu: Locator) {
  return menu.evaluate((m) => {
    const items = Array.from(m.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return items.map((el) => ({
      text: (el.textContent ?? "").trim(),
      posinset: el.getAttribute("aria-posinset"),
      setsize: el.getAttribute("aria-setsize"),
      href: el.getAttribute("href"),
    }));
  });
}

async function readVisibleCrumbLinks(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
    if (!nav) return [];
    // Only <a> elements — the current-page span is not tabbable.
    const anchors = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a[href]"));
    // Exclude anchors inside the portalled menu (which lives outside the
    // nav) — but Radix portals under body, so this filter is a safety net.
    return anchors
      .filter((a) => !a.closest('[role="menu"]'))
      .map((a) => ({ text: (a.textContent ?? "").trim(), href: a.getAttribute("href") }));
  });
}

async function pressTabAndRead(page: Page) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(30);
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: "BODY", role: null, label: null, href: null };
    return {
      tag: el.tagName,
      role: el.getAttribute("role"),
      label:
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.textContent ?? "").trim().slice(0, 60),
      href: el.getAttribute("href"),
    };
  });
}

test.describe("Breadcrumbs overflow · parameterized tab-order & item-order across long pathnames", () => {
  for (const c of CASES) {
    test(`${c.name} · trigger label, menu items, and Tab order match collapse rules`, async ({
      page,
    }) => {
      const url = `/crumb-fixture/${c.segments.join("/")}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      // ── Read the whole trail as rendered ──────────────────────
      // Anchors in the breadcrumb nav (Radix DropdownMenu portals its
      // menu OUTSIDE the nav, so anchors inside nav are only crumb links):
      //   [0] Home / Dashboard
      //   [1] crumbs[0]                (first URL segment — collapse anchor)
      //   [2] crumbs[len-2]            (second-last URL segment)
      // The current-page crumb is a <span>, not an anchor, so it is not
      // in this list and is not in the tab sequence.
      const visibleLinks = await readVisibleCrumbLinks(page);
      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, `[${c.name}] overflow trigger visible`).toBeVisible();

      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${c.name}] menu open`).toBeVisible();
      const items = await readMenuItems(menu);
      await closeMenu(page);

      expect(
        visibleLinks.length,
        `[${c.name}] nav renders 3 anchor crumbs (Home + collapse-anchor + second-last)`,
      ).toBe(3);
      const [homeLink, collapseAnchor, secondLast] = visibleLinks;

      // ── 1. Trigger accessible name ────────────────────────────
      const K = items.length;
      const label = (await trigger.getAttribute("aria-label")) ?? "";
      expect(label, `[${c.name}] trigger label announces the hidden count`).toBe(
        `Show ${K} hidden breadcrumb${K === 1 ? "" : "s"}`,
      );
      // Collapse math: K == total_segments - 3 (crumbs[0] + crumbs[len-2] + current).
      expect(K, `[${c.name}] K == segments.length - 3`).toBe(c.segments.length - 3 + 1);
      //   (segments in URL after /crumb-fixture/ plus the leading "crumb-fixture"
      //    segment gives total parts = c.segments.length + 1.)

      // ── 2. Anchor identity: Home + collapse anchor + second-last ──
      expect(homeLink.href, `[${c.name}] Home link goes to /dashboard`).toBe("/dashboard");
      expect(
        collapseAnchor.href,
        `[${c.name}] collapse anchor is crumbs[0] = "/crumb-fixture"`,
      ).toBe("/crumb-fixture");
      // Second-last anchor href ends with the second-to-last URL segment.
      const secondToLastSeg = c.segments[c.segments.length - 2];
      expect(
        secondLast.href?.endsWith(`/${secondToLastSeg}`),
        `[${c.name}] second-last anchor href ends with "/${secondToLastSeg}" (got "${secondLast.href}")`,
      ).toBe(true);

      // ── 3. Menu items match the collapsed middle (URL order) ──
      // Collapsed middle = crumbs.slice(1, -2) of full crumbs list.
      // Full crumbs = ["crumb-fixture", ...c.segments]. Slice(1,-2) then
      // drops "crumb-fixture", the second-to-last segment, and the current.
      const fullCrumbSegments = ["crumb-fixture", ...c.segments];
      const middleSegments = fullCrumbSegments.slice(1, -2);
      expect(items.length, `[${c.name}] menu item count matches middle segment count`).toBe(
        middleSegments.length,
      );

      // Segment→label comparison is case-insensitive: the app title-cases
      // segments ("alpha" → "Alpha") but the exact casing rule isn't the
      // subject under test — the ORDER is.
      for (let i = 0; i < middleSegments.length; i++) {
        expect(
          items[i].text.toLowerCase(),
          `[${c.name}] menu item ${i} label matches segment "${middleSegments[i]}"`,
        ).toBe(middleSegments[i].toLowerCase());
        expect(
          items[i].href,
          `[${c.name}] menu item ${i} href is the ancestor chain up to "${middleSegments[i]}"`,
        ).toBe("/" + fullCrumbSegments.slice(0, i + 2).join("/"));
      }

      // ── 4. aria-posinset / aria-setsize ───────────────────────
      for (let i = 0; i < K; i++) {
        expect(Number(items[i].posinset), `[${c.name}] posinset[${i}] = ${i + 1}`).toBe(i + 1);
        expect(Number(items[i].setsize), `[${c.name}] setsize[${i}] = ${K}`).toBe(K);
      }
      // hrefs strictly grow in length (ancestor chain).
      for (let i = 1; i < K; i++) {
        expect(
          (items[i].href ?? "").length,
          `[${c.name}] href[${i}] extends href[${i - 1}] (ancestor order)`,
        ).toBeGreaterThan((items[i - 1].href ?? "").length);
      }

      // ── 5. Tab order across the breadcrumb container ──────────
      // Reset focus and walk the tab sequence until we've observed the
      // subsequence: Home → collapseAnchor → trigger → secondLast.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.evaluate(() => document.body.focus());

      const targets = [
        { kind: "home", match: (a: any) => a.href === "/dashboard" },
        { kind: "collapseAnchor", match: (a: any) => a.href === "/crumb-fixture" },
        { kind: "trigger", match: (a: any) => /hidden breadcrumb/i.test(a.label ?? "") },
        { kind: "secondLast", match: (a: any) => a.href === secondLast.href },
      ];
      let cursor = 0;
      for (let step = 0; step < 50 && cursor < targets.length; step++) {
        const active = await pressTabAndRead(page);
        // While the menu is closed, no menuitem may appear in the Tab sequence.
        expect(
          active.role,
          `[${c.name}] no menuitem in Tab sequence while menu closed (step ${step}, label="${active.label}")`,
        ).not.toBe("menuitem");

        if (targets[cursor].match(active)) {
          cursor++;
        }
      }
      expect(
        cursor,
        `[${c.name}] Tab visited all targets in order: ${targets.map((t) => t.kind).join(" → ")}`,
      ).toBe(targets.length);
    });
  }
});
