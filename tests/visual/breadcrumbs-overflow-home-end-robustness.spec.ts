import { test, expect } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu Home / End robustness contract.
 *
 * Complements `breadcrumbs-overflow-home-end.spec.ts` (which proves the
 * single-press Home/End contract) by hammering the surface with
 * interleaved presses to catch drift the single-press spec can't see:
 *
 *   • Repeated End presses at the last item MUST be idempotent —
 *     no wrap, no advance, no lost focus.
 *   • Repeated Home presses at the first item MUST be idempotent.
 *   • End → Home → End → Home cycles MUST return the roving cursor
 *     to the exact boundary each time, with a single `data-highlighted`
 *     row and a single `tabindex="0"` menuitem after every press.
 *   • Home / End called from an arbitrary mid-position (reached via
 *     ArrowDown) MUST snap to the true first / last row — not to the
 *     "first / last item currently in the viewport" (visible ≠ mounted
 *     for a scrollable menu, but Radix's roving model targets all
 *     mounted rows; this spec assumes fixture keeps all items mounted
 *     and asserts the target row's bounding rect intersects the menu's
 *     scroll container so "focus jumps to the first/last visible item"
 *     is a real end-to-end guarantee, not just a DOM-index one).
 *
 * After every press we re-check:
 *   1. Exactly one `data-highlighted` menuitem.
 *   2. Exactly one `tabindex="0"` menuitem, and it is the highlighted one.
 *   3. `document.activeElement` is that same menuitem.
 *   4. The highlighted menuitem is inside the menu's visible scroll
 *      area (its rect intersects the menu's client rect).
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
  intersectsMenu: boolean;
};

async function snapshotItems(page: Page): Promise<ItemState[]> {
  return page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    const menuRect = menu?.getBoundingClientRect();
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const intersects = (a: DOMRect, b?: DOMRect) => {
      if (!b) return false;
      return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    };
    return items.map((el, index) => ({
      index,
      text: (el.textContent ?? "").trim(),
      tabindex: el.getAttribute("tabindex"),
      highlighted: el.hasAttribute("data-highlighted"),
      focused: document.activeElement === el,
      intersectsMenu: intersects(el.getBoundingClientRect(), menuRect),
    }));
  });
}

function assertRovingAt(items: ItemState[], expectedIndex: number, label: string) {
  expect(items.length, `[${label}] menu has items`).toBeGreaterThan(0);

  const highlighted = items.filter((i) => i.highlighted);
  expect(highlighted.length, `[${label}] exactly one highlighted item`).toBe(1);
  expect(highlighted[0].index, `[${label}] highlight at expected index`).toBe(expectedIndex);

  const focused = items.filter((i) => i.focused);
  expect(focused.length, `[${label}] exactly one DOM-focused item`).toBe(1);
  expect(focused[0].index, `[${label}] DOM focus tracks highlight`).toBe(expectedIndex);

  const tabbable = items.filter((i) => i.tabindex === "0");
  expect(
    tabbable.length,
    `[${label}] exactly one menuitem carries tabindex="0" (roving invariant)`,
  ).toBe(1);
  expect(tabbable[0].index, `[${label}] tabindex="0" is on the highlighted item`).toBe(
    expectedIndex,
  );

  for (const item of items) {
    if (item.index === expectedIndex) continue;
    expect(
      item.tabindex === "-1" || item.tabindex === null,
      `[${label}] non-focused item "${item.text}" is out of tab sequence (got tabindex=${item.tabindex})`,
    ).toBe(true);
  }

  // "visible" contract: the target row's box overlaps the menu's box.
  expect(
    items[expectedIndex].intersectsMenu,
    `[${label}] highlighted item is inside the visible menu area`,
  ).toBe(true);
}

async function waitForHighlightIndex(page: Page, index: number) {
  await page.waitForFunction(
    (i) => {
      const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const hi = items.filter((el) => el.hasAttribute("data-highlighted"));
      return hi.length === 1 && items[i] === hi[0];
    },
    index,
    { timeout: 2000 },
  );
}

test.describe("Breadcrumbs — overflow Home / End robustness (repeated + interleaved + mid-jumps)", () => {
  for (const theme of THEMES) {
    test(`${theme} · repeated + interleaved Home/End preserve roving-tabindex on every press`, async ({
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

      await page.waitForFunction(
        () => {
          const first = document.querySelector<HTMLElement>('[role="menuitem"]');
          return !!first && first.hasAttribute("data-highlighted");
        },
        undefined,
        { timeout: 2000 },
      );

      const initial = await snapshotItems(page);
      const total = initial.length;
      expect(
        total,
        "fixture yields at least 3 hidden crumbs so first/last/mid are distinct",
      ).toBeGreaterThanOrEqual(3);
      assertRovingAt(initial, 0, `${theme} · baseline`);

      const firstText = initial[0].text;
      const lastText = initial[total - 1].text;
      const midIndex = Math.floor(total / 2);
      expect(midIndex, "mid index is between the two boundaries").toBeGreaterThan(0);
      expect(midIndex, "mid index is not the last").toBeLessThan(total - 1);

      // ── Single-press End → snap to last ─────────────────────────
      await page.keyboard.press("End");
      await waitForHighlightIndex(page, total - 1);
      let snap = await snapshotItems(page);
      assertRovingAt(snap, total - 1, `${theme} · after End (from index 0)`);
      expect(snap[total - 1].text, "End lands on the last row").toBe(lastText);

      // ── Repeated End at last is idempotent ──────────────────────
      for (let i = 1; i <= 3; i++) {
        await page.keyboard.press("End");
        await page.waitForTimeout(60);
        snap = await snapshotItems(page);
        assertRovingAt(snap, total - 1, `${theme} · End #${i + 1} (idempotent at last)`);
        expect(
          snap[0].highlighted,
          `[${theme} · End #${i + 1}] first row is NOT re-highlighted`,
        ).toBe(false);
      }

      // ── Single-press Home → snap to first ───────────────────────
      await page.keyboard.press("Home");
      await waitForHighlightIndex(page, 0);
      snap = await snapshotItems(page);
      assertRovingAt(snap, 0, `${theme} · after Home (from last)`);
      expect(snap[0].text, "Home lands on the first row").toBe(firstText);

      // ── Repeated Home at first is idempotent ────────────────────
      for (let i = 1; i <= 3; i++) {
        await page.keyboard.press("Home");
        await page.waitForTimeout(60);
        snap = await snapshotItems(page);
        assertRovingAt(snap, 0, `${theme} · Home #${i + 1} (idempotent at first)`);
        expect(
          snap[total - 1].highlighted,
          `[${theme} · Home #${i + 1}] last row is NOT re-highlighted`,
        ).toBe(false);
      }

      // ── Interleaved End ↔ Home cycles ───────────────────────────
      for (let cycle = 1; cycle <= 3; cycle++) {
        await page.keyboard.press("End");
        await waitForHighlightIndex(page, total - 1);
        snap = await snapshotItems(page);
        assertRovingAt(snap, total - 1, `${theme} · cycle ${cycle} End`);
        expect(snap[total - 1].text, `[cycle ${cycle}] End text still matches last`).toBe(lastText);

        await page.keyboard.press("Home");
        await waitForHighlightIndex(page, 0);
        snap = await snapshotItems(page);
        assertRovingAt(snap, 0, `${theme} · cycle ${cycle} Home`);
        expect(snap[0].text, `[cycle ${cycle}] Home text still matches first`).toBe(firstText);
      }

      // ── Walk to mid, then End / Home snap correctly ─────────────
      for (let i = 0; i < midIndex; i++) {
        await page.keyboard.press("ArrowDown");
      }
      await waitForHighlightIndex(page, midIndex);
      snap = await snapshotItems(page);
      assertRovingAt(snap, midIndex, `${theme} · walked to mid via ArrowDown`);

      await page.keyboard.press("End");
      await waitForHighlightIndex(page, total - 1);
      snap = await snapshotItems(page);
      assertRovingAt(snap, total - 1, `${theme} · End from mid`);
      expect(snap[total - 1].text, "End from mid lands on the last row").toBe(lastText);

      await page.keyboard.press("Home");
      await waitForHighlightIndex(page, 0);
      snap = await snapshotItems(page);
      assertRovingAt(snap, 0, `${theme} · Home from last (after mid-walk)`);
      expect(snap[0].text, "Home from last lands on the first row").toBe(firstText);
    });
  }
});
