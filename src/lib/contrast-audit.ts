/**
 * WCAG 2.1 contrast helpers scoped to what the chart-preview page audits:
 * tooltip body, legend text, and axis tick labels.
 *
 * Reads live-computed CSS variables from a DOM node so the same helper works
 * in both light and dark ThemedPanels (they set their own token stack via
 * the `.dark` class flip).
 */

type RGB = [number, number, number];

function srgb(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: RGB): number {
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
export function contrastRatio(a: RGB, b: RGB): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Composite a translucent color over an opaque background. */
export function compositeOver(fg: RGB, alpha: number, bg: RGB): RGB {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
  ];
}

/** Parse rgb()/rgba()/hsl()/hsla() strings returned by getComputedStyle. */
export function parseColor(input: string): { rgb: RGB; a: number } | null {
  const s = input.trim();
  if (!s) return null;

  // rgb(a) — browsers normalize CSS colors to this form via getComputedStyle,
  // but we still accept both comma and space syntax to be safe.
  let m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    const r = +parts[0],
      g = +parts[1],
      b = +parts[2];
    const a = parts[3] != null ? +parts[3] : 1;
    if ([r, g, b].every((n) => !isNaN(n))) return { rgb: [r, g, b], a };
  }

  // hsl(a) — used when reading raw --token values.
  m = s.match(/^hsla?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    const h = parseFloat(parts[0]);
    const sat = parseFloat(parts[1]) / 100;
    const lig = parseFloat(parts[2]) / 100;
    const a = parts[3] != null ? parseFloat(parts[3]) : 1;
    const k = (n: number) => (n + h / 30) % 12;
    const aa = sat * Math.min(lig, 1 - lig);
    const f = (n: number) => lig - aa * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return {
      rgb: [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)],
      a,
    };
  }

  return null;
}

/** Read `--tokenName` from a DOM element and return the composited RGB
 *  when the token is translucent (uses `bgFallback` as the render canvas). */
export function readToken(el: Element, name: string, bgFallback: RGB): RGB | null {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const parsed = parseColor(raw);
  if (!parsed) return null;
  return parsed.a < 1 ? compositeOver(parsed.rgb, parsed.a, bgFallback) : parsed.rgb;
}

export type ContrastCheck = {
  label: string;
  ratio: number;
  required: number; // 4.5 body, 3.0 large / non-text
  ok: boolean;
  fg: string;
  bg: string;
};

/**
 * Run the chart-preview contrast audit against a container. Uses the
 * container's computed tokens so it works in either theme.
 */
export function auditChartContrast(container: HTMLElement): ContrastCheck[] {
  const canvas = readToken(container, "--background", [255, 255, 255]);
  const card = readToken(container, "--card", canvas ?? [255, 255, 255]);
  const popoverBg = readToken(container, "--popover", canvas ?? [255, 255, 255]);
  if (!canvas || !card || !popoverBg) return [];

  const popoverFg = readToken(container, "--popover-foreground", popoverBg);
  const mutedFgOnPopover = readToken(container, "--muted-foreground", popoverBg);
  const foreground = readToken(container, "--foreground", canvas);
  const mutedFgOnCanvas = readToken(container, "--muted-foreground", card);

  const checks: ContrastCheck[] = [];
  const push = (label: string, fg: RGB | null, bg: RGB | null, required = 4.5) => {
    if (!fg || !bg) return;
    const ratio = contrastRatio(fg, bg);
    checks.push({
      label,
      ratio,
      required,
      ok: ratio >= required,
      fg: `rgb(${fg.join(",")})`,
      bg: `rgb(${bg.join(",")})`,
    });
  };

  push("Tooltip · value text on popover", popoverFg, popoverBg, 4.5);
  push("Tooltip · muted label on popover", mutedFgOnPopover, popoverBg, 4.5);
  push("Legend · label text on card", foreground, card, 4.5);
  push("Axis · tick label on card", mutedFgOnCanvas, card, 4.5);

  return checks;
}
