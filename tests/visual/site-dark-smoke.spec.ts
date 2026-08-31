import { expect, test, type Page } from "@playwright/test";

/**
 * /site marketing — DARK-MODE token smoke test.
 *
 * Mirrors site-light-smoke.spec.ts but forces `.dark` on the root and
 * asserts the inverted palette pair. Fires whenever dark tokens are
 * touched. For every /site* route:
 *
 *   1. Root html carries `.dark`.
 *   2. Body background resolves to rich ink (hsl(0 0% 7%) → ~rgb(18,18,18))
 *      — fails if a light token leaked or a hardcoded paper hex overrode.
 *   3. Body foreground is warm paper (hsl(42 29% 93%) → ~rgb(242,239,232),
 *      Y > 0.80) — proves `--foreground` is wired.
 *   4. Primary CTA (header "Enquire") renders inverted vs light:
 *        · paper background  (Y > 0.80) — `--primary` in dark
 *        · near-ink foreground (Y < 0.15) — `--primary-foreground`
 *      Fails if the pair inverts (i.e. the dark override was dropped or
 *      the light values leaked into `.dark`).
 *
 * Run:
 *   bunx playwright test tests/visual/site-dark-smoke.spec.ts
 *   bun run test:visual:dark-smoke
 */

const ROUTES = ["/site", "/site/services", "/site/projects", "/site/contact"] as const;

const INK_TARGET = { r: 18, g: 18, b: 18 };
const INK_TOLERANCE = 10; // per-channel

async function forceDark(page: Page) {
  // Pre-hydration: set the canonical storage key so the init script in <head>
  // resolves `dark` on first paint — no reliance on system prefs. Mirrors
  // THEME_STORAGE_KEY in src/lib/theme.tsx.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("precise.theme", "dark");
    } catch {
      /* storage unavailable */
    }
    const root = document.documentElement;
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
}

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
  test(`dark-mode tokens render on ${path}`, async ({ page }) => {
    await forceDark(page);
    await page.goto(path, { waitUntil: "networkidle" });
    await installResolver(page);
    await page.waitForTimeout(120);

    // 1. root class must carry `.dark`
    const cls = await page.evaluate(() => document.documentElement.className);
    expect(cls, `root should carry .dark on ${path}`).toContain("dark");

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
    expect(Math.abs(bg.r - INK_TARGET.r), `body bg.r drift on ${path}`).toBeLessThanOrEqual(
      INK_TOLERANCE,
    );
    expect(Math.abs(bg.g - INK_TARGET.g), `body bg.g drift on ${path}`).toBeLessThanOrEqual(
      INK_TOLERANCE,
    );
    expect(Math.abs(bg.b - INK_TARGET.b), `body bg.b drift on ${path}`).toBeLessThanOrEqual(
      INK_TOLERANCE,
    );
    expect(luminance(body.fg!), `body fg should be paper on ${path}`).toBeGreaterThan(0.8);

    // 4. primary CTA pair (header "Enquire") — inverted vs light
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
      `primary CTA bg should be paper on ${path} (got Y=${ctaBgY.toFixed(3)})`,
    ).toBeGreaterThan(0.8);
    expect(
      ctaFgY,
      `primary CTA fg should be near-ink on ${path} (got Y=${ctaFgY.toFixed(3)})`,
    ).toBeLessThan(0.15);
  });
}
