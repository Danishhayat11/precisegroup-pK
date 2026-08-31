/**
 * Regression: forces a loader throw and verifies the router's
 * `defaultErrorComponent` (DefaultErrorComponent in src/router.tsx) renders
 * and that its "Try again" button performs the exact
 * `router.invalidate() + reset()` retry contract:
 *
 *   1. Direct navigation to /test-throw triggers an SSR loader throw and
 *      renders the "Something went wrong" UI.
 *   2. The auto-retry countdown text is announced (aria-live).
 *   3. Clicking "Try again" re-runs the loader (invalidate) and re-renders
 *      the boundary (reset) — error still throws → still on the error UI,
 *      but loader invocation count has incremented.
 *   4. After flipping the control flag so the loader resolves, clicking
 *      "Try again" recovers the page and renders the success component.
 *
 * Run:  bunx playwright test tests/a11y/default-error-retry.spec.ts
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";

test.describe("Default error component retry behavior", () => {
  test("invalidate + reset re-runs the loader and recovers when it stops throwing", async ({
    page,
  }) => {
    // Silence the deliberate console.error from DefaultErrorComponent so a
    // strict console listener wouldn't flag it.
    page.on("pageerror", () => {});

    // 1. SSR-throw path: navigate directly. The loader throws on the server,
    //    so the initial HTML already contains the DefaultErrorComponent.
    await page.goto(`${BASE}/test-throw`, { waitUntil: "domcontentloaded" });

    const heading = page.getByRole("heading", { name: "Something went wrong" });
    await expect(heading).toBeVisible();

    // 2. aria-live countdown / retry status text is present.
    const liveStatus = page.locator('[aria-live="polite"]').first();
    await expect(liveStatus).toBeVisible();
    await expect(liveStatus).toContainText(/Retrying( automatically)?( now)?/);

    // SSR loader ran in the worker (not the browser window), so the
    // client-side counter starts at 0 and is incremented by client-side
    // loader runs only — exactly what we want to observe.
    const initialInvocations = await page.evaluate(
      () => (window as unknown as { __loaderInvocations?: number }).__loaderInvocations ?? 0,
    );

    // 3. Manual "Try again" while the loader still throws.
    //    Ensure the flag forces another throw, then click.
    await page.evaluate(() => {
      (window as unknown as { __forceLoaderThrow?: boolean }).__forceLoaderThrow = true;
    });

    await page.getByRole("button", { name: "Try again" }).click();

    // Error UI is still showing.
    await expect(heading).toBeVisible();

    // Loader invocations must have advanced — proves invalidate() actually
    // re-ran the loader (not just reset() clearing the boundary).
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => (window as unknown as { __loaderInvocations?: number }).__loaderInvocations ?? 0,
          ),
        { timeout: 5000 },
      )
      .toBeGreaterThan(initialInvocations);

    const afterFailedRetry = await page.evaluate(
      () => (window as unknown as { __loaderInvocations?: number }).__loaderInvocations ?? 0,
    );

    // 4. Flip the flag so the loader resolves, then click "Try again".
    await page.evaluate(() => {
      (window as unknown as { __forceLoaderThrow?: boolean }).__forceLoaderThrow = false;
    });

    await page.getByRole("button", { name: "Try again" }).click();

    // Success component renders → reset() cleared the boundary AND invalidate()
    // re-ran the loader with the new (passing) result.
    const ok = page.getByTestId("test-throw-ok");
    await expect(ok).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("invocations")).toHaveText(String(afterFailedRetry + 1));

    // Error UI must be gone.
    await expect(heading).toHaveCount(0);
  });
});
