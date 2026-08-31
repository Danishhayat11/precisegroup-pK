import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — Arrow navigation + Enter activation.
 *
 * Opens the overflow via keyboard, walks the roving highlight with
 * ArrowDown / ArrowUp (down two, up one — net index 1 from the fresh
 * start, so both directions are exercised and neither cancels), reads
 * the destination the highlighted row would navigate to, presses Enter,
 * then locks the post-activation contract:
 *
 *   1. The menu closes — no orphan `role="menu"` remains.
 *   2. Trigger `aria-expanded` is `"false"` if it still exists (its
 *      absence after re-collapse is an even stronger closed signal).
 *   3. Focus is restored to a real, visible element — never `<body>`,
 *      never a leaked menuitem — and lands inside the breadcrumb nav
 *      on the destination crumb (matched by `aria-current="page"` or
 *      text equality with the activated row).
 *
 * Complements `breadcrumbs-overflow-enter-close-focus-regression.spec.ts`
 * (which walks with ArrowDown only) by proving that a mixed
 * up/down walk lands the highlight in the same place a plain
 * ArrowDown would — i.e. ArrowUp is not a no-op, and the walked-to row
 * (not the original first) is the one that Enter fires.
 *
 * Runs in light + dark: focus rings and Radix portal tear-down differ
 * per theme and have regressed independently.
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

async function readHighlightedTarget(
  page: Page,
): Promise<{ text: string; href: string; idx: number }> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const idx = items.findIndex((el) => el.hasAttribute("data-highlighted"));
    if (idx === -1) throw new Error("no highlighted menuitem");
    const el = items[idx];
    const anchor =
      (el.tagName === "A" ? (el as HTMLAnchorElement) : null) ??
      el.querySelector<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) throw new Error("highlighted menuitem exposes no href");
    return {
      idx,
      text: (el.textContent ?? "").trim(),
      href: new URL(href, window.location.origin).pathname,
    };
  });
}

test.describe("Breadcrumbs overflow · Arrow navigation + Enter closes menu and restores focus", () => {
  for (const theme of THEMES) {
    test(`${theme} · ArrowDown×2 + ArrowUp lands on idx 1, Enter closes and focuses that crumb`, async ({
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

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(
        itemCount,
        `[${theme}] fixture yields at least 3 hidden crumbs so up/down walk is meaningful`,
      ).toBeGreaterThanOrEqual(3);

      // Wait for initial highlight then walk: down, down, up → net index 1.
      await waitForHighlightAt(page, 0);
      await page.keyboard.press("ArrowDown");
      await waitForHighlightAt(page, 1);
      await page.keyboard.press("ArrowDown");
      await waitForHighlightAt(page, 2);
      await page.keyboard.press("ArrowUp");
      await waitForHighlightAt(page, 1);

      // Ensure ArrowUp actually moved the highlight — a regression that
      // ignored ArrowUp would leave us at idx 2 and this snapshot would
      // point at the wrong crumb, breaking the focus assertion below.
      const highlightedCount = await page.evaluate(
        () => document.querySelectorAll('[role="menuitem"][data-highlighted]').length,
      );
      expect(
        highlightedCount,
        `[${theme}] exactly one row highlighted after mixed Arrow walk`,
      ).toBe(1);

      const target = await readHighlightedTarget(page);
      expect(target.idx, `[${theme}] mixed Arrow walk resolved to idx 1`).toBe(1);
      expect(target.text.length, `[${theme}] target row has visible text`).toBeGreaterThan(0);
      expect(
        target.href,
        `[${theme}] target is not the current URL (Enter would be a no-op)`,
      ).not.toBe(new URL(FIXTURE_URL, "http://x").pathname);

      // ── Enter to activate ──────────────────────────────────────────────
      await page.keyboard.press("Enter");

      await page.waitForFunction((expected) => window.location.pathname === expected, target.href, {
        timeout: 5000,
      });

      // (1) Menu is torn down.
      await expect(page.getByRole("menu"), `[${theme}] menu closed after Enter`).toHaveCount(0);

      // (2) aria-expanded flips or the trigger no longer exists.
      const stillHasTrigger = (await trigger.count()) > 0;
      if (stillHasTrigger) {
        await expect(trigger, `[${theme}] trigger aria-expanded=false after Enter`).toHaveAttribute(
          "aria-expanded",
          "false",
        );
      }

      // (3) Focus lands on the destination crumb inside the breadcrumb nav.
      const active = await page.evaluate((expectedText) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) {
          return {
            isBody: true,
            insideNav: false,
            matchesTarget: false,
            role: null,
            tag: "BODY",
            label: null,
          };
        }
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        const insideNav = !!(nav && nav.contains(el));
        const text = (el.textContent ?? "").trim();
        const label = el.getAttribute("aria-label") || text.slice(0, 60);
        const matchesTarget =
          el.getAttribute("aria-current") === "page" ||
          text === expectedText ||
          label === expectedText;
        return {
          isBody: false,
          insideNav,
          matchesTarget,
          role: el.getAttribute("role"),
          tag: el.tagName,
          label,
        };
      }, target.text);

      expect(active.isBody, `[${theme}] focus not restored to <body> after Enter`).toBe(false);
      expect(
        active.role,
        `[${theme}] focus not stuck on a stale menuitem in a leaked portal`,
      ).not.toBe("menuitem");
      expect(
        active.insideNav,
        `[${theme}] post-Enter focus lives inside breadcrumb nav (got tag=${active.tag}, label="${active.label}")`,
      ).toBe(true);
      expect(
        active.matchesTarget,
        `[${theme}] post-Enter focus is on the walked-to crumb "${target.text}" (got "${active.label}")`,
      ).toBe(true);
    });
  }
});
