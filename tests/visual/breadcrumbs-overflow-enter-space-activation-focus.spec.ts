import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — Enter and Space both activate the highlighted row.
 *
 * The WAI-ARIA menu pattern treats Enter and Space as equivalent
 * activation keys on a `menuitem`. This regression pins that both keys
 * behave identically here — closing the menu, flipping
 * `aria-expanded="false"` on the trigger, navigating to the highlighted
 * row's href, and restoring focus to the destination crumb.
 *
 * Complements the Enter-only specs by parametrising over the activation
 * key so a regression that silently drops Space handling (or wires it
 * to a different code path that skips one of the post-activation
 * guarantees) surfaces as a named failing case.
 *
 * Runs across { key × theme }.
 */

const THEMES = ["light", "dark"] as const;
const ACTIVATION_KEYS = ["Enter", "Space"] as const;
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
    // Open via ArrowDown so the menu opens without pre-consuming Space
    // (which is one of the keys under test). ArrowDown opens the Radix
    // dropdown menu and highlights the first item.
    await trigger.press("ArrowDown");
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

test.describe("Breadcrumbs overflow · Enter and Space activate the highlighted row", () => {
  for (const theme of THEMES) {
    for (const key of ACTIVATION_KEYS) {
      test(`${theme} · ${key} on highlighted row closes menu, flips aria-expanded, navigates, and restores focus`, async ({
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

        // ── Open menu, walk down one row so we activate a non-initial item ──
        const menu = await openByKeyboard(page, trigger);
        await expect(menu, `[${theme}] menu open`).toBeVisible();

        const itemCount = await page.locator('[role="menuitem"]').count();
        expect(itemCount, `[${theme}] fixture has multiple hidden crumbs`).toBeGreaterThan(1);

        await waitForHighlightAt(page, 0);
        await page.keyboard.press("ArrowDown");
        await waitForHighlightAt(page, 1);

        const target = await readHighlightedTarget(page);
        expect(target.idx, `[${theme}] highlight advanced to idx 1`).toBe(1);
        expect(
          target.href,
          `[${theme}] target is not the current URL (activation would be a no-op)`,
        ).not.toBe(new URL(FIXTURE_URL, "http://x").pathname);

        // ── Activate with the parametrised key ─────────────────────────────
        // Playwright's page.keyboard.press uses "Space" for the spacebar
        // and "Enter" for return; both are valid Radix activation keys.
        await page.keyboard.press(key);

        // URL matches the row's href — proves activation actually fired.
        await page.waitForFunction(
          (expected) => window.location.pathname === expected,
          target.href,
          { timeout: 5000 },
        );
        expect(
          new URL(page.url()).pathname,
          `[${theme}] ${key} navigated to the highlighted row "${target.text}"`,
        ).toBe(target.href);

        // (1) Menu closed.
        await expect(page.getByRole("menu"), `[${theme}] menu closed after ${key}`).toHaveCount(0);

        // (2) aria-expanded flipped (or trigger is gone after re-collapse).
        if ((await trigger.count()) > 0) {
          await expect(
            trigger,
            `[${theme}] trigger aria-expanded=false after ${key}`,
          ).toHaveAttribute("aria-expanded", "false");
        }

        // (3) Focus restored — not <body>, not a leaked menuitem, and
        //     lands inside the breadcrumb nav on the destination crumb.
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

        expect(active.isBody, `[${theme}] focus not restored to <body> after ${key}`).toBe(false);
        expect(active.role, `[${theme}] focus not stuck on a stale menuitem after ${key}`).not.toBe(
          "menuitem",
        );
        expect(
          active.insideNav,
          `[${theme}] post-${key} focus lives inside breadcrumb nav (got tag=${active.tag}, label="${active.label}")`,
        ).toBe(true);
        expect(
          active.matchesTarget,
          `[${theme}] post-${key} focus on destination crumb "${target.text}" (got "${active.label}")`,
        ).toBe(true);
      });
    }
  }
});
