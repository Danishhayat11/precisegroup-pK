import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu roving tabindex invariant.
 *
 * Radix DropdownMenu implements the WAI-ARIA menu pattern with a
 * *roving tabindex*: at any moment, exactly one menu item has
 * `tabindex="0"` and every other item has `tabindex="-1"` (or no
 * tabindex attribute, which resolves to `-1` for `[role="menuitem"]`
 * because it is not a natively focusable element).
 *
 * Why this matters:
 *   - If two items ever report `tabindex="0"` at once, Tab out of
 *     the menu becomes ambiguous and screen-reader focus tracking
 *     desyncs from DOM focus.
 *   - If zero items report `tabindex="0"`, focus cannot re-enter the
 *     menu group after a Tab-out / Tab-back cycle.
 *
 * Distinct from `breadcrumbs-overflow-arrow-navigation.spec.ts`,
 * which bundles the tabindex check into a broader roving-focus
 * contract (highlight + focus + tabindex + wrap semantics). This
 * spec is a focused invariant test: after every ArrowDown / ArrowUp
 * — including a mixed pseudo-random sequence — the tabindex counts
 * are asserted directly (exactly one 0, everyone else out of the
 * tab sequence). Isolating the invariant catches regressions where
 * highlight/focus stay correct but Radix leaks a stale `tabindex="0"`
 * on a previously focused item.
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

type TabindexSnapshot = {
  count: number;
  tabindexes: Array<string | null>;
  zeroIndexes: number[];
  minusOneOrNullCount: number;
  otherValues: Array<{ index: number; value: string }>;
  focusedIndex: number | null;
  focusedTabindex: string | null;
};

async function snapshotTabindexes(page: Page): Promise<TabindexSnapshot> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const tabindexes = items.map((el) => el.getAttribute("tabindex"));
    const zeroIndexes: number[] = [];
    let minusOneOrNullCount = 0;
    const otherValues: Array<{ index: number; value: string }> = [];
    tabindexes.forEach((ti, idx) => {
      if (ti === "0") zeroIndexes.push(idx);
      else if (ti === "-1" || ti === null) minusOneOrNullCount += 1;
      else otherValues.push({ index: idx, value: ti });
    });
    const focusedIndex = items.findIndex((el) => el === document.activeElement);
    return {
      count: items.length,
      tabindexes,
      zeroIndexes,
      minusOneOrNullCount,
      otherValues,
      focusedIndex: focusedIndex === -1 ? null : focusedIndex,
      focusedTabindex: focusedIndex === -1 ? null : tabindexes[focusedIndex],
    };
  });
}

function assertRovingTabindex(snap: TabindexSnapshot, label: string) {
  expect(snap.count, `[${label}] menu has items`).toBeGreaterThan(0);

  // Exactly one tabindex="0".
  expect(
    snap.zeroIndexes.length,
    `[${label}] exactly one item has tabindex="0" (got ${snap.zeroIndexes.length} at indexes [${snap.zeroIndexes.join(",")}])`,
  ).toBe(1);

  // Every other item is out of the tab sequence.
  expect(
    snap.minusOneOrNullCount,
    `[${label}] all non-focused items are tabindex="-1" (or absent)`,
  ).toBe(snap.count - 1);

  // No stray positive/other tabindex values.
  expect(snap.otherValues, `[${label}] no menu item carries a stray tabindex value`).toEqual([]);

  // The tabindex="0" item MUST be the DOM-focused item.
  expect(snap.focusedIndex, `[${label}] a menu item is DOM-focused`).not.toBeNull();
  expect(
    snap.focusedIndex,
    `[${label}] tabindex="0" is on the focused item (roving tabindex tracks focus)`,
  ).toBe(snap.zeroIndexes[0]);
  expect(snap.focusedTabindex, `[${label}] focused item's tabindex is "0"`).toBe("0");
}

/** Wait for the item at `expectedIdx` to become the sole tabindex="0". */
async function waitForRovingIndex(page: Page, expectedIdx: number) {
  await page.waitForFunction(
    (idx) => {
      const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      if (!els.length) return false;
      const zeros = els.filter((el) => el.getAttribute("tabindex") === "0");
      return zeros.length === 1 && els[idx] === zeros[0];
    },
    expectedIdx,
    { timeout: 2000 },
  );
}

test.describe("Breadcrumbs overflow · roving tabindex — exactly one tabindex=0 after each arrow move", () => {
  for (const theme of THEMES) {
    test(`${theme} · ArrowDown / ArrowUp keep exactly one tabindex="0"`, async ({ page }) => {
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

      // ── Initial state ──────────────────────────────────────────
      await waitForRovingIndex(page, 0);
      let snap = await snapshotTabindexes(page);
      const total = snap.count;
      expect(total, `[${theme}] fixture yields more than one hidden crumb`).toBeGreaterThan(1);
      assertRovingTabindex(snap, `${theme} · initial`);
      expect(snap.zeroIndexes[0], `[${theme}] initial tabindex="0" on first item`).toBe(0);

      // ── ArrowDown through every item ──────────────────────────
      for (let step = 1; step < total; step++) {
        await page.keyboard.press("ArrowDown");
        await waitForRovingIndex(page, step);
        snap = await snapshotTabindexes(page);
        assertRovingTabindex(snap, `${theme} · after ArrowDown → ${step}`);
        expect(snap.zeroIndexes[0], `[${theme}] tabindex="0" moved to item ${step}`).toBe(step);
      }

      // ── ArrowDown at end is a no-op; invariant still holds ────
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(120);
      snap = await snapshotTabindexes(page);
      assertRovingTabindex(snap, `${theme} · ArrowDown at end (no-op)`);
      expect(snap.zeroIndexes[0], `[${theme}] tabindex stays on last`).toBe(total - 1);

      // ── ArrowUp back to top ───────────────────────────────────
      for (let step = total - 2; step >= 0; step--) {
        await page.keyboard.press("ArrowUp");
        await waitForRovingIndex(page, step);
        snap = await snapshotTabindexes(page);
        assertRovingTabindex(snap, `${theme} · after ArrowUp → ${step}`);
        expect(snap.zeroIndexes[0], `[${theme}] tabindex="0" moved to item ${step}`).toBe(step);
      }

      // ── ArrowUp at top is a no-op ─────────────────────────────
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(120);
      snap = await snapshotTabindexes(page);
      assertRovingTabindex(snap, `${theme} · ArrowUp at top (no-op)`);
      expect(snap.zeroIndexes[0], `[${theme}] tabindex stays on first`).toBe(0);

      // ── Mixed sequence catches stale-tabindex regressions ─────
      // Deterministic (not random) so failures reproduce identically.
      // Each entry is a relative move; after each, we compute the
      // expected clamped index and assert the invariant.
      const mixedMoves: Array<"ArrowDown" | "ArrowUp"> = [
        "ArrowDown",
        "ArrowDown",
        "ArrowDown",
        "ArrowUp",
        "ArrowDown",
        "ArrowDown",
        "ArrowUp",
        "ArrowUp",
        "ArrowUp",
        "ArrowDown",
      ];
      let expectedIdx = 0;
      for (let i = 0; i < mixedMoves.length; i++) {
        const key = mixedMoves[i];
        expectedIdx =
          key === "ArrowDown" ? Math.min(expectedIdx + 1, total - 1) : Math.max(expectedIdx - 1, 0);
        await page.keyboard.press(key);
        await waitForRovingIndex(page, expectedIdx);
        snap = await snapshotTabindexes(page);
        assertRovingTabindex(snap, `${theme} · mixed[${i}] ${key} → ${expectedIdx}`);
        expect(snap.zeroIndexes[0], `[${theme}] mixed[${i}] ${key} landed at expected index`).toBe(
          expectedIdx,
        );
      }
    });
  }
});
