// Central config for the color guardrail
// (scripts/ci/no-hex-in-marketing-shell.mjs).
//
// Edit THIS file — not the script — when adding a new page or surface that
// needs an exception. Every entry requires a `reason` so drift stays
// auditable in `git blame`, and the guardrail echoes reasons in its
// diagnostics output.
//
// Two exception mechanisms live here:
//
//   1. `excludePaths` — path-based skip. The file is not scanned at all.
//      Use for surfaces where raw colors are inherent (print stylesheets,
//      letterhead, error pages rendered before providers, hero photography
//      backdrops, test fixtures). The bar is high — see CONTRIBUTING.md.
//
//   2. `allowlist` — path-scoped rule silencing. The file IS scanned but
//      the listed rules (R1 arbitrary-hex, R2 bare hex, R3 palette utility,
//      R4 raw black/white) are silenced for matching files. Use for pages
//      that need to keep, say, brand gradient hex stops without sprinkling
//      per-line markers across every file.
//
// Both entries accept `pattern` as a RegExp OR a string (matched with
// String#startsWith against the POSIX-style repo-relative path). RegExp is
// preferred for anchored, precise matches.
//
// Rule IDs: R1 = arbitrary-hex utility, R2 = bare hex literal,
//           R3 = non-semantic palette utility, R4 = raw black/white utility.

/** @typedef {"R1"|"R2"|"R3"|"R4"} RuleId */
/**
 * @typedef {Object} ExcludeEntry
 * @property {RegExp|string} pattern
 * @property {string} category
 * @property {string} reason
 */
/**
 * @typedef {Object} AllowlistEntry
 * @property {RegExp|string} pattern
 * @property {RuleId[]|"*"} rules
 * @property {string} reason
 */

/** @type {ExcludeEntry[]} */
export const excludePaths = [
  // Print / letterhead — raw print CSS colors are the point; CSS variables
  // do not survive PDF/print rendering pipelines.
  {
    pattern: /^src\/pages\/DocumentView\.tsx$/,
    category: "Print / letterhead",
    reason: "letterhead-rendered documents use fixed print colors",
  },
  {
    pattern: /^src\/components\/print\//,
    category: "Print / letterhead",
    reason: "print sub-components target the PDF pipeline",
  },
  {
    pattern:
      /^src\/components\/(PrintPreviewModal|PaymentReceipt|PaymentHistoryDoc|BookingDocumentEditor)\.tsx$/,
    category: "Print / letterhead",
    reason: "receipt/preview surfaces mirror print output",
  },
  {
    pattern: /^src\/lib\/letterhead\.tsx$/,
    category: "Print / letterhead",
    reason: "letterhead template is fixed-brand",
  },

  // Error surfaces — render before providers/theme are mounted, so semantic
  // tokens are not yet available.
  {
    pattern: /^src\/pages\/NotFound\.tsx$/,
    category: "Error surfaces",
    reason: "renders before ThemeProvider mounts on hard 404s",
  },
  {
    pattern: /^src\/components\/DashboardErrorBoundary\.tsx$/,
    category: "Error surfaces",
    reason: "renders when the app crashes; must not depend on theme state",
  },

  // Hero photography backdrops — white text overlays dark cover photos,
  // theme-agnostic by design.
  {
    pattern: /^src\/components\/DashboardHero\.tsx$/,
    category: "Hero photography",
    reason: "overlays white text on dark cover photography",
  },

  // Test files.
  {
    pattern: /__tests__/,
    category: "Tests",
    reason: "test fixtures and setup",
  },
  {
    pattern: /\.test\.(ts|tsx)$/,
    category: "Tests",
    reason: "vitest suites",
  },
];

/** @type {AllowlistEntry[]} */
export const allowlist = [
  // Example — leave commented until a real need appears:
  // {
  //   pattern: /^src\/components\/site\/ObsidianLoader\.tsx$/,
  //   rules: ["R2"],
  //   reason: "brand SVG gradient stops (neon-cyan / soft-violet)",
  // },
];

/**
 * Autofix mappings — a conservative, high-confidence dictionary the
 * guardrail uses when invoked with `--fix` (rewrite files) or `--dry-run`
 * (preview only).
 *
 * Each entry maps ONE offending raw utility to ONE semantic replacement.
 * We only fix R3 (palette utility) and R4 (raw black/white) because R1
 * (arbitrary hex) and R2 (bare hex) have no safe 1:1 semantic mapping —
 * those still fail the scan and require manual resolution.
 *
 * Extend this map cautiously. Every entry becomes a silent rewrite in
 * PRs, so the target must be correct for BOTH light and dark themes.
 * When unsure, leave the offender to fail the scan.
 *
 * @typedef {Object} AutofixEntry
 * @property {string} from   exact utility to match (no opacity suffix)
 * @property {string} to     semantic replacement utility
 * @property {string} reason short justification, echoed in --dry-run diff
 *
 * @type {AutofixEntry[]}
 */
export const autofix = [
  // Neutrals → surface tokens.
  { from: "bg-white", to: "bg-background", reason: "app surface" },
  { from: "bg-black", to: "bg-foreground", reason: "inverse surface" },
  { from: "text-white", to: "text-primary-foreground", reason: "on-primary text" },
  { from: "text-black", to: "text-foreground", reason: "default text" },
  { from: "border-white", to: "border-border", reason: "themed hairline" },
  { from: "border-black", to: "border-border", reason: "themed hairline" },

  // Slate/gray text ramps → foreground / muted-foreground.
  { from: "text-slate-500", to: "text-muted-foreground", reason: "secondary text" },
  { from: "text-slate-600", to: "text-muted-foreground", reason: "secondary text" },
  { from: "text-slate-700", to: "text-foreground", reason: "primary text" },
  { from: "text-slate-800", to: "text-foreground", reason: "primary text" },
  { from: "text-slate-900", to: "text-foreground", reason: "primary text" },
  { from: "text-gray-500", to: "text-muted-foreground", reason: "secondary text" },
  { from: "text-gray-600", to: "text-muted-foreground", reason: "secondary text" },
  { from: "text-gray-700", to: "text-foreground", reason: "primary text" },
  { from: "text-gray-900", to: "text-foreground", reason: "primary text" },
  { from: "text-neutral-500", to: "text-muted-foreground", reason: "secondary text" },
  { from: "text-zinc-500", to: "text-muted-foreground", reason: "secondary text" },

  // Slate/gray backgrounds → surface tokens (dark ramps → background,
  // light ramps → muted).
  { from: "bg-slate-50", to: "bg-muted", reason: "subtle surface" },
  { from: "bg-slate-100", to: "bg-muted", reason: "subtle surface" },
  { from: "bg-slate-900", to: "bg-background", reason: "dark surface" },
  { from: "bg-slate-950", to: "bg-background", reason: "dark surface" },
  { from: "bg-gray-50", to: "bg-muted", reason: "subtle surface" },
  { from: "bg-gray-100", to: "bg-muted", reason: "subtle surface" },
  { from: "bg-gray-900", to: "bg-background", reason: "dark surface" },

  // Borders — most palette borders map cleanly to border-border.
  { from: "border-slate-200", to: "border-border", reason: "themed hairline" },
  { from: "border-slate-300", to: "border-border", reason: "themed hairline" },
  { from: "border-gray-200", to: "border-border", reason: "themed hairline" },
  { from: "border-gray-300", to: "border-border", reason: "themed hairline" },
  { from: "border-zinc-200", to: "border-border", reason: "themed hairline" },
  { from: "border-neutral-200", to: "border-border", reason: "themed hairline" },
];

export default { excludePaths, allowlist, autofix };
