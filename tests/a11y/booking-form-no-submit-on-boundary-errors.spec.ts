/**
 * BookingForm — boundary-violating Save attempts must NOT hit the API.
 *
 * Complements booking-form-boundaries.spec.ts. Where that spec pins the
 * exact error-message contract, this spec pins the request contract:
 * when a just-under sale price or a just-over down payment triggers a
 * cross-field guard in BookingForm.handleSave, the client must short-
 * circuit before any INSERT is issued to PostgREST.
 *
 * We assert two things per case:
 *   1. The corresponding error banner is visible in the dialog.
 *   2. Zero POST/PATCH/PUT requests to /rest/v1/bookings were sent
 *      between clicking Save and the assertion.
 *
 * GET requests to /rest/v1/bookings (list fetch on dialog open) are
 * ignored — only mutating verbs count as a "submission".
 */
import { test, expect, type Page, type Locator, type Request } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

const MIN_ERROR = /Sale price must be at least/i;
const DP_ERROR = /Down payment cannot exceed sale price/i;
const MUTATING = new Set(["POST", "PATCH", "PUT"]);
const BOOKINGS_ENDPOINT = /\/rest\/v1\/bookings(\?|$)/;

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

test.beforeAll(() => {
  test.skip(
    AUTH_STATUS !== "injected",
    `Requires injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=${AUTH_STATUS || "absent"})`,
  );
});

async function restoreSession(page: Page) {
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON);
    for (const c of cookies) c.url = BASE;
    await page.context().addCookies(cookies);
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
}

async function openNewBookingDialog(page: Page) {
  await page.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /New booking/i }).click();
  const dialog = page.getByRole("dialog", { name: /New booking/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

function fieldByLabel(dialog: Locator, labelText: string | RegExp) {
  return dialog
    .locator("div", { has: dialog.locator("label", { hasText: labelText }) })
    .filter({ has: dialog.locator("input, textarea") })
    .first()
    .locator("input, textarea")
    .first();
}

async function fillIdentity(dialog: Locator) {
  await fieldByLabel(dialog, /Client Name/i).fill("No-Submit Client");
  await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
  await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");
}

async function setPricing(dialog: Locator, salePrice: number, downPayment: number) {
  await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
  await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill(String(salePrice));
  await fieldByLabel(dialog, /Down Payment Cash/i).fill(String(downPayment));
}

/**
 * Start recording mutating requests to /rest/v1/bookings AFTER the
 * dialog is open — the list fetch on page load is a GET and would be
 * ignored anyway, but scoping the listener keeps the assertion tight.
 * Returns a snapshot getter; call it after the Save click + a short
 * settle window so any in-flight submission has a chance to appear.
 */
function trackBookingWrites(page: Page) {
  const writes: Array<{ method: string; url: string }> = [];
  const onRequest = (req: Request) => {
    if (MUTATING.has(req.method()) && BOOKINGS_ENDPOINT.test(req.url())) {
      writes.push({ method: req.method(), url: req.url() });
    }
  };
  page.on("request", onRequest);
  return {
    writes,
    stop: () => page.off("request", onRequest),
  };
}

async function clickSaveAndSettle(page: Page, dialog: Locator) {
  await dialog.getByRole("button", { name: /Create booking/i }).click();
  // Give the network a beat: if a mutation was going to fire, it fires
  // synchronously in the same tick as the click handler. Wait for the
  // error text OR a short timeout — whichever comes first.
  await page.waitForTimeout(500);
}

test.describe("BookingForm — boundary-violating Save does not POST bookings", () => {
  test("sale price 99,999 (one under min) → min error shown, no bookings write", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, 99_999, 0);

    const tracker = trackBookingWrites(page);
    await clickSaveAndSettle(page, dialog);
    tracker.stop();

    await expect(dialog.getByText(MIN_ERROR)).toBeVisible();
    expect(
      tracker.writes,
      `Expected no mutating requests to /rest/v1/bookings, got: ${JSON.stringify(tracker.writes)}`,
    ).toEqual([]);
  });

  test("down payment 200,001 vs sale 200,000 (one over) → dp error shown, no bookings write", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, 200_000, 200_001);

    const tracker = trackBookingWrites(page);
    await clickSaveAndSettle(page, dialog);
    tracker.stop();

    await expect(dialog.getByText(DP_ERROR)).toBeVisible();
    expect(
      tracker.writes,
      `Expected no mutating requests to /rest/v1/bookings, got: ${JSON.stringify(tracker.writes)}`,
    ).toEqual([]);
  });
});
