/**
 * AdjustmentForm — submit-side regressions
 * ---------------------------------------------------------------------------
 * Locks three behaviours that were reported flaky in earlier passes:
 *
 *   1. Double-submit prevention.
 *      Clicking "Save adjustment" twice in rapid succession must fire exactly
 *      one POST to /rest/v1/adjustments — the second click hits a disabled
 *      button and is a no-op.
 *
 *   2. Loading state.
 *      While the mutation is in flight, the Save button is disabled and its
 *      label switches to "Saving…". Cancel is also disabled during flight.
 *
 *   3. Post-save toast + query refetch.
 *      On success the dialog transitions to the "Adjustment … recorded"
 *      summary (onSuccess ran, invalidateQueries fired), and no destructive
 *      toast appears.
 *
 * The spec intercepts the three Supabase REST calls the form makes so it
 * runs deterministically without depending on seed data, but it drives the
 * real React form — the click handlers, validation, and mutation wiring are
 * unmocked.
 */
import { test, expect, type Route } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

const ORIGIN = process.env.BASE_URL ?? "http://localhost:8080";
const SUPABASE_HOST = "omxephqkcxynzxekywhn.supabase.co";

// A synthetic booking wide enough that the form's cash-remaining validator
// (sale - down - adj - cash) leaves headroom for our 100,000 test amount.
const FAKE_BOOKING = {
  booking_id: "BK-TEST-DOUBLESUBMIT",
  client_name: "Test Client",
  client_ref: "CL-TEST",
  unit_id: "U-TEST-01",
  project_name: "Test Project",
  total_contract_value: 5_000_000,
  down_payment: 0,
  adjustment_credit: 0,
  cash_received: 0,
  remaining_balance: 5_000_000,
};

test.describe("AdjustmentForm submit regressions", () => {
  test.skip(!authAvailable(), "Requires an injected Lovable Supabase session.");

  test("double-click Save fires exactly one insert, shows loading state, then success summary", async ({
    context,
    page,
  }) => {
    await restoreSupabaseSession(context, page, ORIGIN);

    // ---- Network interception -------------------------------------------
    // Track how many times the adjustments insert endpoint was hit.
    let insertCount = 0;

    // Booking dropdown fetch — the form guards on `!open || booking` and
    // selects `client_ref, total_contract_value, ...`, so we key off the
    // presence of `total_contract_value` in the select clause to avoid
    // colliding with the page-level allowed-bookings query.
    await context.route(
      (url) =>
        url.host === SUPABASE_HOST &&
        url.pathname.endsWith("/rest/v1/bookings") &&
        url.search.includes("total_contract_value"),
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([FAKE_BOOKING]),
        });
      },
    );

    // ID allocator RPC — delay so the mutation is observably in-flight
    // during the second click.
    await context.route(
      (url) =>
        url.host === SUPABASE_HOST && url.pathname.endsWith("/rest/v1/rpc/next_adjustment_id"),
      async (route: Route) => {
        await new Promise((r) => setTimeout(r, 400));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify("ADJ-TEST-1"),
        });
      },
    );

    // The actual insert. Count every call, then delay + succeed the first
    // one, and (defensively) succeed any spurious follow-ups so the test
    // fails on the count assertion rather than on a hanging network call.
    await context.route(
      (url) => url.host === SUPABASE_HOST && url.pathname.endsWith("/rest/v1/adjustments"),
      async (route: Route) => {
        const req = route.request();
        if (req.method() !== "POST") return route.fallback();
        insertCount += 1;
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "content-range": "0-0/1" },
          body: "[]",
        });
      },
    );

    // ---- Navigate & open dialog -----------------------------------------
    await page.goto(`${ORIGIN}/adjustments`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /new adjustment/i }).click();
    await expect(page.getByRole("heading", { name: /new adjustment/i })).toBeVisible();

    // ---- Fill form -------------------------------------------------------
    // Radix Select — open then pick the injected fake booking.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: new RegExp(FAKE_BOOKING.booking_id, "i") }).click();

    await page.getByPlaceholder(/honda civic/i).fill("Test Asset — 2020 Model, Reg XYZ-123");
    // Approved value input is the numeric one; approval date defaults to today.
    await page.locator('input[type="number"]').fill("100000");
    await page.getByPlaceholder(/approver name/i).fill("Test Approver");

    // ---- Double-click Save ----------------------------------------------
    const saveBtn = page.getByRole("button", { name: /save adjustment/i });
    await expect(saveBtn).toBeEnabled();

    // Fire two clicks back-to-back. The first should start the mutation;
    // the second must land on a disabled button and be ignored.
    await Promise.all([saveBtn.click(), saveBtn.click().catch(() => {})]);

    // ---- Loading assertions ---------------------------------------------
    // Radix keeps the same button; text swaps to "Saving…" and it disables.
    const savingBtn = page.getByRole("button", { name: /saving/i });
    await expect(savingBtn).toBeVisible();
    await expect(savingBtn).toBeDisabled();
    await expect(page.getByRole("button", { name: /^cancel$/i })).toBeDisabled();

    // Try a third click on the disabled button — must remain a no-op.
    await savingBtn.click({ force: true }).catch(() => {});

    // ---- Success summary -------------------------------------------------
    await expect(page.getByText(/adjustment adj-test-1 recorded/i)).toBeVisible({ timeout: 5_000 });

    // The button should have transitioned to "Done" (post-save state).
    await expect(page.getByRole("button", { name: /^done$/i })).toBeVisible();

    // No destructive toast fired.
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
    await expect(page.getByText(/could not save adjustment/i)).toHaveCount(0);

    // ---- The core regression assertion ----------------------------------
    // Exactly one insert POST, regardless of how many times Save was clicked.
    expect(insertCount).toBe(1);
  });
});
