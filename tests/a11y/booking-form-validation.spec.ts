/**
 * BookingForm — validation, auto-formatting, and cross-field rules.
 *
 * Drives the real New Booking dialog in the running preview:
 *   - CNIC input auto-formats digit-stream → XXXXX-XXXXXXX-X as you type
 *     and caps at 13 digits.
 *   - Mobile input auto-formats → 03XX-XXXXXXX and caps at 11 digits.
 *   - Client name < 3 chars, invalid CNIC, and invalid mobile all surface
 *     inline error messages on Save (nothing is persisted).
 *   - Down payment > sold unit value triggers the cross-field
 *     "Down payment cannot exceed sale price" error on Save.
 *   - Sold unit value below the PKR 100,000 minimum also blocks save.
 *
 * The dialog is auth-gated. When there is no injected Supabase session
 * (`LOVABLE_BROWSER_AUTH_STATUS !== "injected"`) the suite skips — the
 * unauthenticated preview redirects to /auth and there is no dialog to
 * exercise. No rows are written: every case exits at the client-side
 * validation gate before the insert would fire.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

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

// The form's <Label>s aren't wired with `htmlFor`, so `getByLabel` can't
// resolve them. Locate the wrapping <div> that contains the label text and
// return the first input/textarea inside — matches the actual DOM shape
// (`<div><Label>…</Label><Input/></div>`) used throughout BookingForm.
function fieldByLabel(dialog: Locator, labelText: string | RegExp) {
  return dialog
    .locator("div", { has: dialog.locator("label", { hasText: labelText }) })
    .filter({ has: dialog.locator("input, textarea") })
    .first()
    .locator("input, textarea")
    .first();
}

test.describe("BookingForm validation & auto-formatting", () => {
  test("CNIC input auto-formats digits to XXXXX-XXXXXXX-X and caps at 13 digits", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);

    const cnic = dialog.getByPlaceholder("XXXXX-XXXXXXX-X");
    await cnic.click();
    // Type 5 digits → no hyphen yet.
    await cnic.pressSequentially("12345");
    await expect(cnic).toHaveValue("12345");
    // 6th digit inserts first hyphen.
    await cnic.pressSequentially("6");
    await expect(cnic).toHaveValue("12345-6");
    // Fill out to 12 digits → single hyphen still.
    await cnic.pressSequentially("789012");
    await expect(cnic).toHaveValue("12345-6789012");
    // 13th digit inserts second hyphen.
    await cnic.pressSequentially("3");
    await expect(cnic).toHaveValue("12345-6789012-3");
    // Extra digits are dropped (max 13).
    await cnic.pressSequentially("9999");
    await expect(cnic).toHaveValue("12345-6789012-3");
    // Non-digit characters are stripped.
    await cnic.fill("");
    await cnic.pressSequentially("abc42!!42$$1@2345#67");
    // Digits kept: 4242123456 7 → 10 digits → "42421-234567"? Actually digits: 4,2,4,2,1,2,3,4,5,6,7 = 11.
    await expect(cnic).toHaveValue("42421-234567");
  });

  test("mobile input auto-formats digits to 03XX-XXXXXXX and caps at 11 digits", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);

    const mobile = dialog.getByPlaceholder("03XX-XXXXXXX");
    await mobile.click();
    await mobile.pressSequentially("0300");
    await expect(mobile).toHaveValue("0300");
    await mobile.pressSequentially("1");
    await expect(mobile).toHaveValue("0300-1");
    await mobile.pressSequentially("234567");
    await expect(mobile).toHaveValue("0300-1234567");
    // Cap at 11 digits — extra digits dropped.
    await mobile.pressSequentially("9999");
    await expect(mobile).toHaveValue("0300-1234567");
  });

  test("save surfaces client name, CNIC, and mobile format errors and does not persist", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);

    // Too-short name, partial (invalid) CNIC and mobile.
    await fieldByLabel(dialog, /Client Name/i).fill("Al");
    await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("1234");
    await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("0300");

    await dialog.getByRole("button", { name: /Create booking/i }).click();

    await expect(dialog.getByText(/at least 3 characters/i)).toBeVisible();
    await expect(dialog.getByText(/CNIC must be XXXXX-XXXXXXX-X/i)).toBeVisible();
    await expect(dialog.getByText(/Mobile must be 03XX-XXXXXXX/i)).toBeVisible();

    // Dialog stays open — save was blocked before the insert fired.
    await expect(dialog).toBeVisible();
  });

  test("down payment greater than sold unit value triggers cross-field error", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);

    // Give the form otherwise-valid identity / client fields so only the
    // cross-field pricing rule remains as a blocker.
    await fieldByLabel(dialog, /Client Name/i).fill("Valid Client Name");
    await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
    await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");

    // Sold Unit Value = sold_rate × size_sqft. Pick 10,000 × 20 = 200,000
    // (above the PKR 100,000 minimum), then set down payment above it.
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("20");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("10000");
    await fieldByLabel(dialog, /Down Payment Cash/i).fill("500000");

    await dialog.getByRole("button", { name: /Create booking/i }).click();

    await expect(dialog.getByText(/Down payment cannot exceed sale price/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("sold unit value below minimum contract value blocks save", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);

    await fieldByLabel(dialog, /Client Name/i).fill("Valid Client Name");
    await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
    await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");

    // 100 × 500 = 50,000 — under the 100,000 minimum.
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("100");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("500");

    await dialog.getByRole("button", { name: /Create booking/i }).click();

    await expect(dialog.getByText(/Sale price must be at least/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});
