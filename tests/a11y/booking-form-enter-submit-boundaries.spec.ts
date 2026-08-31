/**
 * BookingForm — keyboard-only submission after spinner boundary
 * violations behaves identically to click submission.
 *
 * Sibling of booking-form-spinner-no-submit.spec.ts (which uses mouse
 * click on Save). BookingForm doesn't render a `<form>` element, so
 * pressing Enter inside a numeric input is a no-op — the accessible
 * keyboard submission path is:
 *
 *   1. Tick the field with ArrowUp/Down until it crosses the guard.
 *   2. Move focus to the "Create booking" button (Tab or programmatic
 *      focus — we use the button's own .focus() to keep the test
 *      resilient to intermediate focusable elements in the dialog).
 *   3. Press Enter to activate the button.
 *
 * Assertions per case:
 *   (a) the correct error banner is visible and lives in the
 *       [data-testid="booking-form-error"] live region, and
 *   (b) zero POST/PATCH/PUT requests hit /rest/v1/bookings between
 *       the Enter keypress and settle.
 *
 * If BookingForm is ever wrapped in a real <form> with onSubmit, the
 * "focus the Save button" step can be replaced with `input.press("Enter")`
 * and the assertions must still hold.
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
  await fieldByLabel(dialog, /Client Name/i).fill("Enter-Submit Client");
  await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
  await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");
}

async function stepBy(input: Locator, delta: number) {
  const key = delta > 0 ? "ArrowUp" : "ArrowDown";
  await input.focus();
  for (let i = 0; i < Math.abs(delta); i++) {
    await input.press(key);
  }
}

function liveBanner(dialog: Locator) {
  return dialog.locator('[data-testid="booking-form-error"]');
}

function trackBookingWrites(page: Page) {
  const writes: Array<{ method: string; url: string }> = [];
  const onRequest = (req: Request) => {
    if (MUTATING.has(req.method()) && BOOKINGS_ENDPOINT.test(req.url())) {
      writes.push({ method: req.method(), url: req.url() });
    }
  };
  page.on("request", onRequest);
  return { writes, stop: () => page.off("request", onRequest) };
}

/**
 * Keyboard-only submit: focus the Create button and press Enter.
 * Button activation via Enter is a WAI-ARIA baseline for buttons and
 * fires the same click handler as a mouse click.
 */
async function pressEnterOnSave(page: Page, dialog: Locator) {
  const saveBtn = dialog.getByRole("button", { name: /Create booking/i });
  await saveBtn.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
}

test.describe("BookingForm — Enter-key submission after spinner boundary violations", () => {
  test("Sold Rate spun to 99,999 (under min) → Enter shows min-error banner, no bookings write", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");

    const soldRate = fieldByLabel(dialog, /Sold Rate \/ Sqft/i);
    await soldRate.fill("100000");
    await stepBy(soldRate, -1); // → 99,999
    await expect(soldRate).toHaveValue("99999");

    const tracker = trackBookingWrites(page);
    await pressEnterOnSave(page, dialog);
    tracker.stop();

    const banner = liveBanner(dialog);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner).toHaveAttribute("aria-live", "assertive");
    await expect(dialog.getByText(MIN_ERROR)).toBeVisible();
    expect(
      tracker.writes,
      `Expected no mutating requests to /rest/v1/bookings, got: ${JSON.stringify(tracker.writes)}`,
    ).toEqual([]);
  });

  test("Down Payment spun to 200,001 (over sale 200,000) → Enter shows dp-error banner, no bookings write", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("200000");

    const dp = fieldByLabel(dialog, /Down Payment Cash/i);
    await dp.fill("200000");
    await stepBy(dp, 1); // → 200,001
    await expect(dp).toHaveValue("200001");

    const tracker = trackBookingWrites(page);
    await pressEnterOnSave(page, dialog);
    tracker.stop();

    const banner = liveBanner(dialog);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner).toHaveAttribute("aria-live", "assertive");
    await expect(dialog.getByText(DP_ERROR)).toBeVisible();
    expect(
      tracker.writes,
      `Expected no mutating requests to /rest/v1/bookings, got: ${JSON.stringify(tracker.writes)}`,
    ).toEqual([]);
  });
});
