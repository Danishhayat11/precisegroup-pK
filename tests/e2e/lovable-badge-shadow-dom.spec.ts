/**
 * Shadow-DOM defense-in-depth for the Lovable badge.
 *
 * `lovable-badge-hidden.spec.ts` covers the light-DOM path. This spec covers
 * the shadow-DOM path — even if the badge is ever injected inside an open
 * shadow root (either at the top level or nested inside another shadow root),
 * the runtime purge in `src/lib/lovable-badge-purge.ts` must remove it and
 * no visible `#lovable-badge` fragment may remain.
 *
 * Strategy:
 *   1. Recursively walk every open shadow root reachable from `document`
 *      and assert no element with id `lovable-badge` exists in any of them.
 *   2. Simulate an injection: attach a shadow root ourselves, mount a fake
 *      `#lovable-badge` inside it, wait a beat for the MutationObserver
 *      in the purge script to fire, and assert the node was removed.
 *   3. Do the same one level deeper (shadow root inside a shadow root) to
 *      prove the recursive-observer path works.
 *
 * Closed shadow roots (`{ mode: "closed" }`) are unreachable by design and
 * documented as a known limitation in `docs/lovable-badge.md`; this spec
 * does not attempt to cover them.
 */
import { test, expect, type Page } from "@playwright/test";

const PUBLIC_ROUTES = ["/", "/site"] as const;
const BADGE_ID = "lovable-badge";

/**
 * Walk every open shadow root reachable from `document` and collect any
 * element that matches `#lovable-badge`. Runs entirely in the page context
 * so `.shadowRoot` returns the live tree (Playwright's default query does
 * not pierce shadow boundaries).
 */
async function findBadgesInAnyShadowRoot(page: Page): Promise<string[]> {
  return page.evaluate((badgeId) => {
    const hits: string[] = [];
    const walk = (root: Document | ShadowRoot, path: string) => {
      // Direct hits inside this root's own tree.
      const direct = root.querySelectorAll?.(`#${badgeId}`) ?? [];
      for (let i = 0; i < direct.length; i++) {
        hits.push(`${path} > ${direct[i].tagName.toLowerCase()}#${badgeId}`);
      }
      // Recurse into every open shadow root hanging off any descendant.
      const all = root.querySelectorAll?.("*") ?? [];
      for (let i = 0; i < all.length; i++) {
        const el = all[i] as Element & { shadowRoot?: ShadowRoot | null };
        if (el.shadowRoot) {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : "";
          walk(el.shadowRoot, `${path} > ${tag}${id}::shadow`);
        }
      }
    };
    walk(document, "document");
    return hits;
  }, badgeId);
}

/**
 * Mount a fake `#lovable-badge` in a fresh shadow root at the given depth
 * (1 = shadow root off the document, 2 = shadow root nested inside a
 * shadow root, …). Returns after the mutation lands so the caller can
 * poll for the purge script to remove it.
 */
async function injectBadgeAtShadowDepth(page: Page, depth: number, badgeId: string): Promise<void> {
  await page.evaluate(
    ({ depth, badgeId }) => {
      // Fresh host each call to avoid cross-test bleed.
      const host = document.createElement("div");
      host.setAttribute("data-test-shadow-host", `depth-${depth}`);
      document.body.appendChild(host);

      let cursor: ShadowRoot = host.attachShadow({ mode: "open" });
      for (let level = 1; level < depth; level++) {
        const nestedHost = document.createElement("div");
        nestedHost.setAttribute("data-test-shadow-host", `depth-${level + 1}-nested`);
        cursor.appendChild(nestedHost);
        cursor = nestedHost.attachShadow({ mode: "open" });
      }

      const badge = document.createElement("div");
      badge.id = badgeId;
      // Concrete visible content — proves absence isn't a false positive
      // from an empty container getting layout-collapsed.
      badge.style.cssText =
        "position:fixed;bottom:16px;right:16px;width:180px;height:40px;background:#f0abfc;color:#111;z-index:2147483647;";
      badge.textContent = "Made with Lovable";
      const close = document.createElement("button");
      close.setAttribute("aria-label", "Close");
      close.textContent = "×";
      badge.appendChild(close);
      cursor.appendChild(badge);
    },
    { depth, badgeId },
  );
}

/**
 * Poll until the badge has been removed from every reachable shadow root,
 * or the timeout expires. Returns the final hit list so failures can be
 * pinned to a specific shadow path.
 */
async function expectPurgedFromShadow(page: Page, timeoutMs = 2000): Promise<void> {
  await expect.poll(() => findBadgesInAnyShadowRoot(page), { timeout: timeoutMs }).toEqual([]);
}

test.describe("Lovable badge cannot appear inside shadow DOM", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`baseline: no #lovable-badge in any open shadow root on ${route}`, async ({ page }) => {
      const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
      test.skip(!resp || resp.status() >= 400, `route ${route} returned ${resp?.status()}`);

      // Purge script only removes when the override is enabled; skip the
      // shadow-root assertions when the env flag intentionally disables it.
      const overrideEnabled = await page.locator("html").getAttribute("data-hide-lovable-badge");
      test.skip(
        overrideEnabled === "false",
        `VITE_HIDE_LOVABLE_BADGE=false on ${route}; override intentionally disabled`,
      );

      await page.waitForLoadState("networkidle").catch(() => {});

      const hits = await findBadgesInAnyShadowRoot(page);
      expect(
        hits,
        `Unexpected #${BADGE_ID} inside shadow DOM on ${route}:\n${hits.join("\n")}`,
      ).toEqual([]);
    });

    test(`purge removes badge injected into a shadow root on ${route}`, async ({ page }) => {
      const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
      test.skip(!resp || resp.status() >= 400, `route ${route} returned ${resp?.status()}`);

      const overrideEnabled = await page.locator("html").getAttribute("data-hide-lovable-badge");
      test.skip(
        overrideEnabled === "false",
        `VITE_HIDE_LOVABLE_BADGE=false on ${route}; override intentionally disabled`,
      );

      await page.waitForLoadState("networkidle").catch(() => {});

      // Depth-1: shadow root attached directly to a body-level host.
      await injectBadgeAtShadowDepth(page, 1, BADGE_ID);
      await expectPurgedFromShadow(page);

      // Depth-2: shadow root nested inside another shadow root exercises
      // the recursive observer + attachShadow patch in the purge script.
      await injectBadgeAtShadowDepth(page, 2, BADGE_ID);
      await expectPurgedFromShadow(page);
    });
  }
});
