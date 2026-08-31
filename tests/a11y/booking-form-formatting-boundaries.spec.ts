/**
 * BookingForm — sale price / down payment input formatting and boundary
 * interaction with formatted values.
 *
 * BookingForm currently renders Sold Rate and Down Payment as native
 * `<input type="number">`. That means:
 *
 *   - Comma-formatted values ("100,000") are INVALID for the control
 *     and the browser normalizes the field to empty on commit. The form
 *     state stays at 0 for that field, so cross-field guards behave as
 *     if the user typed nothing.
 *   - Decimal values ("99999.99", "100000.01") ARE valid and flow into
 *     `form.sold_rate` / `form.down_payment` verbatim. The MIN_CONTRACT_VALUE
 *     guard uses strict `<` on the derived `soldUnitValue`, so decimals
 *     participate correctly: 99999.99 → error, 100000.01 → no error.
 *   - The Sold Unit Value display is a read-only field rendered through
 *     `fmtPKR(...)`, so it is always comma-formatted regardless of raw
 *     input shape.
 *
 * This spec pins those three contracts. If someone later swaps the
 * numeric inputs for masked/comma-formatted text inputs, they must
 * update the normalization test to match the new parsing behavior AND
 * keep the decimal-boundary tests green.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

const MIN_ERROR = /Sale price must be at least/i;
const DP_ERROR = /Down payment cannot exceed sale price/i;

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
  await fieldByLabel(dialog, /Client Name/i).fill("Formatting Client");
  await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
  await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");
}

/**
 * Paste text into a field via the clipboard API. `fill()` on a
 * `type="number"` input silently drops non-numeric strings before they
 * reach the DOM, so it can't exercise the browser's own normalization.
 * A paste round-trips through the browser exactly like a user's Cmd+V.
 */
async function pasteInto(page: Page, input: Locator, text: string) {
  await input.focus();
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
}

const CLIPBOARD_PERMS: ["clipboard-read", "clipboard-write"] = [
  "clipboard-read",
  "clipboard-write",
];

test.describe("BookingForm — comma-formatted values are normalized (rejected) by numeric inputs", () => {
  test("pasting '100,000' into Sold Rate leaves the field empty and the display value at PKR 0", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(CLIPBOARD_PERMS, { origin: BASE });
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");

    const soldRate = fieldByLabel(dialog, /Sold Rate \/ Sqft/i);
    await pasteInto(page, soldRate, "100,000");

    // Native <input type="number"> rejects the comma-formatted string —
    // reading .value returns "" and the derived display stays at PKR 0.
    await expect(soldRate).toHaveValue("");
    const soldValueField = fieldByLabel(dialog, /Sold Unit Value/i);
    await expect(soldValueField).toHaveValue(/PKR\s*0/);
  });

  test("pasting '250,000.50' into Down Payment leaves the field empty (comma invalidates the whole value)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(CLIPBOARD_PERMS, { origin: BASE });
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);

    const dp = fieldByLabel(dialog, /Down Payment Cash/i);
    await pasteInto(page, dp, "250,000.50");
    await expect(dp).toHaveValue("");
  });
});

test.describe("BookingForm — read-only Sold Unit Value is comma-formatted", () => {
  test("size 100 × sold rate 1500 → derived value renders as 'PKR 150,000'", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("100");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("1500");

    const soldValueField = fieldByLabel(dialog, /Sold Unit Value/i);
    await expect(soldValueField).toHaveValue(/PKR\s*150,000/);
  });
});

test.describe("BookingForm — decimal values still trigger boundary constraints", () => {
  test("sold rate 99999.99 with size 1 → below min → min-contract error appears", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("99999.99");
    await fieldByLabel(dialog, /Down Payment Cash/i).fill("0");
    await dialog.getByRole("button", { name: /Create booking/i }).click();
    await expect(dialog.getByText(MIN_ERROR)).toBeVisible();
  });

  test("sold rate 100000.01 with size 1 → above min → NO min-contract error", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("100000.01");
    await fieldByLabel(dialog, /Down Payment Cash/i).fill("0");
    await dialog.getByRole("button", { name: /Create booking/i }).click();
    await expect(dialog.getByText(MIN_ERROR)).toHaveCount(0);
  });

  test("down payment 200000.01 vs sale 200000 → cent-over-sale triggers down-payment error", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("200000");
    await fieldByLabel(dialog, /Down Payment Cash/i).fill("200000.01");
    await dialog.getByRole("button", { name: /Create booking/i }).click();
    await expect(dialog.getByText(DP_ERROR)).toBeVisible();
  });

  test("down payment 199999.99 vs sale 200000 → cent-under-sale → NO down-payment error", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("200000");
    await fieldByLabel(dialog, /Down Payment Cash/i).fill("199999.99");
    await dialog.getByRole("button", { name: /Create booking/i }).click();
    await expect(dialog.getByText(DP_ERROR)).toHaveCount(0);
  });
});
