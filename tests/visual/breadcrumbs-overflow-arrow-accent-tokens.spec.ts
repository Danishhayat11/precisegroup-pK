import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow menu ArrowDown / ArrowUp accent-token contract.
 *
 * This is the *visual* counterpart to `breadcrumbs-overflow-arrow-navigation`.
 * That spec asserts the semantic contract (single `data-highlighted`, roving
 * focus, roving tabindex). This one asserts that the design-system accent
 * tokens actually paint the highlighted row on each keystroke — a regression
 * that swaps `bg-accent` for a hardcoded color, or drops the
 * `data-[highlighted]:` variants during a Tailwind v4 refactor, would still
 * pass the semantic spec but visibly break keyboard nav.
 *
 * On every ArrowDown / ArrowUp we verify:
 *   1. The newly-highlighted item's computed `background-color` and `color`
 *      match the current theme's `--accent` / `--accent-foreground` tokens
 *      (resolved from `:root` / `.dark`).
 *   2. Every other item's computed `background-color` is *not* the accent
 *      token — i.e. the previous row's accent painted off.
 *   3. Exactly one row carries the accent paint per keystroke (no ghosts).
 *
 * Runs in both light and dark themes so a token-only regression in one
 * theme is still caught.
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

async function openMenuByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

type ItemPaint = {
  index: number;
  text: string;
  highlighted: boolean;
  bg: string; // computed rgb(a) background-color
  fg: string; // computed rgb(a) color
};

/**
 * Snapshot the resolved paint of every menu item plus the resolved
 * accent tokens on <html>. We resolve the CSS variables through a
 * throwaway element so we get the *computed* rgb() form — matching
 * what `getComputedStyle` returns on the menu items. String-comparing
 * rgb() to rgb() is what dodges hex-vs-hsl-vs-oklch mismatches.
 */
async function paintSnapshot(page: Page): Promise<{
  items: ItemPaint[];
  accentBg: string;
  accentFg: string;
}> {
  return page.evaluate(() => {
    const resolve = (varName: string): string => {
      const probe = document.createElement("div");
      probe.style.color = `var(${varName})`;
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    };
    const accentBg = resolve("--accent");
    const accentFg = resolve("--accent-foreground");

    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (el, index) => {
        const cs = getComputedStyle(el);
        return {
          index,
          text: (el.textContent ?? "").trim(),
          highlighted: el.hasAttribute("data-highlighted"),
          bg: cs.backgroundColor,
          fg: cs.color,
        } satisfies ItemPaint;
      },
    );

    return { items, accentBg, accentFg };
  });
}

/**
 * Assert exactly one item carries the accent paint, that it's the
 * `data-highlighted` item, and that no other item is accent-tinted.
 * Returns that item's index for the caller's step-ordering assertion.
 */
function assertAccentPaint(
  snap: { items: ItemPaint[]; accentBg: string; accentFg: string },
  label: string,
): number {
  const { items, accentBg, accentFg } = snap;
  expect(accentBg, `[${label}] --accent resolved to a real color`).not.toBe("");
  expect(accentBg, `[${label}] --accent is not transparent (would defeat the highlight)`).not.toBe(
    "rgba(0, 0, 0, 0)",
  );

  const painted = items.filter((i) => i.bg === accentBg);
  expect(
    painted.length,
    `[${label}] exactly one row paints with --accent (found: ${
      painted.map((p) => `"${p.text}"`).join(", ") || "none"
    })`,
  ).toBe(1);

  const highlighted = items.filter((i) => i.highlighted);
  expect(highlighted.length, `[${label}] exactly one row is data-highlighted`).toBe(1);

  expect(
    painted[0].index,
    `[${label}] the data-highlighted row is the one painted with --accent`,
  ).toBe(highlighted[0].index);

  // Foreground token must land too — otherwise text-on-accent contrast breaks.
  expect(painted[0].fg, `[${label}] highlighted row uses --accent-foreground for text`).toBe(
    accentFg,
  );

  // Every other row must have already released the accent paint.
  for (const item of items) {
    if (item.index === painted[0].index) continue;
    expect(
      item.bg,
      `[${label}] unhighlighted row "${item.text}" must not retain --accent bg`,
    ).not.toBe(accentBg);
  }

  return painted[0].index;
}

test.describe("Breadcrumbs — overflow menu accent tokens follow Arrow keys", () => {
  for (const theme of THEMES) {
    test(`${theme} · ArrowDown / ArrowUp repaint highlight with --accent tokens`, async ({
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
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();

      // ── Initial paint — first item auto-highlighted on open via Space
      let snap = await paintSnapshot(page);
      const totalItems = snap.items.length;
      expect(totalItems, "fixture yields multiple hidden crumbs").toBeGreaterThan(1);
      let paintedIdx = assertAccentPaint(snap, "initial");
      expect(paintedIdx, "[initial] first row painted after open").toBe(0);

      // ── ArrowDown walks the accent paint one row at a time ────────
      for (let step = 1; step < totalItems; step++) {
        await page.keyboard.press("ArrowDown");
        // Wait for the DOM signal AND for the accent bg to actually
        // paint on the target row — catches token/class regressions
        // where `data-highlighted` moves but styles don't follow.
        await page.waitForFunction(
          (expectedIdx) => {
            const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            const target = els[expectedIdx];
            if (!target || !target.hasAttribute("data-highlighted")) return false;
            const probe = document.createElement("div");
            probe.style.color = "var(--accent)";
            probe.style.position = "absolute";
            probe.style.visibility = "hidden";
            document.body.appendChild(probe);
            const accent = getComputedStyle(probe).color;
            probe.remove();
            return getComputedStyle(target).backgroundColor === accent;
          },
          step,
          { timeout: 2000 },
        );

        snap = await paintSnapshot(page);
        paintedIdx = assertAccentPaint(snap, `after ArrowDown #${step}`);
        expect(
          paintedIdx,
          `[after ArrowDown #${step}] accent paint advanced by exactly one row`,
        ).toBe(step);
      }

      // ── ArrowDown at the tail is a no-op — paint must stay put ────
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
      snap = await paintSnapshot(page);
      paintedIdx = assertAccentPaint(snap, "ArrowDown at end");
      expect(paintedIdx, "[end] ArrowDown at last row does not move accent paint").toBe(
        totalItems - 1,
      );

      // ── ArrowUp repaints accent one row at a time back to the top ─
      for (let step = totalItems - 2; step >= 0; step--) {
        await page.keyboard.press("ArrowUp");
        await page.waitForFunction(
          (expectedIdx) => {
            const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            const target = els[expectedIdx];
            if (!target || !target.hasAttribute("data-highlighted")) return false;
            const probe = document.createElement("div");
            probe.style.color = "var(--accent)";
            probe.style.position = "absolute";
            probe.style.visibility = "hidden";
            document.body.appendChild(probe);
            const accent = getComputedStyle(probe).color;
            probe.remove();
            return getComputedStyle(target).backgroundColor === accent;
          },
          step,
          { timeout: 2000 },
        );
        snap = await paintSnapshot(page);
        paintedIdx = assertAccentPaint(snap, `after ArrowUp to #${step}`);
        expect(
          paintedIdx,
          `[after ArrowUp to #${step}] accent paint retreated by exactly one row`,
        ).toBe(step);
      }

      // ── ArrowUp at the head is a no-op ───────────────────────────
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(150);
      snap = await paintSnapshot(page);
      paintedIdx = assertAccentPaint(snap, "ArrowUp at top");
      expect(paintedIdx, "[top] ArrowUp at first row does not move accent paint").toBe(0);
    });
  }
});
