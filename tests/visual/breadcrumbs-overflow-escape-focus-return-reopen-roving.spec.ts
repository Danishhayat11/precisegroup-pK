import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — Escape returns focus to trigger, reopen roves correctly.
 *
 * One narrative, three linked assertions:
 *
 *   1. Escape while the menu is open closes it and returns focus to the
 *      overflow trigger — never `<body>`, never a portal wrapper, never
 *      a stale menuitem — and flips `aria-expanded` to `"false"`.
 *   2. Reopening lands the highlight on menuitem 0 with a well-formed
 *      roving state: exactly one `data-highlighted`, exactly one
 *      `tabindex="0"`, and both are on the same row.
 *   3. ArrowDown from the reset advances one row (idx 1) and a
 *      following ArrowUp returns to idx 0 — proving the roving cursor
 *      moves by one in BOTH directions from the fresh starting point.
 *
 * Distinct from:
 *   • `breadcrumbs-overflow-escape-close-regression.spec.ts` — asserts
 *     focus-return + reset but not bidirectional Arrow behavior.
 *   • `breadcrumbs-overflow-escape-reopen-highlight-reset.spec.ts` —
 *     asserts reset + one-way ArrowDown but doesn't check focus lands
 *     back on the trigger before reopening.
 *
 * Runs in light + dark: focus rings and Radix portal focus scope have
 * regressed independently per theme.
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

async function waitForHighlightAt(page: Page, idx: number) {
  await page.waitForFunction(
    (i) => {
      const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
      return els[i]?.hasAttribute("data-highlighted") ?? false;
    },
    idx,
    { timeout: 2000 },
  );
}

async function readRovingState(page: Page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return items.map((el, idx) => ({
      idx,
      highlighted: el.hasAttribute("data-highlighted"),
      tabindex: el.getAttribute("tabindex"),
    }));
  });
}

test.describe("Breadcrumbs overflow · Escape returns focus to trigger, reopen roves correctly", () => {
  for (const theme of THEMES) {
    test(`${theme} · Escape → focus on trigger, reopen highlights idx 0 with bidirectional Arrow walk`, async ({
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

      // ── Open and walk highlight OFF item 0 so reset is meaningful ──────
      const menu = await openByKeyboard(page, trigger);
      await expect(menu, `[${theme}] menu open`).toBeVisible();
      await waitForHighlightAt(page, 0);

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(
        itemCount,
        `[${theme}] fixture yields at least 3 hidden crumbs`,
      ).toBeGreaterThanOrEqual(3);

      const walkTarget = Math.min(2, itemCount - 1);
      for (let i = 0; i < walkTarget; i++) {
        await page.keyboard.press("ArrowDown");
      }
      await waitForHighlightAt(page, walkTarget);

      // ── Escape closes the menu ──────────────────────────────────────────
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu"), `[${theme}] menu unmounted after Escape`).toHaveCount(0);
      await expect(trigger, `[${theme}] aria-expanded=false after Escape`).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // Focus is back on the overflow trigger.
      const afterEscape = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) {
          return { isBody: true, tag: "BODY", role: null, label: null };
        }
        return {
          isBody: false,
          tag: el.tagName,
          role: el.getAttribute("role"),
          label: el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 60),
        };
      });
      expect(afterEscape.isBody, `[${theme}] post-Escape focus not <body>`).toBe(false);
      expect(afterEscape.role, `[${theme}] post-Escape focus not stuck on stale menuitem`).not.toBe(
        "menuitem",
      );
      expect(afterEscape.tag, `[${theme}] post-Escape focus on a <button>`).toBe("BUTTON");
      expect(afterEscape.label, `[${theme}] post-Escape focus on the overflow trigger`).toMatch(
        /hidden breadcrumb/i,
      );

      // ── Reopen and verify the roving state resets cleanly ───────────────
      const reopened = await openByKeyboard(page, trigger);
      await expect(reopened, `[${theme}] menu reopens after Escape`).toBeVisible();
      await waitForHighlightAt(page, 0);

      const reopenCount = await page.locator('[role="menuitem"]').count();
      expect(reopenCount, `[${theme}] reopened menu has the same items as before`).toBe(itemCount);

      const resetState = await readRovingState(page);
      const highlighted = resetState.filter((s) => s.highlighted);
      const tabStops = resetState.filter((s) => s.tabindex === "0");
      const nonStops = resetState.filter((s) => s.tabindex === "-1");

      expect(
        highlighted.length,
        `[${theme}] exactly one highlighted menuitem on reopen (got ${highlighted.length})`,
      ).toBe(1);
      expect(
        highlighted[0].idx,
        `[${theme}] reopen highlights idx 0 (walked to idx=${walkTarget} before Escape)`,
      ).toBe(0);
      expect(
        tabStops.length,
        `[${theme}] exactly one menuitem carries tabindex="0" (got ${tabStops.length})`,
      ).toBe(1);
      expect(nonStops.length, `[${theme}] every other menuitem carries tabindex="-1"`).toBe(
        resetState.length - 1,
      );
      expect(
        tabStops[0].idx,
        `[${theme}] tab-stop and highlight are on the SAME menuitem (idx 0)`,
      ).toBe(0);

      // ── Bidirectional Arrow walk from the reset row ────────────────────
      // ArrowDown → idx 1
      await page.keyboard.press("ArrowDown");
      await waitForHighlightAt(page, 1);
      const afterDown = await readRovingState(page);
      const downHi = afterDown.filter((s) => s.highlighted);
      expect(
        downHi.length,
        `[${theme}] still exactly one highlight after ArrowDown (no stale second cursor)`,
      ).toBe(1);
      expect(downHi[0].idx, `[${theme}] ArrowDown from reset lands on idx 1 (no skip)`).toBe(1);

      // ArrowUp → back to idx 0
      await page.keyboard.press("ArrowUp");
      await waitForHighlightAt(page, 0);
      const afterUp = await readRovingState(page);
      const upHi = afterUp.filter((s) => s.highlighted);
      expect(
        upHi.length,
        `[${theme}] still exactly one highlight after ArrowUp (no stale second cursor)`,
      ).toBe(1);
      expect(upHi[0].idx, `[${theme}] ArrowUp from idx 1 returns to idx 0 (no wrap, no skip)`).toBe(
        0,
      );
    });
  }
});
