import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — after Enter on an overflow item, the menu is fully
 * unmounted (no orphan portals) and document.activeElement's identity
 * matches the destination crumb element in the rendered trail.
 *
 * "Identity" here means the exact DOM node reference — not just its
 * text or href — so a regression that leaves focus on a stale portal
 * anchor with matching text (a common pitfall when a Radix popper is
 * detached but not unmounted) still fails this test.
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

async function readHighlightedTarget(page: Page): Promise<{ text: string; href: string }> {
  return page.evaluate(() => {
    const highlighted = document.querySelector<HTMLElement>('[role="menuitem"][data-highlighted]');
    if (!highlighted) throw new Error("no highlighted menuitem found");
    const anchor =
      (highlighted.tagName === "A" ? (highlighted as HTMLAnchorElement) : null) ??
      highlighted.querySelector<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) throw new Error("highlighted menuitem exposes no href");
    return {
      text: (highlighted.textContent ?? "").trim(),
      href: new URL(href, window.location.origin).pathname,
    };
  });
}

test.describe("Breadcrumbs — Enter unmounts overflow menu and focuses destination crumb node", () => {
  for (const theme of THEMES) {
    test(`${theme} · overflow menu fully unmounts and activeElement === destination crumb`, async ({
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

      // Wait for initial highlight then step once so the target row
      // isn't the auto-highlighted first item.
      await page.waitForFunction(
        () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
        undefined,
        { timeout: 2000 },
      );
      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, "fixture yields multiple hidden crumbs").toBeGreaterThan(1);

      const initialIdx = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        return els.findIndex((el) => el.hasAttribute("data-highlighted"));
      });
      const targetIdx = Math.min(initialIdx + 1, itemCount - 1);
      if (targetIdx !== initialIdx) {
        await page.keyboard.press("ArrowDown");
        await page.waitForFunction(
          (idx) => {
            const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            return els[idx]?.hasAttribute("data-highlighted") ?? false;
          },
          targetIdx,
          { timeout: 2000 },
        );
      }

      const target = await readHighlightedTarget(page);
      expect(target.href.startsWith("/"), `internal href (got ${target.href})`).toBe(true);
      expect(target.href, "destination differs from current URL").not.toBe(
        new URL(FIXTURE_URL, "http://x").pathname,
      );

      await page.keyboard.press("Enter");

      await page.waitForFunction((expected) => window.location.pathname === expected, target.href, {
        timeout: 5000,
      });

      // ---- Assertion 1: overflow menu is FULLY unmounted ----------------
      // Not just closed/hidden — no role="menu", no [role="menuitem"],
      // no Radix popper portal wrapper, and the trigger reports
      // aria-expanded="false" (or is gone if the trail no longer overflows).
      const unmountState = await page.evaluate(() => {
        const menuNodes = document.querySelectorAll('[role="menu"]').length;
        const menuItemNodes = document.querySelectorAll('[role="menuitem"]').length;
        // Radix DropdownMenu.Content sets these data attributes on its
        // portal wrapper; a lingering wrapper means the menu detached
        // visually but React never unmounted the subtree.
        const popperWrappers = document.querySelectorAll(
          "[data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-portal]",
        ).length;
        const trigger = document.querySelector<HTMLElement>(
          'nav[aria-label="Breadcrumb"] button[aria-haspopup="menu"]',
        );
        return {
          menuNodes,
          menuItemNodes,
          popperWrappers,
          triggerExpanded: trigger?.getAttribute("aria-expanded") ?? null,
        };
      });
      expect(unmountState.menuNodes, 'no role="menu" left after Enter').toBe(0);
      expect(unmountState.menuItemNodes, 'no role="menuitem" left after Enter').toBe(0);
      expect(unmountState.popperWrappers, "no Radix popper/portal remnants after Enter").toBe(0);
      // If the trigger still exists it must not claim the menu is open.
      if (unmountState.triggerExpanded !== null) {
        expect(unmountState.triggerExpanded, "trigger aria-expanded reset").toBe("false");
      }

      // ---- Assertion 2: activeElement IDENTITY matches the crumb node ---
      // Locate the destination crumb in the newly rendered breadcrumb
      // trail (aria-current="page" OR terminal <li>), then compare
      // document.activeElement by reference — not by text/href — to
      // that exact node. We tag both sides via a shared symbol on
      // window so we can compare identity across the JSON boundary.
      const identity = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        if (!nav) return { ok: false, reason: "no breadcrumb nav rendered" };

        // Destination crumb: prefer aria-current="page", else last <li>.
        let destination: HTMLElement | null =
          nav.querySelector<HTMLElement>('[aria-current="page"]');
        if (!destination) {
          const items = nav.querySelectorAll<HTMLElement>("li");
          destination = items[items.length - 1] ?? null;
        }
        if (!destination) return { ok: false, reason: "no destination crumb node" };

        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) {
          return {
            ok: false,
            reason: `activeElement is ${active?.tagName ?? "null"} (focus not landed on a crumb)`,
            destinationText: (destination.textContent ?? "").trim(),
          };
        }

        // Identity match: active element IS the destination crumb
        // node, or is contained inside it (crumb often wraps an
        // <a>/<span> that actually receives focus).
        const sameNode = active === destination;
        const insideDestination = destination.contains(active);
        // Reverse-contain guard: active must not be an ancestor of
        // destination (that would mean focus stayed on <nav> etc).
        const wraps = active.contains(destination) && active !== destination;

        return {
          ok: (sameNode || insideDestination) && !wraps,
          sameNode,
          insideDestination,
          wraps,
          destinationText: (destination.textContent ?? "").trim(),
          activeText: (active.textContent ?? "").trim(),
          activeTag: active.tagName,
        };
      });

      expect(
        identity.ok,
        `activeElement identity matches destination crumb (${JSON.stringify(identity)})`,
      ).toBe(true);
      expect(identity.destinationText, "destination crumb text matches the row we activated").toBe(
        target.text,
      );
    });
  }
});
