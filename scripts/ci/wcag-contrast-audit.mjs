#!/usr/bin/env node
/**
 * WCAG AA contrast regression audit.
 *
 * Parses design tokens from src/styles.css for both light (:root) and dark
 * (.dark) themes, computes contrast ratios for every semantic foreground/
 * background pair a component actually paints, and fails with a non-zero
 * exit code on any AA violation.
 *
 * Ratios follow WCAG 2.1 SC 1.4.3:
 *   - Normal text:    ≥ 4.5:1
 *   - Large text/UI:  ≥ 3.0:1
 *
 * Translucent tokens (e.g. `hsl(... / 0.20)`) are composited over their
 * documented render background before being scored.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, "../../src/styles.css");

// ---------- HSL / composition ----------

function parseHsl(str) {
  // hsl(H S% L%)  |  hsl(H S% L% / A)
  const m = str.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  return {
    h: parseFloat(m[1]),
    s: parseFloat(m[2]) / 100,
    l: parseFloat(m[3]) / 100,
    a: m[4] === undefined ? 1 : parseFloat(m[4]),
  };
}

function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function composite(fg, bg) {
  const [fr, fg_, fb] = hslToRgb(fg);
  const [br, bg_, bb] = hslToRgb(bg);
  const a = fg.a;
  return [fr * a + br * (1 - a), fg_ * a + bg_ * (1 - a), fb * a + bb * (1 - a)];
}

function relLuminance([r, g, b]) {
  const conv = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * conv(r) + 0.7152 * conv(g) + 0.0722 * conv(b);
}

function contrast(fg, bg) {
  // fg / bg are HSL token objects; fg may be translucent → composite over bg.
  const fgRgb = fg.a < 1 ? composite(fg, bg) : hslToRgb(fg);
  const bgRgb = hslToRgb(bg);
  const l1 = relLuminance(fgRgb);
  const l2 = relLuminance(bgRgb);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- token extraction ----------

function extractTokens(css) {
  // Collect ALL declaration blocks matching `selector` and merge, so a token
  // redefined in a later refinement block wins — mirrors CSS cascade order.
  const grabAll = (selector) => {
    const escaped = selector.replace(/[.:[\]="]/g, "\\$&");
    const re = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "gm");
    const tokens = {};
    let m,
      hits = 0;
    while ((m = re.exec(css)) !== null) {
      hits++;
      for (const line of m[1].split("\n")) {
        const t = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*(hsl\([^;]*?\))\s*;/i);
        if (t) tokens[t[1]] = parseHsl(t[2]);
      }
    }
    if (hits === 0) throw new Error(`Missing ${selector} block in styles.css`);
    return tokens;
  };
  return {
    light: grabAll(":root"),
    dark: grabAll(".dark"),
    ios: grabAll('[data-theme="ios"]'),
  };
}

// ---------- pairs to audit ----------
// Each pair: [foregroundToken, backgroundToken, minRatio, label]
// Follow shadcn semantic conventions.
const PAIRS = [
  // Body text
  ["--foreground", "--background", 4.5, "body text"],
  ["--muted-foreground", "--background", 4.5, "muted text on canvas"],
  ["--card-foreground", "--card", 4.5, "text on card"],
  ["--popover-foreground", "--popover", 4.5, "text on popover"],
  ["--muted-foreground", "--card", 4.5, "muted text on card"],
  ["--muted-foreground", "--muted", 4.5, "muted text on muted"],

  // Fills
  ["--primary-foreground", "--primary", 4.5, "primary button label"],
  ["--secondary-foreground", "--secondary", 4.5, "secondary button label"],
  ["--accent-foreground", "--accent", 4.5, "accent hover label"],
  ["--destructive-foreground", "--destructive", 4.5, "destructive button label"],
  ["--success-foreground", "--success", 4.5, "success badge label"],
  ["--warning-foreground", "--warning", 4.5, "warning badge label"],
  ["--info-foreground", "--info", 4.5, "info badge label"],
  ["--adjustment-foreground", "--adjustment", 4.5, "adjustment badge label"],

  // Interaction (UI component contrast, SC 1.4.11)
  ["--ring", "--background", 3.0, "focus ring on canvas"],
  ["--ring", "--card", 3.0, "focus ring on card"],
  ["--primary", "--background", 3.0, "brand accent on canvas"],
  ["--primary", "--card", 3.0, "brand accent on card"],
  ["--destructive", "--background", 3.0, "destructive text on canvas"],
  ["--destructive", "--card", 3.0, "destructive text on card"],

  // Sidebar (fixed-dark navy in both modes)
  ["--sidebar-foreground", "--sidebar", 4.5, "sidebar label"],
  ["--sidebar-primary-foreground", "--sidebar-primary", 4.5, "sidebar active label"],
  [
    "--sidebar-accent-foreground",
    "--sidebar-accent",
    4.5,
    "sidebar active-row label (composited over --sidebar)",
  ],

  // ── Placeholder text, disabled controls, validation errors ─────
  // Added when we hardened the iOS theme's placeholder/disabled
  // inks — the same tokens now exist in :root and .dark. If ANY
  // theme regresses below AA on any pair below, CI fails.
  ["--input-placeholder", "--card", 4.5, "input placeholder on white/card"],
  ["--input-placeholder", "--input-disabled-bg", 4.5, "input placeholder on disabled surface"],
  ["--input-placeholder", "--background", 4.5, "input placeholder on page canvas"],
  ["--input-disabled-fg", "--input-disabled-bg", 4.5, "disabled input text on disabled surface"],
  ["--input-disabled-fg", "--card", 4.5, "disabled input text on card (nested)"],
  ["--control-disabled-fg", "--card", 4.5, "disabled control text on card"],
  ["--control-disabled-fg", "--background", 4.5, "disabled control text on canvas"],
  ["--control-disabled-fg", "--muted", 4.5, "disabled control text on muted surface"],
  // Validation error copy — the app remaps `.text-destructive` to
  // `--destructive-text` on `.dark` (see src/styles.css) so the fill
  // token can stay dark red for buttons while body-copy errors stay
  // AA on the darker surfaces. Audit that token directly against
  // every surface a form message ever renders on.
  ["--destructive-text", "--card", 4.5, "form error text on card"],
  ["--destructive-text", "--background", 4.5, "form error text on canvas"],
  ["--destructive-text", "--muted", 4.5, "form error text on muted surface"],
];

// ---------- non-text UI element pairs (WCAG 2.1 SC 1.4.11) ----------
// Icons, borders (component boundaries), input strokes, focus-ring
// strokes, separators, and sidebar dividers must meet 3.0:1 against
// their adjacent surface. These are AA REQUIREMENTS for non-text UI,
// distinct from the 4.5:1 body-text rule above.
const NON_TEXT_PAIRS = [
  // Iconography — icons that convey meaning ride on --muted-foreground
  // (lucide default) or --foreground. Audit them as graphical objects.
  ["--muted-foreground", "--background", 3.0, "icon (muted) on canvas"],
  ["--muted-foreground", "--card", 3.0, "icon (muted) on card"],
  ["--muted-foreground", "--popover", 3.0, "icon (muted) on popover"],
  ["--muted-foreground", "--muted", 3.0, "icon (muted) on muted surface"],
  ["--foreground", "--card", 3.0, "icon (default) on card"],

  // Component boundaries — cards, inputs, dividers, tables.
  ["--border", "--background", 3.0, "border on canvas"],
  ["--border", "--card", 3.0, "border on card (nested surfaces)"],
  ["--border", "--muted", 3.0, "border on muted surface"],
  ["--input", "--background", 3.0, "input stroke on canvas"],
  ["--input", "--card", 3.0, "input stroke on card"],

  // Focus-ring stroke — the ring itself as a graphical UI object.
  ["--ring", "--background", 3.0, "focus-ring stroke on canvas"],
  ["--ring", "--card", 3.0, "focus-ring stroke on card"],
  ["--ring", "--popover", 3.0, "focus-ring stroke on popover"],
  ["--ring", "--muted", 3.0, "focus-ring stroke on muted surface"],

  // Sidebar chrome — border/ring inside the persistent nav rail.
  ["--sidebar-border", "--sidebar", 3.0, "sidebar divider on sidebar surface"],
  ["--sidebar-ring", "--sidebar", 3.0, "sidebar focus-ring stroke on sidebar surface"],
  ["--sidebar-primary", "--sidebar", 3.0, "sidebar active-rail glyph on sidebar surface"],

  // State fills as graphical indicators (dot badges, chart strokes).
  ["--success", "--card", 3.0, "success indicator on card"],
  ["--warning", "--card", 3.0, "warning indicator on card"],
  ["--info", "--card", 3.0, "info indicator on card"],
  ["--destructive", "--card", 3.0, "destructive indicator on card"],
];

// ---------- interactive-state pairs (:hover, :active, :focus-visible) ----------
//
// Interactive states in src/styles.css compose colors via CSS color-mix()
// (e.g. `color-mix(in oklab, var(--accent) 55%, transparent)` then rendered
// over --background). We model each state as a computed pair so the audit
// scores what the user actually sees, not just raw tokens.

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function linearToSrgb(l) {
  const v = l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, v * 255));
}
function rgbOf(color) {
  return color._rgb ?? hslToRgb(color);
}
// Mix two colors in linear-light sRGB; `aFrac` is the weight of `a` (0..1).
// Alpha on either side is treated as pre-composited over `over` when supplied.
function mix(a, b, aFrac, over) {
  const ra = a.a !== undefined && a.a < 1 && over ? composite(a, over) : rgbOf(a);
  const rb = b.a !== undefined && b.a < 1 && over ? composite(b, over) : rgbOf(b);
  const out = [0, 1, 2].map((i) =>
    linearToSrgb(srgbToLinear(ra[i]) * aFrac + srgbToLinear(rb[i]) * (1 - aFrac)),
  );
  return { _rgb: out, a: 1 };
}
// Return an opaque form of `color` by compositing over `parent` if needed.
function solid(color, parent) {
  if (!color) return color;
  if (color.a === undefined || color.a >= 1) return color;
  if (!parent) return color;
  return { _rgb: composite(color, parent), a: 1 };
}

// Per-theme mix percentages mirror the actual CSS in src/styles.css so we
// score the pixel a user sees, not an assumed value. When a theme overrides
// the global rule, the override wins here too.
const STATE = {
  // table row hover
  rowHoverAccentPct: { light: 0.55, dark: null, ios: null },
  rowHoverRingPct: { light: null, dark: 0.08, ios: null }, // .dark overrides to ring@8%
  rowHoverIosBg: { ios: "--qb-row-hover" }, // iOS uses solid wash
  rowActiveIosBg: { ios: "--qb-row-active" },

  // dropdown / select item highlighted
  menuHighlightAccentPct: { light: 1.0, dark: 1.0, ios: 1.0 }, // fixed → solid accent

  // input hover border: mix(ring X%, border)
  inputHoverBorderPct: { light: 1.0, dark: 1.0, ios: 1.0 }, // solid ring

  // outer focus ring: mix(ring X%, transparent) over surface
  focusRingOuterPct: { light: 1.0, dark: 1.0, ios: 1.0 }, // fixed → solid ring

  // menu-item :focus-visible inset ring
  menuFocusInsetPct: { light: 1.0, dark: 1.0, ios: 1.0 }, // fixed → solid ring
};

function computedFor(themeName, tokens) {
  const T = themeName.startsWith("ios") ? "ios" : themeName;
  const pairs = [];

  // ----- :hover -----
  const rhAccent = STATE.rowHoverAccentPct[T];
  const rhRing = STATE.rowHoverRingPct[T];
  const rhIos = STATE.rowHoverIosBg[T];
  if (rhIos && tokens[rhIos]) {
    pairs.push({
      state: "hover",
      min: 4.5,
      label: `table row hover text (${rhIos})`,
      fg: tokens["--foreground"],
      bg: tokens[rhIos],
    });
  } else if (rhAccent != null) {
    pairs.push({
      state: "hover",
      min: 4.5,
      label: `table row hover text (accent@${(rhAccent * 100).toFixed(0)}% over canvas)`,
      fg: tokens["--foreground"],
      bg: mix(tokens["--accent"], tokens["--background"], rhAccent),
    });
  } else if (rhRing != null) {
    pairs.push({
      state: "hover",
      min: 4.5,
      label: `table row hover text (ring@${(rhRing * 100).toFixed(0)}% over canvas)`,
      fg: tokens["--foreground"],
      bg: mix(tokens["--ring"], tokens["--background"], rhRing),
    });
  }

  const mhPct = STATE.menuHighlightAccentPct[T];
  // --accent may be translucent (light theme is hsl(... / 0.08)) — the wash
  // is painted on --popover, so composite it over popover before scoring.
  const accentOnPopover = solid(tokens["--accent"], tokens["--popover"]);
  pairs.push({
    state: "hover",
    min: 4.5,
    label:
      mhPct >= 1
        ? "dropdown/select item highlighted label (solid accent on popover)"
        : `dropdown/select item highlighted label (accent@${(mhPct * 100).toFixed(0)}% over popover)`,
    fg: tokens["--accent-foreground"],
    bg:
      mhPct >= 1
        ? accentOnPopover
        : mix(tokens["--accent"], tokens["--popover"], mhPct, tokens["--popover"]),
  });

  const ihPct = STATE.inputHoverBorderPct[T];
  pairs.push({
    state: "hover",
    min: 3.0,
    label: `input hover border (ring@${(ihPct * 100).toFixed(0)}% + border) vs canvas`,
    fg: mix(tokens["--ring"], tokens["--border"], ihPct),
    bg: tokens["--background"],
  });
  pairs.push({
    state: "hover",
    min: 3.0,
    label: `input hover border vs card`,
    fg: mix(tokens["--ring"], tokens["--border"], ihPct),
    bg: tokens["--card"],
  });

  // ----- :active -----
  pairs.push({
    state: "active",
    min: 4.5,
    label: "primary button label at :active (same fill tokens)",
    fg: tokens["--primary-foreground"],
    bg: tokens["--primary"],
  });
  pairs.push({
    state: "active",
    min: 3.0,
    label: "sidebar rail active label (rail on sidebar surface)",
    fg: tokens["--sidebar-primary"],
    bg: tokens["--sidebar"],
  });
  const raIos = STATE.rowActiveIosBg[T];
  if (raIos && tokens[raIos]) {
    pairs.push({
      state: "active",
      min: 4.5,
      label: `table row active text (${raIos})`,
      fg: tokens["--foreground"],
      bg: tokens[raIos],
    });
  }

  // ----- :focus-visible -----
  const frPct = STATE.focusRingOuterPct[T];
  pairs.push({
    state: "focus-visible",
    min: 3.0,
    label:
      frPct >= 1
        ? "focus ring outline on canvas (solid ring)"
        : `focus ring outline on canvas (ring@${(frPct * 100).toFixed(0)}%)`,
    fg: frPct >= 1 ? tokens["--ring"] : mix(tokens["--ring"], tokens["--background"], frPct),
    bg: tokens["--background"],
  });
  pairs.push({
    state: "focus-visible",
    min: 3.0,
    label:
      frPct >= 1
        ? "focus ring outline on card (solid ring)"
        : `focus ring outline on card (ring@${(frPct * 100).toFixed(0)}%)`,
    fg: frPct >= 1 ? tokens["--ring"] : mix(tokens["--ring"], tokens["--card"], frPct),
    bg: tokens["--card"],
  });
  const mfPct = STATE.menuFocusInsetPct[T];
  const menuBg = accentOnPopover;
  pairs.push({
    state: "focus-visible",
    min: 3.0,
    label:
      mfPct >= 1
        ? "menu-item focus ring on accent surface (solid ring)"
        : `menu-item focus ring on accent surface (ring@${(mfPct * 100).toFixed(0)}%)`,
    fg: mfPct >= 1 ? tokens["--ring"] : mix(tokens["--ring"], menuBg, mfPct, menuBg),
    bg: menuBg,
  });

  return pairs;
}

// ---------- runner ----------

function opaqueEquivalent(color, base) {
  if (color.a >= 1) return color;
  const layered = composite(color, base);
  return { h: 0, s: 0, l: relLuminance(layered), a: 1, _rgb: layered };
}

function contrastAware(fg, bg) {
  const fgRgb = fg._rgb ?? (fg.a < 1 ? composite(fg, bg) : hslToRgb(fg));
  const bgRgb = bg._rgb ?? hslToRgb(bg);
  const l1 = relLuminance(fgRgb);
  const l2 = relLuminance(bgRgb);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function auditTheme(name, tokens) {
  const rows = [];
  const canvas = tokens["--background"];
  const sidebarCanvas = tokens["--sidebar"];
  const scoreList = (list, kind) => {
    for (const [fgKey, bgKey, min, label] of list) {
      const fg = tokens[fgKey];
      const bg = tokens[bgKey];
      if (!fg || !bg) {
        rows.push({
          fgKey,
          bgKey,
          ratio: null,
          min,
          label,
          state: "base",
          kind,
          missing: true,
          pass: false,
        });
        continue;
      }
      const parent = bgKey.startsWith("--sidebar") ? sidebarCanvas : canvas;
      const bgForCalc = opaqueEquivalent(bg, parent);
      const ratio = contrastAware(fg, bgForCalc);
      rows.push({
        fgKey,
        bgKey,
        ratio,
        min,
        label,
        state: "base",
        kind,
        missing: false,
        pass: ratio >= min,
      });
    }
  };
  scoreList(PAIRS, "text");
  scoreList(NON_TEXT_PAIRS, "non-text");

  const computed = computedFor(name, tokens);
  for (const p of computed) {
    const { fg, bg } = p;
    const kind = p.state === "focus-visible" || /border|ring/i.test(p.label) ? "non-text" : "text";
    if (!fg || !bg) {
      rows.push({
        fgKey: `(computed)`,
        bgKey: `(computed)`,
        ratio: null,
        min: p.min,
        label: p.label,
        state: p.state,
        kind,
        missing: true,
        pass: false,
      });
      continue;
    }
    const ratio = contrastAware(fg, bg);
    rows.push({
      fgKey: `(computed)`,
      bgKey: `(computed)`,
      ratio,
      min: p.min,
      label: p.label,
      state: p.state,
      kind,
      missing: false,
      pass: ratio >= p.min,
    });
  }
  return rows;
}

function fmt(n) {
  return n === null ? "  —  " : `${n.toFixed(2)}:1`.padStart(7);
}

const REPORT_DIR = path.resolve(__dirname, "../../reports/wcag");

function statusIcon(row) {
  if (row.missing) return "⚠️";
  return row.pass ? "✅" : "❌";
}

function toMarkdown(results) {
  const lines = [];
  lines.push("# WCAG AA Contrast Audit");
  lines.push("");
  lines.push(`_Generated: ${new Date().toISOString()}_`);
  lines.push("");
  lines.push(
    "Source: `src/styles.css`. Text pairs scored at SC 1.4.3 (≥4.5:1); non-text UI elements — icons, borders, input strokes, focus-ring strokes, separators — scored at SC 1.4.11 (≥3.0:1). Translucent colors are composited over their render background before scoring.",
  );
  lines.push("");
  for (const { name, rows } of results) {
    const fails = rows.filter((r) => !r.pass).length;
    const textRows = rows.filter((r) => r.kind === "text");
    const nonTextRows = rows.filter((r) => r.kind === "non-text");
    const nonTextFails = nonTextRows.filter((r) => !r.pass).length;
    lines.push(
      `## Theme: \`${name}\` — ${fails === 0 ? "✅ all pass" : `❌ ${fails} violation(s)`}`,
    );
    lines.push("");
    lines.push(
      `Text pairs: ${textRows.length} · Non-text UI pairs: ${nonTextRows.length} (${nonTextFails} violation(s))`,
    );
    lines.push("");
    lines.push("| Status | Kind | State | Foreground | Background | Ratio | Required | Pair |");
    lines.push("| :---: | :---: | :---: | --- | --- | ---: | ---: | --- |");
    for (const r of rows) {
      const ratio = r.ratio === null ? "—" : `${r.ratio.toFixed(2)}:1`;
      lines.push(
        `| ${statusIcon(r)} | ${r.kind} | ${r.state} | \`${r.fgKey}\` | \`${r.bgKey}\` | ${ratio} | ${r.min.toFixed(1)}:1 | ${r.label} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  if (!fs.existsSync(CSS_PATH)) {
    console.error(`Missing ${CSS_PATH}`);
    process.exit(2);
  }
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const { light, dark, ios } = extractTokens(css);

  const results = [
    { name: "light", rows: auditTheme("light", light) },
    { name: "dark", rows: auditTheme("dark", dark) },
    { name: "ios (dashboard)", rows: auditTheme("ios", ios) },
  ];

  // Console summary — full report table per theme.
  console.log("WCAG AA contrast audit — src/styles.css");
  console.log("=========================================");
  let total = 0;
  for (const { name, rows } of results) {
    const fails = rows.filter((r) => !r.pass);
    const nonText = rows.filter((r) => r.kind === "non-text");
    const nonTextFails = nonText.filter((r) => !r.pass).length;
    total += fails.length;
    console.log(
      `\n[${name}] ${rows.length} pair(s) checked (${nonText.length} non-text UI), ${fails.length} violation(s) (${nonTextFails} non-text)`,
    );
    for (const r of rows) {
      const tag = r.missing ? "MISS" : r.pass ? "PASS" : "FAIL";
      const kind = (r.kind ?? "text").padEnd(8);
      console.log(
        `  ${tag} [${kind}] [${r.state.padEnd(13)}] ${fmt(r.ratio)} (min ${r.min.toFixed(1)}:1)  ${r.label}`,
      );
    }
  }

  // Emit report artifacts (Markdown + JSON) for CI upload.
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, "contrast-report.json");
  const mdPath = path.join(REPORT_DIR, "contrast-report.md");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "src/styles.css",
        themes: results.map(({ name, rows }) => ({
          name,
          checked: rows.length,
          violations: rows.filter((r) => !r.pass).length,
          text: {
            checked: rows.filter((r) => r.kind === "text").length,
            violations: rows.filter((r) => r.kind === "text" && !r.pass).length,
          },
          nonText: {
            checked: rows.filter((r) => r.kind === "non-text").length,
            violations: rows.filter((r) => r.kind === "non-text" && !r.pass).length,
          },
          rows,
        })),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(mdPath, toMarkdown(results));
  console.log(
    `\nReport written:\n  ${path.relative(process.cwd(), mdPath)}\n  ${path.relative(process.cwd(), jsonPath)}`,
  );

  // GitHub Actions job summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, toMarkdown(results) + "\n");
  }

  if (total === 0) {
    console.log("\n✓ All token pairs pass AA across light, dark, and ios themes.");
    process.exit(0);
  }
  console.error(
    `\n✗ ${total} contrast violation(s). Update src/styles.css tokens; do NOT weaken this audit.`,
  );
  process.exit(1);
}

main();
