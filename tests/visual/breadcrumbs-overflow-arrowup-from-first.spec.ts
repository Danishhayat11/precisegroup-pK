import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — ArrowUp keyboard contract starting from the first
 * highlighted overflow item.
 *
 * Verified contract (matches Radix DropdownMenu / WAI-ARIA menu):
 *
 *   1. On open, item 0 is highlighted AND DOM-focused (roving focus).
 *   2. ArrowUp from index 0 is a NO-OP — Radix does not wrap to the
 *      last item (menu pattern intentionally clamps at ends).
 *      The highlight, focus, and roving `tabindex="0"` stay on 0.
 *   3. After walking to the bottom via ArrowDown, ArrowUp steps back
 *      by EXACTLY one index each press — no skipped items, no double
 *      jumps, and no repeats. This is the "moves correctly without
 *      skipping" invariant the ArrowUp path must uphold.
 *   4. `aria-activedescendant` on the menu container stays absent at
 *      every step. Radix uses roving DOM focus, not
 *      aria-activedescendant. Emitting both would give assistive tech
 *      contradictory focus signals.
 *   5. `aria-selected` on menuitems stays absent at every step. The
 *      `menuitem` role does NOT support aria-selected — only
 *      `menuitemradio` / `menuitemcheckbox` do. Presence of
 *      aria-selected on plain menuitems is an ARIA authoring bug
 *      that trips axe and misleads screen readers.
 *
 * Runs in light + dark since keyboard focus rings and portal wrappers
 * differ per theme in this app.
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

type MenuSnapshot = {
  count: number;
  highlightedIndexes: number[];
  focusedIndex: number;
  tabindexes: Array<string | null>;
  ariaSelected: Array<string | null>;
  ariaActivedescendant: string | null;
};

async function snapshotMenu(page: Page): Promise<MenuSnapshot> {
  return page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return {
      count: items.length,
      highlightedIndexes: items.reduce<number[]>((acc, el, i) => {
        if (el.hasAttribute("data-highlighted")) acc.push(i);
        return acc;
      }, []),
      focusedIndex: items.findIndex((el) => el === document.activeElement),
      tabindexes: items.map((el) => el.getAttribute("tabindex")),
      ariaSelected: items.map((el) => el.getAttribute("aria-selected")),
      ariaActivedescendant: menu?.getAttribute("aria-activedescendant") ?? null,
    };
  });
}

function assertInvariants(snap: MenuSnapshot, expectedIdx: number, label: string) {
  expect(snap.count, `[${label}] menu has items`).toBeGreaterThan(0);

  // Exactly one highlight, on the expected index.
  expect(
    snap.highlightedIndexes,
    `[${label}] exactly one [data-highlighted], at index ${expectedIdx}`,
  ).toEqual([expectedIdx]);

  // DOM focus tracks the highlight.
  expect(snap.focusedIndex, `[${label}] roving DOM focus on item ${expectedIdx}`).toBe(expectedIdx);

  // Roving tabindex: exactly one "0", on the focused item; all others -1 or absent.
  snap.tabindexes.forEach((ti, i) => {
    if (i === expectedIdx) {
      expect(ti, `[${label}] focused item tabindex="0"`).toBe("0");
    } else {
      expect(
        ti === "-1" || ti === null,
        `[${label}] item ${i} out of tab sequence (got tabindex=${ti})`,
      ).toBe(true);
    }
  });

  // aria-activedescendant must NOT be emitted alongside roving focus.
  expect(
    snap.ariaActivedescendant,
    `[${label}] menu does not emit aria-activedescendant (roving focus model)`,
  ).toBeNull();

  // aria-selected is invalid on plain menuitem — must be absent on every item.
  snap.ariaSelected.forEach((val, i) => {
    expect(val, `[${label}] item ${i} has no aria-selected (invalid on role=menuitem)`).toBeNull();
  });
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

test.describe("Breadcrumbs overflow · ArrowUp from first item — highlight moves correctly, no skips", () => {
  for (const theme of THEMES) {
    test(`${theme} · ArrowUp at index 0 is a no-op; ArrowUp from the end walks back with no skips`, async ({
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

      // ── Initial: item 0 highlighted, invariants hold ─────────────
      let snap = await snapshotMenu(page);
      const total = snap.count;
      expect(total, `[${theme}] fixture yields more than one hidden crumb`).toBeGreaterThan(1);
      assertInvariants(snap, 0, `${theme} · initial`);

      // ── ArrowUp from the first highlighted item: no-op ───────────
      // Radix does not wrap. Highlight, focus, tabindex, and all
      // ARIA state must remain byte-identical to the initial snapshot.
      for (let attempt = 1; attempt <= 3; attempt++) {
        await page.keyboard.press("ArrowUp");
        await page.waitForTimeout(80);
        snap = await snapshotMenu(page);
        assertInvariants(snap, 0, `${theme} · ArrowUp at top #${attempt}`);
      }

      // ── Walk down to the last item via ArrowDown ────────────────
      for (let step = 1; step < total; step++) {
        await page.keyboard.press("ArrowDown");
        await waitForHighlight(page, step);
      }
      snap = await snapshotMenu(page);
      assertInvariants(snap, total - 1, `${theme} · reached last via ArrowDown`);

      // ── ArrowUp back to top: exactly one step per press, no skips ──
      const visited: number[] = [total - 1];
      for (let step = total - 2; step >= 0; step--) {
        await page.keyboard.press("ArrowUp");
        await waitForHighlight(page, step);
        snap = await snapshotMenu(page);
        assertInvariants(snap, step, `${theme} · ArrowUp → ${step}`);

        // Explicit "no skip" contract: the highlighted index is
        // exactly the previous visited index minus one.
        const prev = visited[visited.length - 1];
        expect(step, `[${theme}] ArrowUp advanced by exactly one (prev=${prev}, now=${step})`).toBe(
          prev - 1,
        );
        expect(
          visited.includes(step),
          `[${theme}] ArrowUp did not revisit an already-highlighted item`,
        ).toBe(false);
        visited.push(step);
      }

      // Full descending sequence [total-1, total-2, ..., 1, 0].
      const expectedSequence = Array.from({ length: total }, (_, i) => total - 1 - i);
      expect(
        visited,
        `[${theme}] ArrowUp visited every index in descending order with no skips or repeats`,
      ).toEqual(expectedSequence);

      // ── One more ArrowUp at top is still a no-op ────────────────
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(80);
      snap = await snapshotMenu(page);
      assertInvariants(snap, 0, `${theme} · ArrowUp at top (post-walk)`);
    });
  }
});
