/**
 * Contrast regression audit for the iOS theme.
 *
 * WCAG 2.2 Success Criterion 1.4.3 (Contrast Minimum) requires a
 * ratio of at least 4.5:1 for normal text and 3:1 for large text.
 * Placeholder text, disabled controls, and validation error copy
 * ALL carry semantic meaning (what's expected, what's off, what's
 * wrong), so we hold them to the 4.5:1 floor even though disabled
 * UI is technically exempt under 1.4.3.
 *
 * The pairs below mirror the exact tokens defined in
 * `src/styles.css` under `[data-theme="ios"]`. If a value drifts
 * without re-running this audit, the test fails so the reviewer
 * has to consciously loosen the floor rather than shipping a
 * silent regression.
 */
import { describe, it, expect } from "vitest";

/* ─── WCAG helpers (dependency-free) ─────────────────────────────── */

type RGB = readonly [number, number, number];

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [l1, l2] = la > lb ? [la, lb] : [lb, la];
  return (l1 + 0.05) / (l2 + 0.05);
}
function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ] as const;
}
function hslToRgb(h: number, s: number, l: number): RGB {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1]: [number, number, number] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = L - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ] as const;
}
/** Approximate `color-mix(in oklab, X A%, transparent)` composited
 *  over an opaque bg — accurate enough for the audit (perceptual
 *  vs alpha blend diverge by < 0.1:1 in practice for greys). */
function overOpaque(fg: RGB, bg: RGB, alpha: number): RGB {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
  ] as const;
}

/* ─── Token values pinned to src/styles.css ──────────────────────── */

// Surfaces
const CARD = hexToRgb("#FFFFFF");
const BACKGROUND = hslToRgb(240, 6, 97); // --background
const INPUT_DISABLED_BG = hslToRgb(240, 6, 96); // --input-disabled-bg → #F4F4F7
const STATUS_DANGER_BG = hslToRgb(4, 100, 95); // --status-danger-bg → #FFE5E3

// Inks
const INPUT_PLACEHOLDER = hslToRgb(240, 3, 44); // --input-placeholder → #6D6D74
const INPUT_DISABLED_FG = hslToRgb(240, 4, 42); // --input-disabled-fg → #686870
const CONTROL_DISABLED_FG = hslToRgb(240, 4, 42); // --control-disabled-fg
const MUTED_FG = hslToRgb(240, 3, 43); // --muted-foreground
const DESTRUCTIVE = hslToRgb(4, 78, 42); // --destructive
const STATUS_DANGER_FG = hslToRgb(4, 74, 40); // --status-danger-fg

/* ─── Audit ─────────────────────────────────────────────────────── */

/** WCAG AA floor for normal text. Small text needs 4.5:1; large text
 *  needs 3:1. Every entry below is normal text, so 4.5 applies. */
const AA_FLOOR = 4.5;

interface Pair {
  name: string;
  fg: RGB;
  bg: RGB;
  min?: number; // per-pair override; defaults to AA_FLOOR
}

const PAIRS: Pair[] = [
  // ── Placeholder text ────────────────────────────────────────────
  { name: "input::placeholder on white input", fg: INPUT_PLACEHOLDER, bg: CARD },
  { name: "input::placeholder on #F4F4F7 disabled", fg: INPUT_PLACEHOLDER, bg: INPUT_DISABLED_BG },
  { name: "cmdk placeholder on white input", fg: INPUT_PLACEHOLDER, bg: CARD },

  // ── Disabled controls ───────────────────────────────────────────
  { name: "input:disabled text on #F4F4F7", fg: INPUT_DISABLED_FG, bg: INPUT_DISABLED_BG },
  { name: "input:disabled text on white (nested)", fg: INPUT_DISABLED_FG, bg: CARD },
  { name: ":disabled ink on white card", fg: CONTROL_DISABLED_FG, bg: CARD },
  { name: ":disabled ink on #F2F2F7 page bg", fg: CONTROL_DISABLED_FG, bg: BACKGROUND },
  { name: ":disabled ink on #F4F4F7 muted", fg: CONTROL_DISABLED_FG, bg: INPUT_DISABLED_BG },

  // ── Validation error copy ───────────────────────────────────────
  { name: "text-destructive on white card", fg: DESTRUCTIVE, bg: CARD },
  { name: "text-destructive on #F2F2F7 page bg", fg: DESTRUCTIVE, bg: BACKGROUND },
  { name: "text-destructive on #F4F4F7 disabled", fg: DESTRUCTIVE, bg: INPUT_DISABLED_BG },
  { name: "status-danger-fg on status-danger-bg", fg: STATUS_DANGER_FG, bg: STATUS_DANGER_BG },
  // FormMessage frequently sits under an input with a light-red wash;
  // approximate that wash as destructive @ 12% over white (bg-destructive/12).
  {
    name: "text-destructive on bg-destructive/12 wash",
    fg: DESTRUCTIVE,
    bg: overOpaque(DESTRUCTIVE, CARD, 0.12),
    min: 4.5,
  },

  // ── Sanity anchors (should stay comfortably AA/AAA) ─────────────
  { name: "muted-foreground on white", fg: MUTED_FG, bg: CARD },
];

describe("iOS theme — contrast audit", () => {
  it.each(PAIRS)("$name meets WCAG AA (>= 4.5:1)", ({ name, fg, bg, min }) => {
    const ratio = contrastRatio(fg, bg);
    const floor = min ?? AA_FLOOR;
    // Include the computed ratio in the failure message so a
    // reviewer sees exactly how far a regression drifted.
    expect(
      ratio,
      `${name}: ${ratio.toFixed(2)}:1 (floor ${floor}:1) fg=${fg.join(",")} bg=${bg.join(",")}`,
    ).toBeGreaterThanOrEqual(floor);
  });

  it("blocks re-introducing the previous #A1A1A6 placeholder", () => {
    // Regression trap: the old placeholder was #A1A1A6 → 2.57:1 on
    // white. If anyone reverts, this test catches it independently
    // of the parameterised suite above (which reads the fixed token).
    const previous = hexToRgb("#A1A1A6");
    const ratio = contrastRatio(previous, CARD);
    expect(ratio).toBeLessThan(3); // proves the check is calibrated
    // ...and the current token is meaningfully better.
    expect(contrastRatio(INPUT_PLACEHOLDER, CARD)).toBeGreaterThan(ratio + 2);
  });

  it("blocks re-introducing the previous #8E8E93 @ 0.85 disabled ink", () => {
    const previous = overOpaque(hexToRgb("#8E8E93"), CARD, 0.85);
    const ratio = contrastRatio(previous, CARD);
    expect(ratio).toBeLessThan(3);
    expect(contrastRatio(CONTROL_DISABLED_FG, CARD)).toBeGreaterThan(ratio + 2);
  });
});
