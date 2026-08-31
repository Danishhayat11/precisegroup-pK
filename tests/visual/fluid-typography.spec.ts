import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Fluid-typography & spacing regression suite.
 *
 * Complements `scripts/visual-regression.mjs` (which captures 375 / 768 /
 * 1440 for the marketing shell) with a **wider mobile matrix** — 320 px
 * (iPhone SE 1), 360 px (Android baseline), 375 px (iPhone SE/mini),
 * 414 px (Plus-class), 480 px (large phones), 640 px (Tailwind sm), and
 * 768 px (Tailwind md) — so we catch regressions that only show up in a
 * narrow sub-slice of the fluid range.
 *
 * Each row asserts hard contracts on the clamp()-based scale and captures
 * a full-page screenshot to `test-results/fluid/<route>-<width>.png` for
 * manual review + CI artifact upload.
 *
 * Run:
 *   bunx playwright test tests/visual/fluid-typography.spec.ts
 *   bun run test:visual:fluid
 */

const MOBILE_WIDTHS = [320, 360, 375, 414, 480, 640, 768] as const;

// Public marketing routes — no auth needed, safe on the preview build.
const ROUTES = [
  { path: "/", name: "home" },
  { path: "/site", name: "site" },
  { path: "/site/services", name: "site-services" },
  { path: "/site/projects", name: "site-projects" },
  { path: "/site/contact", name: "site-contact" },
  { path: "/resources/property-management-vs-erp", name: "resources-pm-erp" },
] as const;

// Fluid-scale contracts. These match the clamp() min/max in src/styles.css —
// if the design tokens shift, update these numbers with them.
const CONTRACTS = {
  bodyFontPxMin: 14, // --text-base clamps to 15 → 16 px; safety floor 14
  bodyFontPxMax: 18,
  h1FontPxMin: 22, // --text-4xl clamps 30 → 48 px; floor at 22 for narrow
  h1FontPxMax: 60,
  h2FontPxMin: 18, // --text-3xl clamps 24 → 34 px
  h2FontPxMax: 40,
  containerPadPxMin: 14, // container-fluid clamps 16 → 40 px
  containerPadPxMax: 44,
  tapTargetMinPx: 36, // ≤ 768 CSS px = touch context
  horizontalOverflowSlackPx: 1, // sub-pixel rounding tolerance
};

async function collectMetrics(page: Page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const bodyFs = parseFloat(getComputedStyle(body).fontSize);
    const h1 = document.querySelector("h1");
    const h2 = document.querySelector("h2");

    // Sample container padding — inspect the first element that opts into
    // container-fluid / container-prose / .container so we can assert the
    // fluid padding utility is actually reaching the DOM.
    const container = document.querySelector(
      '.container-fluid, .container-prose, [data-container="fluid"], main > .container',
    );
    const containerPadLeftPx = container
      ? parseFloat(getComputedStyle(container as Element).paddingLeft)
      : null;

    // Wide-element census — anything larger than the viewport is a fluid
    // regression (the #1 cause of horizontal scroll on 320-414 px).
    // Skip decorative descendants that live inside an `overflow:hidden`
    // ancestor (fixed hero orbs, blur washes) — they can't push scroll.
    const vw = window.innerWidth;
    const isClipped = (el: HTMLElement) => {
      let cur: HTMLElement | null = el.parentElement;
      while (cur && cur !== document.body) {
        const cs = getComputedStyle(cur);
        if (cs.overflowX === "hidden" || cs.overflow === "hidden" || cs.overflow === "clip") {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    };
    const wide: Array<{ tag: string; cls: string; width: number }> = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 && r.height > 0 && !isClipped(el)) {
        wide.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 80),
          width: Math.round(r.width),
        });
        if (wide.length >= 8) break;
      }
    }

    // Tap-target census on coarse-pointer widths only (≤ 768).
    let tapUndersized: Array<{ tag: string; text: string; size: string }> = [];
    if (vw <= 768) {
      for (const el of Array.from(
        document.body.querySelectorAll<HTMLElement>('button, a[href], [role="button"]'),
      )) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 36) {
          tapUndersized.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || "").trim().slice(0, 32),
            size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          });
          if (tapUndersized.length >= 8) break;
        }
      }
    }

    // Text overflow — hidden clip without ellipsis is nearly always a bug
    // when it hits H1/H2/lead on mobile.
    const clipped: Array<{ tag: string; text: string; overflow: number }> = [];
    for (const el of Array.from(
      document.body.querySelectorAll<HTMLElement>("h1,h2,h3,p.lead,.lead"),
    )) {
      if (el.scrollWidth - el.clientWidth > 2 && el.clientWidth > 0) {
        const cs = getComputedStyle(el);
        if (cs.overflow !== "visible" && cs.textOverflow !== "ellipsis") {
          clipped.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || "").trim().slice(0, 40),
            overflow: Math.round(el.scrollWidth - el.clientWidth),
          });
        }
      }
    }

    return {
      viewportWidth: vw,
      scrollWidth: html.scrollWidth,
      clientWidth: html.clientWidth,
      bodyFontPx: bodyFs,
      h1FontPx: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null,
      h2FontPx: h2 ? parseFloat(getComputedStyle(h2).fontSize) : null,
      containerPadLeftPx,
      wide,
      tapUndersized,
      clipped,
    };
  });
}

test.describe("Fluid typography & spacing — mobile matrix", () => {
  test.beforeAll(async () => {
    await mkdir(join(process.cwd(), "test-results", "fluid"), { recursive: true });
  });

  for (const route of ROUTES) {
    test.describe(`route: ${route.path}`, () => {
      for (const width of MOBILE_WIDTHS) {
        test(`${width}px  ${route.path}`, async ({ browser }) => {
          const context = await browser.newContext({
            viewport: { width, height: 900 },
            deviceScaleFactor: 2,
            hasTouch: width <= 768,
            reducedMotion: "reduce",
          });
          const page = await context.newPage();

          try {
            const resp = await page.goto(route.path, { waitUntil: "networkidle" });
            expect(resp?.ok(), `HTTP for ${route.path}`).toBe(true);

            // Let fonts settle so clamp() sizing evaluates against Geist, not the
            // fallback stack — otherwise H1/H2 measurements race.
            await page.evaluate(
              () => (document.fonts && document.fonts.ready) || Promise.resolve(),
            );
            await page.waitForTimeout(200);

            const shotPath = join("test-results", "fluid", `${route.name}-${width}.png`);
            await page.screenshot({ path: shotPath, fullPage: true });

            const m = await collectMetrics(page);

            // --- contract: no horizontal scroll on mobile widths ---
            expect(
              m.scrollWidth - m.clientWidth,
              `horizontal overflow at ${width}px — first wide elements: ${JSON.stringify(m.wide.slice(0, 3))}`,
            ).toBeLessThanOrEqual(CONTRACTS.horizontalOverflowSlackPx);

            // --- contract: no element wider than the viewport ---
            expect(
              m.wide,
              `${m.wide.length} element(s) wider than the ${width}px viewport`,
            ).toEqual([]);

            // --- contract: body font-size within clamp bounds ---
            expect(m.bodyFontPx, "body font-size floor").toBeGreaterThanOrEqual(
              CONTRACTS.bodyFontPxMin,
            );
            expect(m.bodyFontPx, "body font-size ceiling").toBeLessThanOrEqual(
              CONTRACTS.bodyFontPxMax,
            );

            // --- contract: H1 within clamp bounds (only when the page has one) ---
            if (m.h1FontPx != null) {
              expect(m.h1FontPx, `h1 floor at ${width}px`).toBeGreaterThanOrEqual(
                CONTRACTS.h1FontPxMin,
              );
              expect(m.h1FontPx, `h1 ceiling at ${width}px`).toBeLessThanOrEqual(
                CONTRACTS.h1FontPxMax,
              );
            }
            if (m.h2FontPx != null) {
              expect(m.h2FontPx, `h2 floor at ${width}px`).toBeGreaterThanOrEqual(
                CONTRACTS.h2FontPxMin,
              );
              expect(m.h2FontPx, `h2 ceiling at ${width}px`).toBeLessThanOrEqual(
                CONTRACTS.h2FontPxMax,
              );
            }

            // --- contract: fluid container padding within clamp bounds ---
            if (m.containerPadLeftPx != null) {
              expect(
                m.containerPadLeftPx,
                `container padding floor at ${width}px`,
              ).toBeGreaterThanOrEqual(CONTRACTS.containerPadPxMin);
              expect(
                m.containerPadLeftPx,
                `container padding ceiling at ${width}px`,
              ).toBeLessThanOrEqual(CONTRACTS.containerPadPxMax);
            }

            // --- contract: H1/H2/lead text never clipped without ellipsis ---
            expect(
              m.clipped,
              `${m.clipped.length} display text node(s) clipped at ${width}px`,
            ).toEqual([]);

            // --- soft assertion: tap-target height (soft-fail via console) ---
            if (m.tapUndersized.length > 0) {
              // eslint-disable-next-line no-console
              console.warn(
                `[${route.path} @ ${width}px] ${m.tapUndersized.length} tap target(s) < 36px:`,
                m.tapUndersized.slice(0, 3),
              );
            }
          } finally {
            await context.close();
          }
        });
      }
    });
  }
});
