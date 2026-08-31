# Contributing

Guidelines for making changes that touch the color guardrail — the CI script
at `scripts/ci/no-hex-in-marketing-shell.mjs` that fails builds when raw
colors leak into themed surfaces (marketing shell, `AppShell`, `_authenticated`
routes, and `src/pages/`). Its harness lives at
`scripts/ci/tests/color-audit-harness.sh` and runs on every CI run.

---

## Color guardrail: exceptions and scope changes

The guardrail rejects four patterns anywhere it scans: arbitrary-hex utilities
(`bg-[#0F172A]`), bare hex literals (`#abcdef`), non-semantic Tailwind palette
utilities (`bg-slate-900`, `text-gray-500`), and raw `bg-white` / `text-black`
utilities. Everything themed must go through the semantic tokens defined in
`src/styles.css` under `@theme` so dark mode and future re-branding survive.

Three escape hatches exist. Each requires a written reason so drift stays
auditable in `git blame` — the guardrail echoes the reason in its diagnostics.

### 1. `allow-raw-color-file` — whole-file opt-out

Add a single JS or JSX comment anywhere in the file:

```tsx
/* allow-raw-color-file: <one-line reason> */
```

This silences EVERY raw-color rule in that file. Use only when the whole file
is genuinely exceptional. **Accepted reasons** (add a new category only with
review):

| Category                      | Example reason                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Legacy status-token migration | `legacy dashboard pending status-token migration`                                                                                    |
| Dark hero photography overlay | `overlays white text/borders on dark hero photography; theme-agnostic by design`                                                     |
| Independent IDE-style surface | `dedicated slate/emerald IDE-style dark surface for the code debugger, intentionally independent of the ERP's semantic theme tokens` |
| Diff / status ribbon palette  | `reconciliation diff highlights use red/emerald palette pending diff-semantic tokens`                                                |

**Not accepted** — do NOT use `allow-raw-color-file` for these; fix the code
instead:

- "quick fix" / "TODO" / "temporary" without a linked issue or migration plan
- "designer wanted this exact hex" — add it to `@theme` as a token first
- copy-pasted from another component that itself has the marker
- silencing a single line that a line-level marker would cover

Before adding a file-level marker: confirm no existing semantic token fits,
prefer adding a new `@theme` token when the color is reused, and prefer a
line-level marker when only a handful of lines are exceptional.

### 2. `allow-raw-color` — single-line opt-out

Same-line:

```tsx
<stop stopColor="#00E5FF" /> {/* allow-raw-color: brand neon-cyan gradient stop */}
```

Or on the immediately preceding line (useful when the offender is on its own
JSX attribute line):

```tsx
{
  /* allow-raw-color: brand soft-violet gradient stop */
}
<stop stopColor="#7A5CFF" />;
```

Reserve for brand SVG gradient stops, external embed color parameters, and
print stylesheet values that cannot go through `@theme`. The reason must
identify the specific asset — not "designer approved".

### 3. Centralized config — `scripts/ci/color-audit.config.mjs`

The guardrail loads its exceptions from `scripts/ci/color-audit.config.mjs`.
Adding a new page-level exception does NOT require editing the guardrail
script itself — add an entry to the config instead.

Two arrays are exported:

- **`excludePaths`** — path-based skip. The file is not scanned at all.
  Same bar as the legacy `EXCLUDE_MATCHERS`: use for surfaces where raw
  colors are inherent (print stylesheets, letterhead, error pages,
  hero photography backdrops).
- **`allowlist`** — path-scoped RULE silencing. The file is scanned, but
  the listed rules (`R1` arbitrary-hex, `R2` bare hex, `R3` palette
  utility, `R4` raw black/white) are silenced. Use `rules: ["R2"]` to
  keep, say, brand SVG hex stops without silencing palette drift on the
  same file. Use `rules: "*"` to silence the whole file (equivalent to
  `allow-raw-color-file`, but centralized).

Each entry requires a `pattern` (RegExp preferred, string prefix accepted),
a `reason`, and — for `excludePaths` — a `category`. The guardrail echoes
the reason in its diagnostics banner tagged `[config]` so drift stays
auditable.

```js
// scripts/ci/color-audit.config.mjs
export const excludePaths = [
  {
    pattern: /^src\/components\/print\//,
    category: "Print / letterhead",
    reason: "print sub-components target the PDF pipeline",
  },
];
export const allowlist = [
  {
    pattern: /^src\/components\/site\/ObsidianLoader\.tsx$/,
    rules: ["R2"],
    reason: "brand SVG gradient stops (neon-cyan / soft-violet)",
  },
];
```

Only add an `excludePaths` entry when ALL of these are true:

1. The surface renders outside the themed shell (print PDF, transactional
   email HTML, letterhead, error page rendered before providers mount, hero
   photography backdrop).
2. Raw colors are inherent to the surface, not drift that can be tokenized
   (print CSS ignores CSS variables; letterhead is fixed-brand).
3. A per-file or per-line marker would need to cover essentially every line.
4. The path is stable — not a scratch route, not `src/pages/Index.tsx`
   pending replacement.

When you add a config entry:

- Use POSIX-style slashes; the matcher normalizes for Windows runners.
- Prefer an anchored filename regex over a whole directory.
- Prefer `allowlist` with a specific rule set over `excludePaths` whenever
  the file has legitimate scan value for the other rules.
- Add or extend a fixture in `scripts/ci/tests/color-audit-harness.sh`
  (Scenario D covers config-driven allowlist/exclude wiring).

**Never** add an `excludePaths` entry for:

- an authenticated app route (`src/routes/_authenticated/**`) — use an
  `allowlist` entry with `rules: "*"` (or a specific rule set), or an
  inline `allow-raw-color-file` marker with a migration reason
- a directory that could accumulate untracked drift (`src/components/ui/**`,
  `src/pages/**`)
- test files — the config already covers `__tests__/` and `*.test.tsx`

### Autofix — `--dry-run`, `--fix`, and the codemod CLI

The config also exports an `autofix` map of high-confidence 1:1 rewrites
(e.g. `bg-white → bg-background`, `text-slate-500 → text-muted-foreground`,
`border-gray-200 → border-border`). Only R3 (palette utility) and R4 (raw
black/white) participate — R1 (arbitrary hex) and R2 (bare hex) have no
safe universal mapping and always require manual resolution.

Two entry points, same mapping table:

```bash
# CI-scoped: preview / apply within the guardrail's protected surfaces.
node scripts/ci/no-hex-in-marketing-shell.mjs --dry-run
node scripts/ci/no-hex-in-marketing-shell.mjs --fix

# Codemod CLI: preview-first with per-file diffs. Defaults to the same
# protected scope; pass --path <dir> to target a subset during a migration.
node scripts/codemods/raw-color-to-token.mjs                     # dry-run diff
node scripts/codemods/raw-color-to-token.mjs --write             # apply
node scripts/codemods/raw-color-to-token.mjs --path src/pages/Dashboard.tsx --write
```

Both entry points honor line-level `allow-raw-color:` and file-level
`allow-raw-color-file:` markers, and skip files listed in
`config.excludePaths` (pass `--allow-excluded` to the codemod to override
during a deliberate migration). Extend the `autofix` array cautiously —
every entry becomes a silent rewrite, so the target must be correct in
BOTH light and dark themes.

### Verifying your change

After editing the guardrail, its config, or fixtures, run:

```bash
node scripts/ci/no-hex-in-marketing-shell.mjs
bash scripts/ci/tests/color-audit-harness.sh
```

The first must exit 0 against the real tree. The second must report
`N passed, 0 failed` and drops per-scenario logs into `ci-artifacts/` for
triage. Both run in CI on every push.
