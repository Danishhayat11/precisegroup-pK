import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared helpers for driving Radix `DropdownMenu` from Playwright.
 *
 * ── Why this file exists ──────────────────────────────────────────────
 * Radix DropdownMenu is *portalled* and *hydration-sensitive*. On the
 * first user interaction after navigation, the very first keydown /
 * click can arrive before Radix has finished attaching its keyboard
 * handler to the trigger, so the menu never opens. Retrying the same
 * activation is safe (it's a toggle only if the menu is already open),
 * as long as we check "is the menu open?" *before* each retry — that
 * is the idempotency guard implemented below.
 *
 * Every `breadcrumbs-overflow-*.spec.ts` used to inline its own copy
 * of a 6-attempt retry loop. Any drift between those copies (different
 * timeout, missing settle, pressing the wrong key) produced flakes
 * that only reproduced on the first spec of a shard. Centralising the
 * open/close primitives here keeps the retry policy in one place.
 *
 * ── Contract ──────────────────────────────────────────────────────────
 * - `openMenu` returns a `Locator` for `role="menu"` that is already
 *   attached and visible, or throws with a descriptive error.
 * - `openMenu` is idempotent: calling it when the menu is already open
 *   is a no-op that returns the existing menu locator.
 * - `closeMenu` is idempotent the same way (Escape is only sent when
 *   a menu is currently open).
 * - Helpers never assume a particular trigger selector — callers pass
 *   the trigger `Locator` they already resolved. This keeps the util
 *   reusable for any Radix DropdownMenu, not just the breadcrumb one.
 */

export type OpenMenuOptions = {
  /**
   * How to activate the trigger. Radix opens on Space, Enter, or
   * ArrowDown from a focused trigger; `click` is the mouse path.
   * Default `Space` matches keyboard-first a11y specs.
   */
  activation?: "Space" | "Enter" | "ArrowDown" | "click";
  /** Max retry attempts. Default 6 — matches the historical inline loops. */
  maxAttempts?: number;
  /** Wait between attempts, ms. Default 250. */
  retryDelayMs?: number;
  /**
   * Optional label used in assertion messages so failures point at
   * the caller (e.g. "overflow menu").
   */
  label?: string;
};

/**
 * Return the currently-open Radix menu locator, or `null` if no menu
 * is attached. Used as the idempotency guard: we never re-activate a
 * trigger that has already produced a menu.
 */
export async function getOpenMenu(page: Page): Promise<Locator | null> {
  const menu = page.getByRole("menu");
  return (await menu.count()) > 0 ? menu.first() : null;
}

/**
 * Open a Radix DropdownMenu with retries that survive the
 * first-navigation hydration race.
 *
 * Idempotency: if a menu is already open when this is called, the
 * existing menu locator is returned without pressing any keys.
 * Otherwise the activation key/click is dispatched up to
 * `maxAttempts` times, checking after each attempt whether Radix has
 * mounted the portal.
 */
export async function openMenu(
  page: Page,
  trigger: Locator,
  options: OpenMenuOptions = {},
): Promise<Locator> {
  const { activation = "Space", maxAttempts = 6, retryDelayMs = 250, label = "menu" } = options;

  // Idempotency guard — do not double-toggle a menu that is already open.
  const existing = await getOpenMenu(page);
  if (existing) return existing;

  // Trigger must be focused for keyboard activation; harmless for click.
  await trigger.focus();

  const menu = page.getByRole("menu");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (activation === "click") {
      await trigger.click();
    } else {
      // Space is written as a literal space to Playwright's press().
      const key = activation === "Space" ? " " : activation;
      await trigger.press(key);
    }

    // Radix mounts the portal synchronously after handling the event,
    // but the very first keydown after hydration can be swallowed —
    // recheck via count() before deciding to retry.
    if ((await menu.count()) > 0) {
      await expect(menu.first(), `[${label}] becomes visible`).toBeVisible();
      return menu.first();
    }

    await page.waitForTimeout(retryDelayMs);
  }

  throw new Error(
    `[${label}] Radix DropdownMenu did not open after ${maxAttempts} ${activation} attempts on ${await trigger.evaluate((el) => el.outerHTML.slice(0, 120))}`,
  );
}

/**
 * Close a Radix DropdownMenu if one is open. Sends Escape (the a11y
 * contract) and waits for the portal to detach. No-op when no menu
 * is currently mounted, so this is safe to call in `afterEach`.
 */
export async function closeMenu(page: Page): Promise<void> {
  const menu = await getOpenMenu(page);
  if (!menu) return;
  await page.keyboard.press("Escape");
  await expect(menu, "menu detaches after Escape").toHaveCount(0);
}
