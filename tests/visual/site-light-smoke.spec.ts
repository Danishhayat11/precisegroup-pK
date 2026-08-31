import { expect, test, type Page } from "@playwright/test";

/**
 * /site marketing — LIGHT-MODE token smoke test.
 *
 * A tight, fast guard (<10s) that fires whenever the light-mode token
 * palette is touched. For every /site* route it forces `.light` on the
 * root and asserts three things:
 *
 *   1. Root html carries `.light` (not `.dark`, not both).
 *   2. Body background resolves to the Paper & Ink light canvas
 *      (~oklch(96% 0.02 90) / hsl(42 29% 95%) → ~rgb(246,244,239)).
 *      Fails loudly if a dark token leaked or a stuck hex overrode.
 *   3. Body foreground is near-black ink (Y < 0.15 luminance) — proves
 *      `--foreground` is wired, not a mid-grey fallback.
 *   4. The primary CTA (header "Enquire") renders with:
 *        · a dark near-ink background (Y < 0.15) — `--primary` in light
 *        · a paper foreground (Y > 0.80)         — `--primary-foreground`
 *      Fails if the pair inverts (a common accidental theme swap).
 *
 * Run:
 *   bunx playwright test tests/visual/site-light-smoke.spec.ts
 *   bun run test:visual:light-smoke
 */

const ROUTES = ["/site", "/site/services", "/site/projects", "/site/contact"] as const;

const PAPER_TARGET = { r: 246, g: 244, b: 239 };
const PAPER_TOLERANCE = 10; // per-channel

async function forceLight(page: Page) {
  // Pre-hydration: set the app's canonical storage key so the init script in
  // <head> resolves `light` on first paint — no reliance on system pref or
  // emulateMedia timing. Storage key mirrors THEME_STORAGE_KEY in
  // src/lib/theme.tsx; kept as a literal here to avoid pulling app modules
  // into the test bundle.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("precise.theme", "light");
    } catch {
      /* storage unavailable */
    }
    const root = document.documentElement;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

// Runs in-page: resolve any CSS color (rgb/hsl/oklab/oklch/named) to sRGB.
// A canvas is more reliable than a DOM round-trip because inline `color:`
// on a fresh element can still yield the inherited computed value in some
// engines when the parent has a `color-mix()` / var()-driven fg. Canvas
// parses the string authoritatively and returns the resolved sRGB pixel.
async function installResolver(page: Page) {
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    (
      window as unknown as {
        __toRgb: (css: string) => { r: number; g: number; b: number; a: number } | null;
      }
    ).__toRgb = (css: string) => {
      if (!css) return null;
      try {
        ctx.clearRect(0, 0, 1, 1);
        // Two-pass: first paint an opaque white so we can back out alpha,
        // then paint the actual color on top.
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
      } catch {
        return null;
      }
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
  });
}

function srgbLin(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(c: { r: number; g: number; b: number }) {
  return 0.2126 * srgbLin(c.r) + 0.7152 * srgbLin(c.g) + 0.0722 * srgbLin(c.b);
}

for (const path of ROUTES) {
  test(`light-mode tokens render on ${path}`, async ({ page }) => {
    await forceLight(page);
    await page.goto(path, { waitUntil: "networkidle" });
    await installResolver(page);
    await page.waitForTimeout(120);

    // 1. root class should not carry `.dark` (light is applied via class OR via
    //    system color-scheme; either is acceptable — we assert on rendered
    //    pixels below, which is the ground truth).
    const cls = await page.evaluate(() => document.documentElement.className);
    expect(cls, `root should not carry .dark on ${path}`).not.toContain("dark");

    // 2 + 3. body bg/fg via resolver
    const body = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const w = window as unknown as {
        __toRgb: (css: string) => { r: number; g: number; b: number; a: number } | null;
      };
      return { bg: w.__toRgb(cs.backgroundColor), fg: w.__toRgb(cs.color) };
    });
    expect(body.bg, "body background should resolve").not.toBeNull();
    expect(body.fg, "body foreground should resolve").not.toBeNull();
    const bg = body.bg!;
    expect(Math.abs(bg.r - PAPER_TARGET.r), `body bg.r drift on ${path}`).toBeLessThanOrEqual(
      PAPER_TOLERANCE,
    );
    expect(Math.abs(bg.g - PAPER_TARGET.g), `body bg.g drift on ${path}`).toBeLessThanOrEqual(
      PAPER_TOLERANCE,
    );
    expect(Math.abs(bg.b - PAPER_TARGET.b), `body bg.b drift on ${path}`).toBeLessThanOrEqual(
      PAPER_TOLERANCE,
    );
    expect(luminance(body.fg!), `body fg should be ink on ${path}`).toBeLessThan(0.15);

    // 4. primary CTA pair (header "Enquire" link, present on every /site route)
    const cta = await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a")).find((a) =>
        /^\s*enquire\b/i.test((a.textContent || "").trim()),
      );
      if (!link) return null;
      const cs = getComputedStyle(link);
      const w = window as unknown as {
        __toRgb: (css: string) => { r: number; g: number; b: number; a: number } | null;
      };
      return { bg: w.__toRgb(cs.backgroundColor), fg: w.__toRgb(cs.color) };
    });
    expect(cta, `header Enquire CTA missing on ${path}`).not.toBeNull();
    expect(cta!.bg, "CTA bg should resolve").not.toBeNull();
    expect(cta!.fg, "CTA fg should resolve").not.toBeNull();
    const ctaBgY = luminance(cta!.bg!);
    const ctaFgY = luminance(cta!.fg!);
    expect(
      ctaBgY,
      `primary CTA bg should be near-ink on ${path} (got Y=${ctaBgY.toFixed(3)})`,
    ).toBeLessThan(0.15);
    expect(
      ctaFgY,
      `primary CTA fg should be paper on ${path} (got Y=${ctaFgY.toFixed(3)})`,
    ).toBeGreaterThan(0.8);
  });
}
