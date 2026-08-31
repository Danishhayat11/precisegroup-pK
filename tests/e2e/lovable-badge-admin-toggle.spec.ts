/**
 * E2E: /admin/lovable-badge toggle drives html[data-hide-lovable-badge]
 * and badge removal / reappearance behavior across routes.
 *
 * Contract:
 *   1. Clicking "Hide badge" flips html[data-hide-lovable-badge] to "true",
 *      shows a confirmation status banner, and immediately purges any
 *      already-rendered `#lovable-badge` (via the exposed sweep hook +
 *      MutationObserver).
 *   2. Clicking "Show badge" flips the attribute to "false" and the CSS
 *      override no longer applies — a freshly-injected badge is visible.
 *   3. The override persists across routes (localStorage-backed) so
 *      navigating to another public route inherits the "hide" state and
 *      purges an injected badge there too.
 *   4. Clicking "Clear (use build default)" falls back to the env default.
 *
 * Requires an injected Lovable session (admin route). Self-skips otherwise.
 * Also self-skips if the signed-in user is not admin (the admin gate
 * renders AdminRequiredMessage instead of the toggle group).
 */
import { test, expect, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

const ORIGIN = process.env.BASE_URL ?? "http://localhost:8080";
const OVERRIDE_KEY = "lovable-badge-hide-override";

/** Inject a fake `#lovable-badge` at the end of <body>. Resolves once attached. */
async function injectFakeBadge(page: Page) {
  await page.evaluate(() => {
    // Remove any prior fake so repeated injections work.
    document.getElementById("lovable-badge")?.remove();
    const el = document.createElement("div");
    el.id = "lovable-badge";
    el.setAttribute("data-testid", "fake-lovable-badge");
    el.style.cssText =
      "position:fixed;bottom:16px;right:16px;width:120px;height:32px;background:#111;color:#fff;z-index:2147483647;";
    el.textContent = "Made with Lovable";
    document.body.appendChild(el);
  });
}

test.describe("Lovable badge admin toggle", () => {
  test.skip(!authAvailable(), "Requires an injected Lovable Supabase session.");

  test.beforeEach(async ({ context }) => {
    // Ensure each test starts with no override — otherwise a prior run
    // could carry state across tests.
    await context.addInitScript((key) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* storage unavailable */
      }
    }, OVERRIDE_KEY);
  });

  test("toggle updates html attribute, purges badge, and persists across routes", async ({
    context,
    page,
  }) => {
    await restoreSupabaseSession(context, page, ORIGIN);

    await page.goto(`${ORIGIN}/admin/lovable-badge`, { waitUntil: "domcontentloaded" });

    const hideBtn = page.getByRole("button", { name: "Hide badge" });
    const showBtn = page.getByRole("button", { name: "Show badge" });
    const clearBtn = page.getByRole("button", { name: /Clear \(use build default\)/ });

    // Non-admins see AdminRequiredMessage, not the toggle group. Self-skip
    // if the buttons aren't rendered so the suite passes cleanly.
    const buttonsPresent = await hideBtn
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!buttonsPresent, "Signed-in user is not admin on this environment.");

    const html = page.locator("html");
    const status = page.getByTestId("lovable-badge-status");

    // --- 1. Inject a fake badge, then click "Hide badge" ---
    await injectFakeBadge(page);
    await expect(page.locator("#lovable-badge")).toHaveCount(1);

    await hideBtn.click();
    await expect(html).toHaveAttribute("data-hide-lovable-badge", "true");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/badge is now hidden/i);
    // Sweep hook must have removed the node from the DOM.
    await expect(page.locator("#lovable-badge")).toHaveCount(0);
    // localStorage override is persisted.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), OVERRIDE_KEY)).toBe("true");

    // --- 2. Late injection under "hide" is also removed by the observer ---
    await injectFakeBadge(page);
    await expect(page.locator("#lovable-badge")).toHaveCount(0, { timeout: 2_000 });

    // --- 3. Navigate to a public route; override + purge follow us ---
    await page.goto(`${ORIGIN}/site`, { waitUntil: "domcontentloaded" });
    await expect(html).toHaveAttribute("data-hide-lovable-badge", "true");
    await injectFakeBadge(page);
    await expect(page.locator("#lovable-badge")).toHaveCount(0, { timeout: 2_000 });

    // --- 4. Back to admin, click "Show badge" ---
    await page.goto(`${ORIGIN}/admin/lovable-badge`, { waitUntil: "domcontentloaded" });
    await showBtn.click();
    await expect(html).toHaveAttribute("data-hide-lovable-badge", "false");
    await expect(status).toContainText(/badge is now visible/i);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), OVERRIDE_KEY)).toBe("false");

    // After a reload the attribute still says "false" (persistence check),
    // and a freshly-injected badge stays visible (purge no longer removes).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(html).toHaveAttribute("data-hide-lovable-badge", "false");
    await injectFakeBadge(page);
    await expect(page.locator("#lovable-badge")).toBeVisible();

    // --- 5. Clear override → falls back to env default (attribute is
    // whichever the build shipped; assert it's "true"/"false", not stale). ---
    await clearBtn.click();
    const cleared = await page.evaluate((k) => window.localStorage.getItem(k), OVERRIDE_KEY);
    expect(cleared).toBeNull();
    const attr = await html.getAttribute("data-hide-lovable-badge");
    expect(attr === "true" || attr === "false").toBe(true);
    await expect(status).toContainText(/override set to "cleared/i);
  });
});
