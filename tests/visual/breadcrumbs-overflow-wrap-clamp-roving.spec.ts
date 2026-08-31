import { test, expect } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu end-of-list wrapping contract.
 *
 * The Radix `DropdownMenu` used here does NOT wrap: ArrowDown at the
 * last item and ArrowUp at the first item both clamp — highlight,
 * DOM focus, and the roving `tabindex="0"` stay on the boundary row.
 * The sister spec `breadcrumbs-overflow-arrowup-from-first.spec.ts`
 * proves the top-boundary case; this spec extends it to the bottom
 * boundary and — critically — asserts the roving-tabindex invariant
 * (exactly one `tabindex="0"` menuitem, all others `-1` or absent)
 * survives repeated boundary presses.
 *
 * Verified in both themes:
 *
 *   Bottom boundary (ArrowDown at last item)
 *     1. Walk to the last item with End (single Radix key, avoids
 *        depending on `count - 1` ArrowDowns).
 *     2. Snapshot: highlight + focus at last index, roving tabindex
 *        holds.
 *     3. Press ArrowDown three times. Highlight / focus / tabindex
 *        MUST remain on the last item every time — no wrap to index
 *        0, no lost focus.
 *
 *   Top boundary (ArrowUp at first item)
 *     4. Home returns to index 0.
 *     5. Press ArrowUp three times. Highlight / focus / tabindex
 *        MUST remain on index 0.
 *
 *   Cross-boundary sanity
 *     6. After clamping at index 0, one ArrowDown MUST advance to
 *        index 1 (proves the clamp isn't stickier than intended and
 *        arrow keys still work after the boundary presses).
 *
 * The roving-tabindex invariant is checked after every step, since
 * a regression that ever leaves TWO `tabindex="0"` menuitems (or
 * zero) breaks Tab-exit ordering in ways that only surface on
 * downstream keyboard flows.
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

function overflowTrigger(page: Page) {
  return page.locator('nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]');
}

type ItemState = {
  index: number;
  text: string;
  tabindex: string | null;
  highlighted: boolean;
  focused: boolean;
};

async function snapshotItems(page: Page): Promise<ItemState[]> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return items.map((el, index) => ({
      index,
      text: (el.textContent ?? "").trim(),
      tabindex: el.getAttribute("tabindex"),
      highlighted: el.hasAttribute("data-highlighted"),
      focused: document.activeElement === el,
    }));
  });
}

/**
 * Assert the roving invariants — used after every boundary press so
 * a regression that duplicates or drops tabindex="0" surfaces at the
 * exact step that caused it.
 */
function assertRovingAt(items: ItemState[], expectedIndex: number, label: string) {
  expect(items.length, `[${label}] menu has items`).toBeGreaterThan(0);

  const highlighted = items.filter((i) => i.highlighted);
  expect(highlighted.length, `[${label}] exactly one item is highlighted`).toBe(1);
  expect(highlighted[0].index, `[${label}] highlight is at expected index`).toBe(expectedIndex);

  const focused = items.filter((i) => i.focused);
  expect(focused.length, `[${label}] exactly one item is DOM-focused`).toBe(1);
  expect(focused[0].index, `[${label}] DOM focus tracks the highlight`).toBe(expectedIndex);

  const tabbable = items.filter((i) => i.tabindex === "0");
  expect(
    tabbable.length,
    `[${label}] exactly one menuitem carries tabindex="0" (roving invariant)`,
  ).toBe(1);
  expect(tabbable[0].index, `[${label}] the tabindex="0" menuitem is the highlighted one`).toBe(
    expectedIndex,
  );

  for (const item of items) {
    if (item.index === expectedIndex) continue;
    expect(
      item.tabindex === "-1" || item.tabindex === null,
      `[${label}] non-highlighted item "${item.text}" is out of tab sequence (got tabindex=${item.tabindex})`,
    ).toBe(true);
  }
}

async function waitForHighlightIndex(page: Page, index: number, timeout = 2000) {
  await page.waitForFunction(
    (i) => {
      const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const highlighted = items.filter((el) => el.hasAttribute("data-highlighted"));
      return highlighted.length === 1 && items[i] === highlighted[0];
    },
    index,
    { timeout },
  );
}

test.describe("Breadcrumbs — overflow menu end-of-list clamp + roving-tabindex invariant", () => {
  for (const theme of THEMES) {
    test(`${theme} · ArrowDown at last / ArrowUp at first clamp; exactly one tabindex="0" menuitem throughout`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = overflowTrigger(page);
      await expect(trigger, "overflow trigger renders").toBeVisible();

      await trigger.focus();
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme})`,
      });
      await expect(menu, "menu visible after open").toBeVisible();

      await waitForHighlightIndex(page, 0);
      const initial = await snapshotItems(page);
      const total = initial.length;
      expect(
        total,
        "fixture yields at least 3 hidden crumbs (so first/last are distinct and reachable)",
      ).toBeGreaterThanOrEqual(3);
      assertRovingAt(initial, 0, `${theme} · open baseline`);

      const firstText = initial[0].text;
      const lastText = initial[total - 1].text;
      expect(lastText, "first and last items are distinct rows").not.toBe(firstText);

      // ── Bottom boundary ────────────────────────────────────────
      // Jump to the last item using End so this spec doesn't couple
      // to the ArrowDown walk (that's covered by other specs).
      await page.keyboard.press("End");
      await waitForHighlightIndex(page, total - 1);
      let snap = await snapshotItems(page);
      assertRovingAt(snap, total - 1, `${theme} · after End (at last item)`);
      expect(snap[total - 1].text, "End lands on the last row").toBe(lastText);

      // ArrowDown ×3 at the last item MUST clamp — no wrap to index 0.
      for (let i = 1; i <= 3; i++) {
        await page.keyboard.press("ArrowDown");
        // Give Radix a tick; the state should be unchanged, so we
        // can't wait on a "moved" signal. A short settle is enough
        // because a wrap regression would flip the DOM synchronously.
        await page.waitForTimeout(80);
        snap = await snapshotItems(page);
        assertRovingAt(snap, total - 1, `${theme} · ArrowDown #${i} at last clamps (no wrap)`);
        expect(
          snap[0].highlighted,
          `[${theme} · ArrowDown #${i} at last] first item is NOT highlighted (no wrap to top)`,
        ).toBe(false);
        expect(
          snap[total - 1].text,
          `[${theme} · ArrowDown #${i} at last] highlight text stays on the last row`,
        ).toBe(lastText);
      }

      // ── Top boundary ───────────────────────────────────────────
      await page.keyboard.press("Home");
      await waitForHighlightIndex(page, 0);
      snap = await snapshotItems(page);
      assertRovingAt(snap, 0, `${theme} · after Home (back at first item)`);
      expect(snap[0].text, "Home lands on the first row").toBe(firstText);

      // ArrowUp ×3 at the first item MUST clamp — no wrap to last.
      for (let i = 1; i <= 3; i++) {
        await page.keyboard.press("ArrowUp");
        await page.waitForTimeout(80);
        snap = await snapshotItems(page);
        assertRovingAt(snap, 0, `${theme} · ArrowUp #${i} at first clamps (no wrap)`);
        expect(
          snap[total - 1].highlighted,
          `[${theme} · ArrowUp #${i} at first] last item is NOT highlighted (no wrap to bottom)`,
        ).toBe(false);
        expect(
          snap[0].text,
          `[${theme} · ArrowUp #${i} at first] highlight text stays on the first row`,
        ).toBe(firstText);
      }

      // ── Cross-boundary sanity ──────────────────────────────────
      // After the clamp presses, arrow keys must still work. If a
      // regression stuck the roving cursor at a boundary, this
      // ArrowDown would fail to advance.
      await page.keyboard.press("ArrowDown");
      await waitForHighlightIndex(page, 1);
      snap = await snapshotItems(page);
      assertRovingAt(snap, 1, `${theme} · ArrowDown after top-clamp advances to index 1`);
    });
  }
});
