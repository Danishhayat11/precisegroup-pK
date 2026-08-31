/**
 * ESLint rule: no-raw-color
 *
 * Flags hard-coded colors — hex literals or non-semantic Tailwind palette
 * utilities — in source files. Applied per-file via the ESLint flat config's
 * `files` / `ignores` globs (see eslint.config.js), so protected directories
 * (marketing, shell, authenticated dashboard/admin) enforce the rule and
 * allowlisted paths (print, error pages, DashboardHero, tests) skip it.
 *
 * Companion to scripts/ci/no-hex-in-marketing-shell.mjs: the CI script is the
 * source of truth in CI; this rule surfaces the same violations in-editor and
 * in `bun run lint`, so contributors get feedback before pushing.
 *
 * Escape hatches (must match the CI script exactly):
 *   - `// allow-raw-color: <reason>`  (or legacy `// allow-hex: <reason>`)
 *     on the same line or the immediately preceding line
 *   - `/* allow-raw-color-file: <reason> *\/` anywhere in the file
 *     (silences ALL raw-color rules for the whole file)
 */

const COLOR_PREFIXES =
  "bg|text|border|from|to|via|ring|fill|stroke|shadow|outline|decoration|divide|placeholder|caret|accent|ring-offset";

const UTILITY_HEX = new RegExp(
  `\\b(?:${COLOR_PREFIXES})-\\[#[0-9a-fA-F]{3,8}(?:\\/[0-9]{1,3})?\\]`,
  "g",
);
const BARE_HEX = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/g;

const PALETTE_NAMES = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];
const PALETTE_UTIL = new RegExp(
  `(?<![\\w-])(?:${COLOR_PREFIXES})-(?:${PALETTE_NAMES.join("|")})-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\\/[0-9]{1,3})?\\b`,
  "g",
);
const BW_UTIL = new RegExp(
  `(?<![\\w-])(?:${COLOR_PREFIXES})-(?:white|black)(?:\\/[0-9]{1,3})?\\b`,
  "g",
);

const ALLOW_LINE = /allow-(?:hex|raw-color)\b/;
const ALLOW_FILE = /allow-raw-color-file\s*:\s*\S/;

const RULES = [
  { rx: UTILITY_HEX, kind: "arbitrary-hex utility" },
  { rx: BARE_HEX, kind: "bare hex literal" },
  { rx: PALETTE_UTIL, kind: "non-semantic palette utility" },
  { rx: BW_UTIL, kind: "raw black/white utility" },
];

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hard-coded colors (hex literals, non-semantic Tailwind palette utilities) in protected surfaces. Use semantic tokens from src/styles.css (@theme) instead.",
    },
    schema: [],
    messages: {
      rawColor:
        "Hard-coded color '{{match}}' ({{kind}}). Use a semantic token from src/styles.css (@theme) — e.g. bg-background, text-foreground, text-muted-foreground, border-border, bg-card, bg-success, bg-warning, bg-destructive, bg-info. If a raw color is genuinely required, append `// allow-raw-color: <reason>` on the same line, or `/* allow-raw-color-file: <reason> */` at the top of the file.",
    },
  },
  create(context) {
    const source = context.getSourceCode();
    const fullText = source.getText();
    // Whole-file opt-out (must include a non-empty reason).
    if (ALLOW_FILE.test(fullText)) return {};

    const lines = fullText.split("\n");

    /**
     * Report every raw-color match inside `value`, anchoring the ESLint report
     * to `node` for editor squiggles. Skips the match when the containing line
     * (or the preceding line — for multi-line JSX where the class lives on its
     * own attribute line) carries the same-line allow marker.
     */
    function scan(value, node) {
      if (typeof value !== "string" || value.length === 0) return;

      // Fast-path: no hex / no hyphen means no possible utility match.
      if (!value.includes("#") && !value.includes("-")) return;

      for (const { rx, kind } of RULES) {
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(value))) {
          // Locate the match's line by walking node.loc + the offset within
          // `value`. For string literals value === node text (minus quotes),
          // so the node's start line is close enough — allow-line checks look
          // at both the node's start line and the line above.
          const lineIdx = node.loc?.start?.line ? node.loc.start.line - 1 : 0;
          const line = lines[lineIdx] ?? "";
          const prev = lineIdx > 0 ? lines[lineIdx - 1] : "";
          if (ALLOW_LINE.test(line) || ALLOW_LINE.test(prev)) continue;

          context.report({
            node,
            messageId: "rawColor",
            data: { match: m[0], kind },
          });
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") scan(node.value, node);
      },
      TemplateElement(node) {
        // Template literal chunk: node.value.cooked is the string content.
        if (node.value && typeof node.value.cooked === "string") {
          scan(node.value.cooked, node);
        }
      },
      JSXAttribute(node) {
        // Catches class-like string literals directly on JSX attributes,
        // e.g. <div className="bg-slate-500" />. `Literal` above also
        // catches this, but scanning attribute nodes gives better error
        // ranges for editor UIs.
        const v = node.value;
        if (v && v.type === "Literal" && typeof v.value === "string") {
          scan(v.value, v);
        }
      },
    };
  },
};

export default {
  rules: {
    "no-raw-color": rule,
  },
};
