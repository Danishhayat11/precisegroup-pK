import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";

/**
 * /site marketing — theme-contrast regression check.
 *
 * A focused, lightweight guard against future token regressions in the
 * marketing shell. For every /site* route:
 *
 *   1. Renders the page once in `.light` and once in `.dark`.
 *   2. Samples every interactive element (a, button, [role="button"],
 *      input, textarea, select) plus the CTA-adjacent overlay text
 *      (.eyebrow, .caption, .lead) and asserts:
 *        · WCAG 2.1 AA contrast (4.5 normal, 3.0 large) in BOTH themes.
 *        · The effective background of chrome surfaces (header nav,
 *          body canvas, primary CTA) actually SHIFTS between themes —
 *          proves the token is wired, not a stuck hex literal.
 *   3. Captures light + dark full-page shots side by side to
 *      test-results/site-theme/<route>-{light,dark}.png for visual diff.
 *
 * Run:
 *   bunx playwright test tests/visual/site-theme-contrast.spec.ts
 *   bun run test:visual:site-theme
 */

const ROUTES = [
  { path: "/site", name: "site" },
  { path: "/site/services", name: "site-services" },
  { path: "/site/projects", name: "site-projects" },
  { path: "/site/contact", name: "site-contact" },
] as const;

const VIEWPORT = { width: 1280, height: 900 } as const;

const CONTRAST_MARGIN = 0.05;

// Chrome surfaces whose background must differ between themes. These are
// the ONLY selectors we require to swap — brand accents (emerald/gold)
// are intentionally shared across themes and are excluded.
const CHROME_SURFACES = ["body", "header", "footer"] as const;

// Minimum perceptual delta between light-theme and dark-theme background
// for a chrome surface. Chosen to catch a stuck hex literal (delta ~0)
// while tolerating tiny alpha/blend drift.
const MIN_THEME_DELTA = 40;

async function applyTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript(
    ({ theme }) => {
      try {
        localStorage.setItem("theme", theme);
        localStorage.setItem("vite-ui-theme", theme);
        localStorage.setItem("color-scheme", theme);
      } catch {
        /* storage unavailable */
      }
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(theme);
      root.style.colorScheme = theme;
    },
    { theme },
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

function audit() {
  return /* js */ `
    (() => {
      const parseColor = (str) => {
        const m = str && str.match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const parts = m[1].split(',').map(s => parseFloat(s.trim()));
        return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
      };
      const srgbToLin = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const luminance = ({ r, g, b }) =>
        0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
      const contrast = (fg, bg) => {
        const L1 = luminance(fg), L2 = luminance(bg);
        const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
        return (hi + 0.05) / (lo + 0.05);
      };
      const blend = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      });
      const effectiveBg = (el) => {
        const stack = [];
        let cur = el, root = null;
        while (cur && cur !== document.documentElement) {
          const cs = getComputedStyle(cur);
          const bg = parseColor(cs.backgroundColor);
          if (bg && bg.a > 0) {
            stack.push(bg);
            if (bg.a >= 0.999) { root = bg; break; }
          }
          cur = cur.parentElement;
        }
        if (!root) {
          const b = parseColor(getComputedStyle(document.body).backgroundColor);
          root = (b && b.a >= 0.999) ? b : { r: 255, g: 255, b: 255, a: 1 };
        }
        let acc = root;
        for (let i = stack.length - 1; i >= 0; i--) acc = blend(stack[i], acc);
        return acc;
      };
      const isLarge = (fontPx, w) =>
        fontPx >= 24 || (fontPx >= 18.66 && w >= 700);

      // Interactive + CTA-adjacent selectors.
      const selectors = [
        'a', 'button', '[role="button"]',
        'input:not([type="hidden"])', 'textarea', 'select',
        '.eyebrow', '.caption', '.lead',
      ];
      const seen = new Set();
      const nodes = [];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (seen.has(el)) continue;
          seen.add(el);
          nodes.push({ sel, el });
        }
      }

      // Overlay text sitting on an <img> or CSS background-image has no
      // resolvable opaque background color — the visual bg is a raster.
      // We can't evaluate contrast token-side, so we collect a candidate
      // record and let the Node-side test sample the actual pixels behind
      // the element (see FROSTED SAMPLING PASS below).
      const hasImageBackdrop = (el) => {
        let cur = el;
        while (cur && cur !== document.body) {
          const cs = getComputedStyle(cur);
          if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
          const parent = cur.parentElement;
          if (parent && parent.querySelector(':scope > img')) {
            const imgCs = getComputedStyle(parent.querySelector(':scope > img'));
            if (imgCs.position === 'absolute' || imgCs.position === 'fixed') return true;
          }
          cur = cur.parentElement;
        }
        return false;
      };

      // Assign a stable data attribute so the Node side can locate the
      // exact node when it needs to hide-and-clip-screenshot it.
      const stamp = (el) => {
        let id = el.getAttribute('data-contrast-id');
        if (!id) {
          id = 'c' + Math.random().toString(36).slice(2, 10);
          el.setAttribute('data-contrast-id', id);
        }
        return id;
      };

      const findings = [];
      const frosted = [];
      let inspected = 0;
      for (const { sel, el } of nodes) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (parseFloat(cs.opacity) === 0) continue;
        const text = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
        if (!text) continue;
        const fg = parseColor(cs.color);
        if (!fg) continue;
        const fontPx = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const large = isLarge(fontPx, weight);
        const threshold = large ? 3.0 : 4.5;

        if (hasImageBackdrop(el)) {
          // Defer to the sampling pass. Record own bg (may be semi-transparent
          // frosted glass) so we can blend it over the sampled backdrop.
          const ownBg = parseColor(cs.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 };
          frosted.push({
            id: stamp(el),
            selector: sel,
            text: text.slice(0, 50),
            fg: { r: fg.r, g: fg.g, b: fg.b, a: fg.a },
            ownBg,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            fontPx: +fontPx.toFixed(1),
            threshold,
          });
          continue;
        }

        const bg = effectiveBg(el);
        const ratio = contrast(fg, bg);
        inspected++;
        if (ratio + ${CONTRAST_MARGIN} < threshold) {
          findings.push({
            selector: sel,
            text: text.slice(0, 50),
            fg: 'rgb(' + Math.round(fg.r) + ',' + Math.round(fg.g) + ',' + Math.round(fg.b) + ')',
            bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
            fontPx: +fontPx.toFixed(1),
            ratio: +ratio.toFixed(2),
            threshold,
          });
          if (findings.length >= 15) break;
        }
      }

      // Sample chrome surface backgrounds so we can prove they shift
      // between themes. Returns { body, header, footer } opaque RGB.
      const chrome = {};
      for (const sel of ${JSON.stringify(CHROME_SURFACES)}) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const bg = effectiveBg(el);
        chrome[sel] = [Math.round(bg.r), Math.round(bg.g), Math.round(bg.b)];
      }

      return {
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        inspected,
        findings,
        chrome,
        frosted,
      };
    })()
  `;
}

type Rgb = { r: number; g: number; b: number; a?: number };
type FrostedCandidate = {
  id: string;
  selector: string;
  text: string;
  fg: Rgb & { a: number };
  ownBg: Rgb & { a: number };
  rect: { x: number; y: number; width: number; height: number };
  fontPx: number;
  threshold: number;
};
type Finding = {
  selector: string;
  text: string;
  fg: string;
  bg: string;
  fontPx: number;
  ratio: number;
  threshold: number;
};

function srgbLin(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function lum({ r, g, b }: Rgb) {
  return 0.2126 * srgbLin(r) + 0.7152 * srgbLin(g) + 0.0722 * srgbLin(b);
}
function contrast(a: Rgb, b: Rgb) {
  const L1 = lum(a),
    L2 = lum(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function blend(fg: Rgb & { a: number }, bg: Rgb): Rgb {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
}

/**
 * FROSTED SAMPLING PASS.
 *
 * For each frosted-over-image candidate, temporarily hide the node so the
 * raster backdrop is unobstructed, take a clip screenshot of the node's
 * rect, and average the pixels. That average is the effective backdrop
 * color the browser blurs and blends behind the pill. We then blend the
 * pill's own (semi-transparent) `background-color` on top and compute
 * contrast against the resolved fg. This replaces the previous "skip
 * anything over an image" branch that let hero CTAs and image-badge
 * chips slip past AA.
 *
 * `backdrop-filter: blur` shifts hue only marginally on natural photos,
 * so the un-blurred average is a faithful proxy for the blurred surface
 * (WCAG contrast operates on solid colors — it has no blur model).
 */
async function sampleFrosted(page: Page, cands: FrostedCandidate[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const c of cands) {
    const sel = `[data-contrast-id="${c.id}"]`;
    // Hide via visibility so layout — and therefore rect — is preserved.
    await page.$eval(sel, (el) => {
      (el as HTMLElement).style.visibility = "hidden";
    });
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
    const clip = {
      x: Math.max(0, Math.floor(c.rect.x)),
      y: Math.max(0, Math.floor(c.rect.y)),
      width: Math.max(1, Math.floor(c.rect.width)),
      height: Math.max(1, Math.floor(c.rect.height)),
    };
    let buf: Buffer;
    try {
      buf = await page.screenshot({ clip, animations: "disabled", scale: "css" });
    } finally {
      await page.$eval(sel, (el) => {
        (el as HTMLElement).style.visibility = "";
      });
    }
    const png = PNG.sync.read(buf);
    // Average opaque RGB across the clip.
    let R = 0,
      G = 0,
      B = 0,
      n = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const a = png.data[i + 3];
      if (a < 250) continue;
      R += png.data[i];
      G += png.data[i + 1];
      B += png.data[i + 2];
      n++;
    }
    if (!n) continue;
    const sampled: Rgb = { r: R / n, g: G / n, b: B / n };
    const eff = blend(c.ownBg, sampled);
    const ratio = contrast(c.fg, eff);
    void dpr; // scale:'css' keeps clip in CSS px regardless of dpr
    if (ratio + CONTRAST_MARGIN < c.threshold) {
      findings.push({
        selector: c.selector,
        text: c.text + " [frosted]",
        fg: `rgb(${Math.round(c.fg.r)},${Math.round(c.fg.g)},${Math.round(c.fg.b)})`,
        bg: `rgb(${Math.round(eff.r)},${Math.round(eff.g)},${Math.round(eff.b)})`,
        fontPx: c.fontPx,
        ratio: +ratio.toFixed(2),
        threshold: c.threshold,
      });
    }
  }
  return findings;
}

async function auditAt(
  page: Page,
  theme: "light" | "dark",
  route: { path: string; name: string },
  shotDir: string,
) {
  await applyTheme(page, theme);
  const resp = await page.goto(route.path, { waitUntil: "networkidle" });
  expect(resp?.ok(), `HTTP for ${route.path} (${theme})`).toBe(true);
  await page.evaluate(
    ({ theme }) => {
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(theme);
    },
    { theme },
  );
  await page.evaluate(
    () => (document.fonts?.ready as unknown as Promise<unknown>) ?? Promise.resolve(),
  );
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shotDir, `${route.name}-${theme}.png`), fullPage: true });
  const result = (await page.evaluate(audit())) as {
    theme: string;
    inspected: number;
    findings: Finding[];
    chrome: Record<string, [number, number, number] | undefined>;
    frosted: FrostedCandidate[];
  };
  expect(result.theme, `${theme} class survived hydration`).toBe(theme);
  expect(
    result.inspected,
    `inspected at least one interactive node at ${route.path} (${theme})`,
  ).toBeGreaterThan(0);

  // Sample frosted-over-image candidates and merge their failures.
  const frostedFindings = await sampleFrosted(page, result.frosted);
  return {
    ...result,
    findings: [...result.findings, ...frostedFindings],
    frostedCount: result.frosted.length,
  };
}

test.describe("/site theme-contrast regression", () => {
  test.beforeAll(async () => {
    await mkdir(join(process.cwd(), "test-results", "site-theme"), { recursive: true });
  });

  for (const route of ROUTES) {
    test(`${route.path} passes AA in light + dark and chrome shifts`, async ({ browser }) => {
      const shotDir = join(process.cwd(), "test-results", "site-theme");

      // Light pass — fresh context so no cookies/storage bleed between themes.
      const lightCtx = await browser.newContext({
        viewport: VIEWPORT,
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      const lightPage = await lightCtx.newPage();
      const light = await auditAt(lightPage, "light", route, shotDir);
      await lightCtx.close();

      // Dark pass.
      const darkCtx = await browser.newContext({
        viewport: VIEWPORT,
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      const darkPage = await darkCtx.newPage();
      const dark = await auditAt(darkPage, "dark", route, shotDir);
      await darkCtx.close();

      // 1) WCAG AA in both themes.
      expect(
        light.findings,
        `light-mode contrast failures on ${route.path}:\n` +
          JSON.stringify(light.findings, null, 2),
      ).toEqual([]);
      expect(
        dark.findings,
        `dark-mode contrast failures on ${route.path}:\n` + JSON.stringify(dark.findings, null, 2),
      ).toEqual([]);

      // 1b) Prove the frosted-sampling pass actually ran. The `/site` home
      //     ships the hero's frosted secondary CTA (<a> with backdrop-blur
      //     over the hero image) — that anchor is in the selector set and
      //     is a reliable canary. A regression where hasImageBackdrop
      //     stops detecting the raster backdrop would drop candidates to
      //     zero and let the pill go unchecked again.
      if (route.path === "/site") {
        expect(
          light.frostedCount,
          `expected frosted-over-image candidates on ${route.path} (light) — sampling pass may be idle`,
        ).toBeGreaterThan(0);
        expect(dark.frostedCount, `same on ${route.path} (dark)`).toBeGreaterThan(0);
      }

      // 2) Chrome surfaces MUST shift between themes. A stuck hex literal
      //    (regression) would show identical RGB across themes.
      for (const sel of CHROME_SURFACES) {
        const l = light.chrome[sel];
        const d = dark.chrome[sel];
        if (!l || !d) continue; // surface missing on this route
        const delta = Math.abs(l[0] - d[0]) + Math.abs(l[1] - d[1]) + Math.abs(l[2] - d[2]);
        expect(
          delta,
          `${sel} background did not shift between themes on ${route.path} — ` +
            `light=rgb(${l.join(",")}) dark=rgb(${d.join(",")}) delta=${delta}. ` +
            `This usually means a hardcoded hex bypassed the token layer.`,
        ).toBeGreaterThanOrEqual(MIN_THEME_DELTA);
      }
    });
  }
});
