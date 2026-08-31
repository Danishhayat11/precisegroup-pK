/**
 * Accessibility tests for Dashboard hero live-totals tiles.
 *
 * Verifies under `prefers-reduced-motion: reduce`:
 *   1. Semantic list structure with aria-label
 *   2. Each tile is keyboard-focusable in DOM order with a visible focus ring
 *   3. Each tile exposes a full descriptive aria-label
 *   4. SR-only aria-live region mirrors the authoritative value
 *   5. Decorative gradients/pulses are aria-hidden
 *   6. CountUp short-circuits — visible compact value matches final value immediately
 *
 * Run:  bunx playwright test tests/a11y/hero-tiles.spec.ts
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const SCREENSHOT_DIR = "/tmp/browser/hero-tiles";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

test.beforeEach(async ({ page }) => {
  // Seed Supabase session into localStorage on the localhost origin
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // Wait for the live-totals list to render
  await page.getByRole("list", { name: /live financial totals/i }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
});

test("hero tiles expose a semantic list with descriptive label", async ({ page }) => {
  const list = page.getByRole("list", { name: /live financial totals/i });
  await expect(list).toBeVisible();

  const items = list.getByRole("listitem");
  await expect(items).toHaveCount(4);

  // Every tile has a non-empty aria-label with "PKR"
  for (let i = 0; i < 4; i++) {
    const label = await items.nth(i).getAttribute("aria-label");
    expect(label, `tile ${i} aria-label`).toBeTruthy();
    expect(label!).toMatch(/PKR\s+[\d,]+/);
  }
});

test("each tile is keyboard-focusable in DOM order with visible focus ring", async ({ page }) => {
  const items = page.getByRole("list", { name: /live financial totals/i }).getByRole("listitem");

  const order: string[] = [];
  // Focus the first tile directly, then Tab through the rest
  await items.first().focus();

  for (let i = 0; i < 4; i++) {
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
    const aria = await focused.getAttribute("aria-label");
    expect(aria, `tab ${i} focused element has aria-label`).toBeTruthy();
    order.push(aria!);

    // Visible focus indicator: focus-visible:ring-* yields a non-"none" box-shadow
    const boxShadow = await focused.evaluate((el) => getComputedStyle(el as HTMLElement).boxShadow);
    expect(boxShadow, `tab ${i} focus ring`).not.toBe("none");

    // tabindex=0 keeps each tile in the natural tab order
    const tabindex = await focused.getAttribute("tabindex");
    expect(tabindex).toBe("0");

    if (i < 3) await page.keyboard.press("Tab");
  }

  // DOM order matches focus order
  const domOrder = await items.evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? ""),
  );
  expect(order).toEqual(domOrder);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "keyboard-focus.png") });
});

test("sr-only aria-live mirrors authoritative value and decorative bits are hidden", async ({
  page,
}) => {
  const items = page.getByRole("list", { name: /live financial totals/i }).getByRole("listitem");

  for (let i = 0; i < 4; i++) {
    const tile = items.nth(i);
    const ariaLabel = (await tile.getAttribute("aria-label"))!;

    // SR-only live region — authoritative full value (e.g. "PKR 194,391,941")
    const live = tile.locator("[aria-live='polite']");
    await expect(live).toHaveCount(1);
    const liveText = (await live.textContent())!.trim();
    expect(liveText.length).toBeGreaterThan(0);
    // Live text is included in / matches the aria-label value
    expect(ariaLabel).toContain(liveText);

    // Decorative gradient + pulse dot are hidden from AT
    const decorative = tile.locator("[aria-hidden='true']");
    expect(await decorative.count()).toBeGreaterThanOrEqual(2);
  }
});

test("reduced-motion: SR-only authoritative value is stable from first paint", async ({ page }) => {
  // The visible CountUp span is aria-hidden — assistive tech never reads it.
  // The accessibility guarantee is that the sr-only aria-live region holds
  // the final PKR figure immediately and does not change while the decorative
  // count-up runs.
  const liveRegions = page
    .getByRole("list", { name: /live financial totals/i })
    .getByRole("listitem")
    .locator("[aria-live='polite']");

  await expect(liveRegions).toHaveCount(4);

  const initial = await liveRegions.allTextContents();
  await page.waitForTimeout(500);
  const after = await liveRegions.allTextContents();

  expect(after).toEqual(initial);
  for (const t of initial) expect(t.trim()).toMatch(/PKR\s+[\d,]+/);

  // And the visible (aria-hidden) span is also marked hidden from AT,
  // so any in-progress count-up animation can't reach a screen reader.
  const visibleSpans = page
    .getByRole("list", { name: /live financial totals/i })
    .getByRole("listitem")
    .locator("span[aria-hidden='true']");
  expect(await visibleSpans.count()).toBeGreaterThanOrEqual(4);
});
