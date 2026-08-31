import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu Enter / Space activation contract.
 *
 * Sister to `breadcrumbs-overflow-enter-navigates.spec.ts` (Enter on a
 * walked row) — this spec locks the wider "activation key" surface:
 * BOTH Enter and Space must activate the currently-highlighted item,
 * AND the assertion runs on both the auto-highlighted first row and a
 * walked-to non-first row so we don't drift into a one-key or
 * first-item-only regression.
 *
 * The full contract, verified in both themes for each activation key,
 * on both the first row (index 0) and a non-first row (index 1):
 *
 *   1. Menu is open with `aria-expanded="true"` before activation.
 *   2. Snapshot the highlighted row's text + `href` BEFORE pressing
 *      the key — the DOM is gone post-navigation, so we compare
 *      against a pre-captured target.
 *   3. Press the activation key. The router MUST settle on the
 *      row's exact `href` (this is what "selects the correct
 *      breadcrumb" means for a breadcrumb link).
 *   4. The menu unmounts (`role="menu"` gone) — no lingering portal.
 *   5. The app treats the new URL as that row's page: the crumb
 *      trail's `aria-current="page"` (or terminal crumb) matches
 *      the row's text.
 *   6. Focus is on a valid, visible element — NOT lost to `<body>`,
 *      NOT stuck on a stale menuitem, NOT sitting on a Radix
 *      focus-guard (0x0 span). The expected landing spot is the
 *      overflow trigger for the new URL (if the shorter path still
 *      collapses crumbs) OR the destination crumb's anchor (if it
 *      doesn't). Either satisfies "returned to the expected element".
 */

const THEMES = ["light", "dark"] as const;
const ACTIVATION_KEYS = ["Enter", "Space"] as const;
const TARGET_INDICES = [0, 1] as const;
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

/** Wait for Radix's post-open auto-highlight so ArrowDown lands deterministically. */
async function waitForFirstAutoHighlight(page: Page) {
  await page.waitForFunction(
    () => {
      const first = document.querySelector<HTMLElement>('[role="menuitem"]');
      return !!first && first.hasAttribute("data-highlighted");
    },
    undefined,
    { timeout: 2000 },
  );
}

async function waitForHighlightIndex(page: Page, index: number) {
  await page.waitForFunction(
    (i) => {
      const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      return items[i]?.hasAttribute("data-highlighted") ?? false;
    },
    index,
    { timeout: 2000 },
  );
}

/**
 * Read the currently-highlighted menuitem's text + destination href
 * before activation. `href` is normalized to a pathname so string
 * compares later don't fail on protocol / host noise.
 */
async function readHighlightedTarget(page: Page): Promise<{ text: string; href: string }> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[role="menuitem"][data-highlighted]');
    if (!el) throw new Error("no highlighted menuitem found");
    const anchor =
      (el.tagName === "A" ? (el as HTMLAnchorElement) : null) ??
      el.querySelector<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) throw new Error("highlighted menuitem exposes no href");
    return {
      text: (el.textContent ?? "").trim(),
      href: new URL(href, window.location.origin).pathname,
    };
  });
}

async function currentPageCrumbText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
    if (!nav) return null;
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) return (active.textContent ?? "").trim();
    const items = nav.querySelectorAll<HTMLElement>("li");
    const last = items[items.length - 1];
    return last ? (last.textContent ?? "").trim() : null;
  });
}

async function activeElementDescriptor(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return {
        isBody: true,
        isMenuItem: false,
        isFocusGuard: false,
        isTrigger: false,
        isDestinationAnchor: false,
        tag: el ? el.tagName.toLowerCase() : "null",
        text: "",
      };
    }
    const rect = el.getBoundingClientRect();
    const anchor =
      (el.tagName === "A" ? (el as HTMLAnchorElement) : null) ??
      el.querySelector<HTMLAnchorElement>("a[href]");
    return {
      isBody: false,
      isMenuItem: el.getAttribute("role") === "menuitem",
      isFocusGuard:
        (rect.width === 0 && rect.height === 0) || el.hasAttribute("data-radix-focus-guard"),
      isTrigger:
        el.tagName === "BUTTON" && /hidden breadcrumb/i.test(el.getAttribute("aria-label") ?? ""),
      isDestinationAnchor:
        !!anchor &&
        new URL(anchor.href, window.location.origin).pathname === window.location.pathname,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? "").trim().slice(0, 80),
    };
  });
}

test.describe("Breadcrumbs — overflow menu Enter / Space activation selects the correct row and returns focus", () => {
  for (const theme of THEMES) {
    for (const key of ACTIVATION_KEYS) {
      for (const idx of TARGET_INDICES) {
        const rowLabel = idx === 0 ? "first (auto-highlighted)" : `walked (index ${idx})`;
        test(`${theme} · ${key} on ${rowLabel} row navigates, closes menu, focus lands on a real element`, async ({
          page,
        }) => {
          await forceTheme(page, theme);
          await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
          await page.evaluate(() => document.fonts?.ready);
          await page.waitForTimeout(300);

          const trigger = overflowTrigger(page);
          await expect(trigger, "overflow trigger renders").toBeVisible();
          await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");

          // Open (Space is Radix's standard keyboard activation for the trigger).
          await trigger.focus();
          const menu = await openMenu(page, trigger, {
            activation: "Space",
            label: `overflow menu (${theme} · ${key} · idx ${idx})`,
          });
          await expect(menu, "menu visible after open").toBeVisible();
          await expect(trigger, 'aria-expanded="true" while menu is open').toHaveAttribute(
            "aria-expanded",
            "true",
          );

          await waitForFirstAutoHighlight(page);

          const itemCount = await page.locator('[role="menuitem"]').count();
          expect(itemCount, "fixture yields multiple hidden crumbs").toBeGreaterThan(idx);

          // Walk to the target index (no-op when idx === 0).
          if (idx > 0) {
            for (let i = 0; i < idx; i++) {
              await page.keyboard.press("ArrowDown");
            }
            await waitForHighlightIndex(page, idx);
          }

          // Snapshot the intended destination BEFORE activation —
          // the menu portal is gone once the router settles on the new URL.
          const target = await readHighlightedTarget(page);
          expect(target.text.length, "highlighted row has visible text").toBeGreaterThan(0);
          expect(
            target.href.startsWith("/"),
            `target href is an app-internal path (got ${target.href})`,
          ).toBe(true);
          expect(
            target.href,
            "target row does not point at the current URL (would make navigation a no-op)",
          ).not.toBe(new URL(FIXTURE_URL, "http://x").pathname);

          // ── Activate ────────────────────────────────────────────
          // page.keyboard.press('Space') sends the same event Radix
          // treats as menuitem activation; 'Enter' is the other one.
          await page.keyboard.press(key);

          // Router must settle on the exact href of the row we activated.
          await page.waitForFunction(
            (expected) => window.location.pathname === expected,
            target.href,
            { timeout: 5000 },
          );

          expect(
            new URL(page.url()).pathname,
            `${key} navigated to the row's href ("${target.text}")`,
          ).toBe(target.href);

          // Menu is fully unmounted.
          await expect(page.getByRole("menu"), `menu closes after ${key} activation`).toHaveCount(
            0,
          );
          expect(
            await page.locator('[role="menuitem"]').count(),
            "no orphan menuitem after activation",
          ).toBe(0);

          // App treats the new URL as the activated row's page.
          const currentCrumb = await currentPageCrumbText(page);
          expect(currentCrumb, "activated row is now the current-page crumb").toBe(target.text);

          // ── Focus contract ──────────────────────────────────────
          // Radix returns focus to the trigger before the router
          // navigates. Post-navigation the trigger may still be
          // present (shorter path still collapses crumbs) OR gone
          // (path is short enough to render inline). Either landing
          // is "expected": the overflow trigger for the new URL, OR
          // the destination crumb's anchor. What must NOT happen:
          // focus lost to <body>, focus stuck on a stale menuitem,
          // focus on a Radix focus-guard.
          const active = await activeElementDescriptor(page);
          expect(active.isBody, `[${key}] focus is NOT lost to <body> after activation`).toBe(
            false,
          );
          expect(
            active.isMenuItem,
            `[${key}] focus is NOT on a stale menuitem after activation`,
          ).toBe(false);
          expect(
            active.isFocusGuard,
            `[${key}] focus is NOT on a Radix focus-guard / 0x0 element after activation`,
          ).toBe(false);
          expect(
            active.isTrigger || active.isDestinationAnchor,
            `[${key}] focus lands on the overflow trigger for the new URL OR on the destination crumb's anchor (got tag=${active.tag}, text="${active.text}")`,
          ).toBe(true);
        });
      }
    }
  }
});
