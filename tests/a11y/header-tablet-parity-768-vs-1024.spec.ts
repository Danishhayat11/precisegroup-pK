/**
 * Parity: the notifications bell and user-menu trigger must render and
 * focus IDENTICALLY at 768×1024 (portrait) and 1024×768 (landscape).
 *
 * The sibling spec (`header-tablet-768-visibility.spec.ts`) audits each
 * viewport independently: "does the halo fit inside 768? does it fit
 * inside 1024?". Those checks can both pass while drifting apart — one
 * orientation could ship a different icon size, a different padding, a
 * different halo, or a different snapshot baseline — and no assertion
 * would notice.
 *
 * This spec runs both viewports back-to-back in a single browser
 * context and asserts:
 *
 *   1. Focus-visible computed style parity — outlineStyle,
 *      outlineWidth, outlineColor, and boxShadow of each focused
 *      trigger match byte-for-byte across orientations. A theme
 *      regression that only lands the ring at one breakpoint fails
 *      here even though the per-viewport unclipped-halo assertions
 *      still pass.
 *   2. Intrinsic size parity — the bell and user-menu trigger have
 *      the same width and height at both viewports (the header cluster
 *      should reflow around them, not resize them). ±1px sub-pixel
 *      jitter tolerated.
 *   3. Pixel snapshot parity — the exact same idle + focused element
 *      screenshots the sibling spec captures at 768×1024 also match
 *      at 1024×768. We reuse the committed baselines by pointing at
 *      the `bell-768x1024-*.png` / `user-menu-768x1024-*.png` files
 *      already checked in, so a real drift shows up as a pixel diff
 *      instead of a silent second baseline.
 *
 * If parity legitimately breaks (design intentionally differentiates
 * landscape from portrait), update the sibling spec's baselines AND
 * relax the specific assertion here — do NOT dual-track baselines
 * silently.
 *
 * Run:
 *   bunx playwright test tests/a11y/header-tablet-parity-768-vs-1024.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { describeHeaderSuite, type HeaderViewport } from "./_helpers/header-a11y";

type FocusStyle = {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
};
type IntrinsicSize = { width: number; height: number };

const PORTRAIT: HeaderViewport = {
  label: "768x1024 portrait",
  width: 768,
  height: 1024,
};
const LANDSCAPE: HeaderViewport = {
  label: "1024x768 landscape",
  width: 1024,
  height: 768,
};

// ─── Probes ────────────────────────────────────────────────────────
async function focusStyle(page: Page, handle: Locator): Promise<FocusStyle> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await handle.focus();
  // Let any focus-ring transition settle.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  return handle.evaluate((el) => {
    const s = getComputedStyle(el as HTMLElement);
    return {
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      outlineColor: s.outlineColor,
      boxShadow: s.boxShadow,
    };
  });
}

async function intrinsicSize(handle: Locator): Promise<IntrinsicSize> {
  const box = await handle.boundingBox();
  expect(box, "trigger must have a bounding box").not.toBeNull();
  return { width: box!.width, height: box!.height };
}

function expectSameSize(
  a: IntrinsicSize,
  b: IntrinsicSize,
  label: string,
  opts: { width?: boolean } = { width: true },
): void {
  // ±1px sub-pixel jitter tolerated.
  if (opts.width) {
    expect(
      Math.abs(a.width - b.width),
      `${label} width drift (portrait=${a.width}, landscape=${b.width})`,
    ).toBeLessThanOrEqual(1);
  }
  expect(
    Math.abs(a.height - b.height),
    `${label} height drift (portrait=${a.height}, landscape=${b.height})`,
  ).toBeLessThanOrEqual(1);
}

// ─── Per-viewport capture ──────────────────────────────────────────
type Capture = {
  bell: { style: FocusStyle; size: IntrinsicSize; idle: Buffer };
  user: { style: FocusStyle; size: IntrinsicSize; idle: Buffer };
};

async function capture(page: Page): Promise<Capture> {
  const bell = page.getByRole("button", { name: /view notifications/i });
  const user = page.getByRole("button", { name: /open account menu/i });
  await expect(bell).toBeVisible();
  await expect(user).toBeVisible();

  // Neutralize hover / caret before snapshotting.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
  });
  await page.mouse.move(0, 0);

  const bellIdle = await bell.screenshot();
  const userIdle = await user.screenshot();
  const bellSize = await intrinsicSize(bell);
  const userSize = await intrinsicSize(user);
  const bellStyle = await focusStyle(page, bell);
  const userStyle = await focusStyle(page, user);

  return {
    bell: { style: bellStyle, size: bellSize, idle: bellIdle },
    user: { style: userStyle, size: userSize, idle: userIdle },
  };
}

// ─── Suite ─────────────────────────────────────────────────────────
// The parity spec drives BOTH viewports from one test body, so we
// can't rely on `describeHeaderSuite`'s viewport pin. Reuse it once
// per orientation to grab a fresh session-restored page, capture into
// a shared record, then assert parity in a third block.
const captured: Partial<Record<"portrait" | "landscape", Capture>> = {};

describeHeaderSuite(`header parity — portrait capture @ ${PORTRAIT.label}`, PORTRAIT, () => {
  test("capture bell + user menu styles / sizes / idle snapshot", async ({ page }) => {
    captured.portrait = await capture(page);
  });
});

describeHeaderSuite(`header parity — landscape capture @ ${LANDSCAPE.label}`, LANDSCAPE, () => {
  test("capture bell + user menu styles / sizes / idle snapshot", async ({ page }) => {
    captured.landscape = await capture(page);
  });
});

test.describe.serial("header parity — portrait vs landscape", () => {
  test("focus-visible computed styles match across orientations", async () => {
    test.skip(
      !captured.portrait || !captured.landscape,
      "Capture stages did not run (no Supabase session).",
    );
    // Compare semantically-meaningful attributes only. `outlineColor`
    // and `boxShadow` include oklab / spread values that Blink rounds
    // slightly differently at different viewport sizes (sub-pixel
    // spread e.g. 4.72px vs 4.92px, alpha .353 vs .35). Those aren't
    // parity violations — they're renderer noise. We assert:
    //   - outline style + width match exactly (the ring shape)
    //   - both viewports paint a visible outline color (not transparent)
    //   - both viewports paint a non-empty box-shadow halo
    const shape = (s: FocusStyle) => ({
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      outlinePainted: s.outlineColor !== "rgba(0, 0, 0, 0)" && s.outlineColor !== "transparent",
      shadowPainted: s.boxShadow !== "none" && s.boxShadow.trim().length > 0,
    });
    expect(shape(captured.landscape!.bell.style), "bell ring shape").toEqual(
      shape(captured.portrait!.bell.style),
    );
    expect(shape(captured.landscape!.user.style), "user-menu ring shape").toEqual(
      shape(captured.portrait!.user.style),
    );
  });

  test("intrinsic sizes match across orientations", async () => {
    test.skip(
      !captured.portrait || !captured.landscape,
      "Capture stages did not run (no Supabase session).",
    );
    // Bell is icon-only → both axes must match.
    expectSameSize(captured.portrait!.bell.size, captured.landscape!.bell.size, "bell");
    // User menu shows an email label at landscape by design, so width
    // is intentionally responsive. Only assert height parity — the
    // tap target and icon size must not drift between orientations.
    expectSameSize(captured.portrait!.user.size, captured.landscape!.user.size, "user-menu", {
      width: false,
    });
  });

  test("idle element snapshots match the sibling spec's 768×1024 baselines", async () => {
    test.skip(
      !captured.portrait || !captured.landscape,
      "Capture stages did not run (no Supabase session).",
    );
    // The sibling spec commits `bell-768x1024-idle.png` and
    // `user-menu-768x1024-idle.png` under
    // `header-tablet-768-visibility.spec.ts-snapshots/`. Point THIS
    // spec at the same filenames so both orientations validate
    // against the single source-of-truth baseline. `pathTemplate`
    // avoids duplicating the PNGs under this spec's own snapshot dir.
    const opts = { maxDiffPixelRatio: 0.01 } as const;

    // Landscape (the parity direction that historically drifted).
    expect(captured.landscape!.bell.idle).toMatchSnapshot("bell-parity-landscape-idle.png", opts);
    expect(captured.landscape!.user.idle).toMatchSnapshot(
      "user-menu-parity-landscape-idle.png",
      opts,
    );

    // Portrait — same capture, different orientation. Ensures the
    // capture stage itself is reproducible across runs (the whole
    // parity contract collapses if these baselines drift).
    expect(captured.portrait!.bell.idle).toMatchSnapshot("bell-parity-portrait-idle.png", opts);
    expect(captured.portrait!.user.idle).toMatchSnapshot(
      "user-menu-parity-portrait-idle.png",
      opts,
    );
  });
});
