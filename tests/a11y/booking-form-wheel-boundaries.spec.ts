/**
 * BookingForm — mouse-wheel increments on Sold Rate / Down Payment
 * respect the same cross-field boundary thresholds and trigger the
 * same banner behavior as keyboard / typed input.
 *
 * Wheel-to-step is a native `<input type="number">` behavior that is
 * browser-dependent: Chromium and WebKit step the value by 1 per wheel
 * notch on a focused numeric input; Firefox intentionally does NOT
 * (they consider it an accessibility/UX footgun). BookingForm renders
 * the inputs as bare `type="number"` with no `onWheel` handler, so we
 * inherit whatever the browser does.
 *
 * To stay honest across browsers, each test first probes the runtime
 * to see whether wheel actually changes the value, and skips (rather
 * than falsely passing) when it doesn't. When wheel IS active, we pin:
 *
 *   1. Wheel scrolling on a focused input changes the value by the
 *      expected direction (up = increase, down = decrease).
 *   2. The value stays clamped at `min="0"` — wheeling past zero on
 *      Down Payment does not produce a negative value.
 *   3. When wheel steps the value across a cross-field boundary, Save
 *      surfaces the correct banner (role="alert" + aria-live).
 *   4. When wheel steps back into the allowed range, the banner clears
 *      on the wheel tick itself (before Save) via `setFormError(null)`.
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
  await fieldByLabel(dialog, /Client Name/i).fill("Wheel Client");
  await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
  await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");
}

function liveBanner(dialog: Locator) {
  return dialog.locator('[data-testid="booking-form-error"]');
}

async function clickSave(dialog: Locator) {
  await dialog.getByRole("button", { name: /Create booking/i }).click();
}

/**
 * Send one wheel notch to a focused input. Negative deltaY = wheel-up
 * (browsers step the number UP); positive deltaY = wheel-down (DOWN).
 * Uses page.mouse.wheel over the input's center so the event's target
 * is the input itself, not the surrounding dialog.
 */
async function wheelOn(page: Page, input: Locator, deltaY: number) {
  await input.focus();
  const box = await input.boundingBox();
  if (!box) throw new Error("input has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
}

/**
 * Probe whether this browser steps type=number on wheel. Returns the
 * numeric delta the browser applied for one wheel-up notch (typically
 * +1 on Chromium/WebKit, 0 on Firefox). Restores the field afterward.
 */
async function detectWheelStep(page: Page, input: Locator): Promise<number> {
  await input.fill("100");
  await wheelOn(page, input, -1);
  const after = Number((await input.inputValue()) || "0");
  await input.fill("");
  return after - 100;
}

test.describe("BookingForm — mouse-wheel increments respect boundary thresholds", () => {
  test("Sold Rate wheeled from 100,000 down to 99,999 → min-contract banner appears; wheeling back clears it", async ({
    page,
    browserName,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    const soldRate = fieldByLabel(dialog, /Sold Rate \/ Sqft/i);

    const step = await detectWheelStep(page, soldRate);
    test.skip(
      step === 0,
      `Wheel-to-step is not active on ${browserName}; native <input type=number> ignores wheel here.`,
    );

    await soldRate.fill("100000");
    await wheelOn(page, soldRate, +1); // wheel-down → value decreases by 1
    await expect(soldRate).toHaveValue("99999");

    await clickSave(dialog);
    const banner = liveBanner(dialog);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner).toHaveAttribute("aria-live", "assertive");
    await expect(dialog.getByText(MIN_ERROR)).toBeVisible();

    // Wheel back across the boundary — the on-change handler must
    // clear the banner immediately so the next Save is a fresh state.
    await wheelOn(page, soldRate, -1);
    await expect(soldRate).toHaveValue("100000");
    await expect(banner).toHaveCount(0);
  });

  test("Down Payment wheeled from 200,000 up to 200,001 → dp banner appears; wheeling back clears it", async ({
    page,
    browserName,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("200000");
    const dp = fieldByLabel(dialog, /Down Payment Cash/i);

    const step = await detectWheelStep(page, dp);
    test.skip(
      step === 0,
      `Wheel-to-step is not active on ${browserName}; native <input type=number> ignores wheel here.`,
    );

    await dp.fill("200000");
    await wheelOn(page, dp, -1); // wheel-up → value increases by 1
    await expect(dp).toHaveValue("200001");

    await clickSave(dialog);
    const banner = liveBanner(dialog);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner).toHaveAttribute("aria-live", "assertive");
    await expect(dialog.getByText(DP_ERROR)).toBeVisible();

    await wheelOn(page, dp, +1);
    await expect(dp).toHaveValue("200000");
    await expect(banner).toHaveCount(0);
  });

  test("Wheeling Down Payment past zero clamps at min='0' (no negative value produced)", async ({
    page,
    browserName,
  }) => {
    // Native min="0" applies to wheel steps as well as arrow keys.
    // If a browser ever regresses this, the guard `form.down_payment > sale`
    // still fires on Save — but we pin the clamping so wheel can never
    // produce a nonsensical negative value that other math relies on.
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    const dp = fieldByLabel(dialog, /Down Payment Cash/i);

    const step = await detectWheelStep(page, dp);
    test.skip(
      step === 0,
      `Wheel-to-step is not active on ${browserName}; native <input type=number> ignores wheel here.`,
    );

    await dp.fill("2");
    for (let i = 0; i < 10; i++) await wheelOn(page, dp, +1); // wheel-down repeatedly

    const value = await dp.inputValue();
    expect(["0", ""]).toContain(value);
  });
});
