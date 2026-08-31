import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — ArrowUp walks from LAST to FIRST without skipping.
 *
 * Opens the overflow menu, jumps the roving highlight to the LAST
 * menuitem (via End, falling back to a bounded ArrowDown walk when End
 * isn't wired), then presses ArrowUp exactly `count - 1` times and
 * asserts that after each press the highlight sits on the next
 * expected index — no skips, no double-jumps, no stale second cursor.
 *
 * A common Radix / roving-tabindex regression is that ArrowUp
 * silently jumps two rows when the tab-stop and the highlight
 * disagree (or when a stale keydown handler fires twice). That kind
 * of bug leaves the final position at index 0 as expected but skips
 * an intermediate row — this spec catches it by asserting every
 * intermediate index, not just the endpoints.
 *
 * Runs in light + dark: focus rings and roving state have regressed
 * per-theme in this app.
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

async function openByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  await trigger.focus();
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(200);
  }
  return menu;
}

async function highlightedIdx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return els.findIndex((el) => el.hasAttribute("data-highlighted"));
  });
}

async function highlightedCount(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll('[role="menuitem"][data-highlighted]').length,
  );
}

/** Jump the highlight to the last menuitem — End first, then ArrowDown fallback. */
async function jumpToLast(page: Page, itemCount: number) {
  const lastIdx = itemCount - 1;
  await page.keyboard.press("End");
  try {
    await page.waitForFunction(
      (idx) => {
        const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
        return els[idx]?.hasAttribute("data-highlighted") ?? false;
      },
      lastIdx,
      { timeout: 800 },
    );
    return;
  } catch {
    // End isn't wired — walk down until we hit the last row.
  }
  for (let i = 0; i < itemCount + 2; i++) {
    if ((await highlightedIdx(page)) === lastIdx) return;
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(30);
  }
  throw new Error("Could not move highlight to the last menuitem");
}

test.describe("Breadcrumbs overflow · ArrowUp last→first walks every intermediate row", () => {
  for (const theme of THEMES) {
    test(`${theme} · ArrowUp from LAST reaches FIRST via every intermediate index in order`, async ({
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

      const menu = await openByKeyboard(page, trigger);
      await expect(menu, `[${theme}] menu open`).toBeVisible();

      // Wait for the initial highlight before poking any keys.
      await page.waitForFunction(
        () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
        undefined,
        { timeout: 2000 },
      );

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(
        itemCount,
        `[${theme}] fixture yields at least 3 hidden crumbs so intermediate rows exist`,
      ).toBeGreaterThanOrEqual(3);

      // ── Jump to the last row ─────────────────────────────────────────────
      await jumpToLast(page, itemCount);
      const startIdx = await highlightedIdx(page);
      expect(startIdx, `[${theme}] highlight parked on last menuitem`).toBe(itemCount - 1);
      expect(
        await highlightedCount(page),
        `[${theme}] exactly one highlight before ArrowUp walk`,
      ).toBe(1);

      // ── Walk ArrowUp one step at a time, assert each intermediate idx ───
      const visited: number[] = [startIdx];
      for (let expected = itemCount - 2; expected >= 0; expected--) {
        await page.keyboard.press("ArrowUp");
        await page.waitForFunction(
          (idx) => {
            const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            return els[idx]?.hasAttribute("data-highlighted") ?? false;
          },
          expected,
          { timeout: 2000 },
        );

        const idx = await highlightedIdx(page);
        const count = await highlightedCount(page);
        visited.push(idx);
        expect(
          count,
          `[${theme}] exactly one row highlighted at step ${itemCount - 1 - expected} (got ${count})`,
        ).toBe(1);
        expect(
          idx,
          `[${theme}] ArrowUp step lands on idx ${expected} — visited so far: ${visited.join(",")}`,
        ).toBe(expected);
      }

      // Final sanity: the walk visited every index from last down to 0 in order.
      const expectedSequence = Array.from({ length: itemCount }, (_, i) => itemCount - 1 - i);
      expect(
        visited,
        `[${theme}] ArrowUp walk visited every intermediate index without skips`,
      ).toEqual(expectedSequence);
    });
  }
});
