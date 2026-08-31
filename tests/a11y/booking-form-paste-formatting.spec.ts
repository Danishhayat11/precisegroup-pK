/**
 * BookingForm — paste-path auto-formatting for CNIC and mobile.
 *
 * The validation spec covers the keystroke path (`pressSequentially`).
 * This suite covers the paste path: a single bulk input event fired
 * with the entire value at once — how a real user pasting from the
 * clipboard, an autofill provider, or a password manager delivers text.
 *
 * We drive this two ways to make sure both code paths behave:
 *
 *   1. `locator.fill(value)` — Playwright emits a single `input` event
 *      with the full string. This is the closest built-in analogue to a
 *      paste and exercises the React `onChange` formatter the same way.
 *   2. A real ClipboardEvent dispatched via `page.evaluate`, with
 *      `clipboardData.getData("text")` matching the pasted string, so
 *      any component that upgrades to a `paste` handler in the future
 *      still gets exercised here.
 *
 * Both paths must:
 *   - strip every non-digit character,
 *   - insert the hyphen(s) at the correct offset,
 *   - cap CNIC at 13 digits and mobile at 11 digits, silently dropping
 *     any overflow instead of accepting a longer raw value.
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

/**
 * Simulate a real paste: fire a ClipboardEvent whose `clipboardData`
 * carries the payload, then — because JSDOM/Chromium won't apply the
 * pasted text automatically when the event isn't user-initiated — also
 * write the value and dispatch `input` so React's `onChange` runs.
 * This mirrors how a component with a `onPaste` handler would receive
 * events, without depending on browser clipboard permissions.
 */
async function pasteInto(input: Locator, value: string) {
  await input.click();
  await input.evaluate((el: HTMLInputElement, text: string) => {
    const proto = Object.getPrototypeOf(el) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );

    // Apply the paste ourselves and notify React via the native setter
    // so the controlled input picks up the change.
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test.describe("BookingForm CNIC/mobile paste auto-formatting", () => {
  test("CNIC: pasting mixed content via fill() strips non-digits and formats", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    const cnic = dialog.getByPlaceholder("XXXXX-XXXXXXX-X");

    // 5 digits — no hyphen yet.
    await cnic.fill("12345");
    await expect(cnic).toHaveValue("12345");

    // 6 digits — first hyphen after the 5th.
    await cnic.fill("123456");
    await expect(cnic).toHaveValue("12345-6");

    // 12 digits — still a single hyphen.
    await cnic.fill("123456789012");
    await expect(cnic).toHaveValue("12345-6789012");

    // 13 digits — second hyphen after the 12th.
    await cnic.fill("1234567890123");
    await expect(cnic).toHaveValue("12345-6789012-3");

    // Mixed pasted content: letters, punctuation, whitespace, spaces
    // between digits. The formatter keeps digits only, in original
    // order.
    await cnic.fill("  abc42-421 12/34 56 7 xyz  ");
    // Digits kept: 4,2,4,2,1,1,2,3,4,5,6,7 = 12 → "42421-123456 7"? no →
    // 12 digits format to "XXXXX-XXXXXXX" (single hyphen).
    await expect(cnic).toHaveValue("42421-1234567");

    // Overflow: 17 digits pasted → cap at 13.
    await cnic.fill("99999888887777766");
    await expect(cnic).toHaveValue("99999-8888877-7");
    // And a hard length invariant — the visible value is exactly 13 digits
    // + 2 hyphens = 15 characters when at cap.
    expect((await cnic.inputValue()).replace(/\D/g, "").length).toBe(13);
  });

  test("CNIC: real ClipboardEvent path also strips non-digits and caps", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    const cnic = dialog.getByPlaceholder("XXXXX-XXXXXXX-X");

    await pasteInto(cnic, "CNIC: 42101-2345678-9  (Alice)");
    // Digits kept: 4,2,1,0,1,2,3,4,5,6,7,8,9 = 13 → fully formatted.
    await expect(cnic).toHaveValue("42101-2345678-9");

    // A second paste of a 20-digit run must still cap at 13.
    await pasteInto(cnic, "12345678901234567890");
    await expect(cnic).toHaveValue("12345-6789012-3");
  });

  test("mobile: pasting mixed content via fill() strips non-digits and formats", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    const mobile = dialog.getByPlaceholder("03XX-XXXXXXX");

    // 4 digits — no hyphen yet.
    await mobile.fill("0300");
    await expect(mobile).toHaveValue("0300");

    // 5 digits — hyphen after the 4th.
    await mobile.fill("03001");
    await expect(mobile).toHaveValue("0300-1");

    // 11 digits — Pakistan mobile shape.
    await mobile.fill("03001234567");
    await expect(mobile).toHaveValue("0300-1234567");

    // Mixed: international prefix + spaces + punctuation. The +92
    // country code is a common paste; we keep every digit including
    // the leading 9, 2 — the formatter doesn't try to rewrite the
    // country prefix, only enforce shape and cap.
    await mobile.fill("+92 300 123 4567");
    // Digits kept: 9,2,3,0,0,1,2,3,4,5,6,7 = 12 → capped at 11 →
    // "9230012345 6" → "9230-0123456"? No: first 4 = "9230", rest = "0123456".
    await expect(mobile).toHaveValue("9230-0123456");

    // Overflow: 15 digits → cap at 11.
    await mobile.fill("030012345671111");
    await expect(mobile).toHaveValue("0300-1234567");
    expect((await mobile.inputValue()).replace(/\D/g, "").length).toBe(11);
  });

  test("mobile: real ClipboardEvent path also strips non-digits and caps", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    const mobile = dialog.getByPlaceholder("03XX-XXXXXXX");

    await pasteInto(mobile, "Mobile: 0301-2345678 (WhatsApp)");
    await expect(mobile).toHaveValue("0301-2345678");

    await pasteInto(mobile, "0300 1234 5678 9999");
    // Digits: 0,3,0,0,1,2,3,4,5,6,7,8,9,9,9,9 = 16 → cap 11 → "0300-1234567".
    await expect(mobile).toHaveValue("0300-1234567");
  });
});
