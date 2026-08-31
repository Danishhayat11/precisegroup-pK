# Precise ERP — Design System

Single source of truth for typography, spacing, color, radius, elevation and
motion. All tokens live in `src/styles.css` under `@theme inline` (Tailwind v4)
and cascade to every screen automatically. **Never hardcode raw values in
components** — always use the token or its Tailwind utility.

## Color

Semantic tokens (map to `bg-*`, `text-*`, `border-*` utilities):

| Token                                                  | Utility                                    | Purpose                                 |
| ------------------------------------------------------ | ------------------------------------------ | --------------------------------------- |
| `--color-background` / `--color-foreground`            | `bg-background` / `text-foreground`        | App canvas + primary text               |
| `--color-card` / `--color-card-foreground`             | `bg-card` / `text-card-foreground`         | Panels, tiles                           |
| `--color-popover`                                      | `bg-popover`                               | Menus, popovers                         |
| `--color-primary`                                      | `bg-primary text-primary-foreground`       | Primary actions, active states          |
| `--color-secondary`                                    | `bg-secondary`                             | Secondary surfaces                      |
| `--color-muted` / `--color-muted-foreground`           | `bg-muted` / `text-muted-foreground`       | Subdued blocks, helper text             |
| `--color-accent`                                       | `bg-accent text-accent-foreground`         | Hover/selected chips                    |
| `--color-border` / `--color-input` / `--color-ring`    | `border-border` / `bg-input` / `ring-ring` | 1px hairlines, form fields, focus rings |
| `--color-destructive`                                  | `bg-destructive`                           | Delete, danger                          |
| `--color-success` / `--color-warning` / `--color-info` | `bg-success` / `bg-warning` / `bg-info`    | Status badges                           |
| `--color-gold`                                         | `bg-gold`                                  | Brand mark accent (letterhead, logo)    |
| `--color-adjustment`                                   | `bg-adjustment`                            | Adjustment / violet secondary accent    |
| `--color-chart-1..5`                                   | `bg-chart-1` …                             | Recharts palette                        |
| `--color-sidebar-*`                                    | `bg-sidebar` …                             | Sidebar chrome                          |

Light + dark values are defined on `:root` / `.dark` — never reference a raw
`hsl()` in component code. Dark mode uses a `#0B0F1A` midnight canvas with
electric-blue (`hsl(217 91% 62%)`) primary and deep violet (`hsl(258 84% 68%)`)
adjustment tokens.

## Typography

Families (loaded via `<link>` in `src/routes/__root.tsx`):

- `font-sans` — **Geist** / Inter fallback (body, UI)
- `font-display` — **Geist** (headlines, `.font-display`)
- `font-mono` — **JetBrains Mono** (code, receipt numbers, KPI numerics)

### Fluid type scale

Every step is a `clamp(min, fluid, max)` — text scales smoothly from a 375px
phone to a 1440px+ desktop with no media queries. Use the Tailwind utilities
(`text-xs` … `text-6xl`); the raw tokens (`--text-*`) exist for one-off CSS.

| Utility     | Token         | Range (mobile → desktop) | Typical use               |
| ----------- | ------------- | ------------------------ | ------------------------- |
| `text-2xs`  | `--text-2xs`  | 11 → 12 px               | kbd, labels, dense chips  |
| `text-xs`   | `--text-xs`   | 12 → 13 px               | badge text, table meta    |
| `text-sm`   | `--text-sm`   | 13 → 14 px               | secondary body, form help |
| `text-base` | `--text-base` | 15 → 16 px               | body copy default         |
| `text-lg`   | `--text-lg`   | 16 → 18 px               | lead paragraph small      |
| `text-xl`   | `--text-xl`   | 17 → 20 px               | card titles               |
| `text-2xl`  | `--text-2xl`  | 20 → 26 px               | H3, section titles        |
| `text-3xl`  | `--text-3xl`  | 24 → 34 px               | H2                        |
| `text-4xl`  | `--text-4xl`  | 30 → 48 px               | H1                        |
| `text-5xl`  | `--text-5xl`  | 36 → 60 px               | hero display              |
| `text-6xl`  | `--text-6xl`  | 40 → 72 px               | landing hero              |

Weight tokens: `--font-weight-regular|medium|semibold|bold`.
Leading tokens: `--leading-tight|snug|normal|relaxed`.
Tracking tokens: `--tracking-tight|normal|wide` (display sizes already get
`-0.022em` via the global `h1/h2/h3/.font-display` rule).

### Headings — H1–H6 have baseline defaults

Global styles set family, weight (≤ 600), line-height, letter-spacing, and a
fluid `clamp()` size per level. Hierarchy is carried by size + rhythm, not
heavy weights. Just author semantic HTML:

```tsx
<h1>Portfolio overview</h1>              {/* 30 → 48 px */}
<h2>Recent transactions</h2>             {/* 24 → 34 px */}
<h3>By segment</h3>                      {/* 20 → 26 px */}
<h4>Cash flow</h4>                       {/* 17 → 20 px */}
<h5>Notes</h5>                           {/* 15 → 16 px */}
<h6>Source · Ledger 2024-Q3</h6>         {/* 13 → 14 px, uppercase tracked, muted */}
```

Body rules:

- Body copy: `text-base` (defaults to fluid 15 → 16 px) + `leading-normal`.
- Numeric columns / KPIs: always add `tabular-nums`.
- H1: `text-3xl` or larger + `font-display font-semibold` when overriding.
- Long-form article body: wrap in `.prose` for vertical rhythm and a
  `max-inline-size: 68ch` reading measure.

### Prose utility

Apply `className="prose"` around long-form article/marketing content. It
adds vertical rhythm to `h1`–`h6`, `p`, lists, `blockquote`, and `pre`, and
caps the reading measure at 68 characters.

```tsx
<article className="prose container-prose">
  <h1>Property management vs ERP</h1>
  <p className="lead">Which system belongs at the center of your ops stack?</p>
  <h2>The decision framework</h2>
  <p>…</p>
</article>
```

### `.lead` — subhead under an H1 / H2

Fluid 16 → 19 px, calm slate, capped at 60ch. Use for the single sentence
that sits under a heading.

```tsx
<h1>Precise Realtors</h1>
<p className="lead">
  A modern operating system for property portfolios — leases, payments,
  and maintenance in one place.
</p>
```

### `.caption` — small labels / footnotes

Fluid 12 → 13 px, muted. Use under KPIs, on image credits, in card metadata.

```tsx
<div className="rounded-2xl border border-border bg-card p-5">
  <p className="caption">Occupancy this quarter</p>
  <p className="text-3xl font-semibold tabular-nums">94.2%</p>
  <p className="caption">+2.1 pts vs Q2</p>
</div>
```

### `.eyebrow` — kicker above a heading

Uppercase tracked slate, 11 → 12 px. Sits above an H1/H2 for section framing.

```tsx
<header className="stack-tight">
  <p className="eyebrow">Case Study</p>
  <h2>How Alderway cut turnaround by 38%</h2>
</header>
```

### Code, `kbd`, and mono in data tables

`code`, `kbd`, `samp`, `pre`, and `.font-mono` inherit tabular numerics and
the `ss01` stylistic set so digits align in columns. Inline `code` gets a
hairline pill background; `pre` blocks are fluid-padded and horizontally
scrollable on mobile without cropping.

```tsx
// Inline reference
<p>
  Set <code>--text-base</code> on <code>:root</code> to change body scale.
</p>

// Fenced block — 12 → 13 px, 12-16px padding, scrolls on 375px
<pre>
  <code>{`node scripts/visual-regression.mjs`}</code>
</pre>

// Data table — numerics stay tabular, cells fluid-pad
<div className="overflow-x-auto">
  <table className="w-full">
    <thead>
      <tr><th>Property</th><th>Rent</th><th>Balance</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>Unit 4A</td>
        <td className="font-mono">$2,450.00</td>
        <td className="font-mono">$0.00</td>
      </tr>
    </tbody>
  </table>
</div>
```

`table` cells auto-pad with `clamp(0.5rem, 0.4rem + 0.3vw, 0.75rem)` vertical
and `clamp(0.5rem, 0.35rem + 0.5vw, 0.875rem)` horizontal — the row height
stays compact at 375px but breathes on desktop. Mono cells auto-`white-space:
nowrap` so currency never wraps mid-number.

## Spacing (4pt grid + fluid utilities)

`--space-0` through `--space-24`. Prefer Tailwind spacing utilities
(`p-4`, `gap-6`, `mt-8`) — the scale matches. Never use arbitrary values
like `p-[13px]`; pick the nearest step.

### Fluid layout utilities

For anything that spans the viewport spectrum, use the fluid utilities
below instead of pinning to a fixed step. All values `clamp()` so a 375px
screen never feels cramped and a 1440px screen never feels lost.

| Utility           | Behavior                                                             | Use for                                |
| ----------------- | -------------------------------------------------------------------- | -------------------------------------- |
| `container-fluid` | `max-w: 1600px`, `padding-inline: clamp(16px, 0.5rem + 2.5vw, 40px)` | App shells, dashboards, wide layouts   |
| `container-prose` | `max-w: 1152px`, `padding-inline: clamp(16px, 0.5rem + 2.5vw, 32px)` | Reading pages, marketing sections      |
| `section-y`       | `padding-block: clamp(32px, 1.25rem + 3vw, 72px)`                    | Vertical rhythm between major sections |
| `stack-tight`     | `flex-col`, `gap: clamp(8px, 0.4rem + 0.3vw, 12px)`                  | Label + value pairs, dense form rows   |
| `stack-base`      | `flex-col`, `gap: clamp(12px, 0.6rem + 0.5vw, 20px)`                 | Card interiors, form field groups      |
| `stack-loose`     | `flex-col`, `gap: clamp(16px, 0.75rem + 1vw, 32px)`                  | Page sections, top-level layouts       |

Example — a marketing hero that scales cleanly from 375px to desktop:

```tsx
<section className="section-y">
  <div className="container-fluid stack-loose">
    <header className="stack-tight">
      <p className="eyebrow">Platform</p>
      <h1>Operate every property from one screen</h1>
      <p className="lead">Leases, payments, maintenance, and reporting.</p>
    </header>
    <div className="grid gap-6 md:grid-cols-3">…</div>
  </div>
</section>
```

Legacy layout containers still available for fixed-max shells:

- `--container-content` (72rem / 1152px) — reading pages.
- `--container-app` (100rem / 1600px) — dashboards, tables.

### Mobile safety rails (auto-applied)

- `h1`–`h6`, `p`, `li`, `dd`, `dt`, `blockquote` receive `overflow-wrap:
anywhere` so long words / URLs never blow out mobile cards.
- Headings use `text-wrap: balance`; paragraphs use `text-wrap: pretty`.
- Below **380 px**, `h1` letter-spacing tightens by 0.008 em and `.prose`
  drops to 15 px to keep character count reasonable.

## Border radius

Interactive elements land on **12–16 px** (`--radius-md` / `--radius-lg`) per
product spec. Full ramp:

| Token           | Value  | Utility        | Use             |
| --------------- | ------ | -------------- | --------------- |
| `--radius-xs`   | 4px    | `rounded-xs`   | Nested chips    |
| `--radius-sm`   | 8px    | `rounded-sm`   | Menu items      |
| `--radius-md`   | 12px   | `rounded-md`   | Buttons, inputs |
| `--radius-lg`   | 16px   | `rounded-lg`   | Cards, tiles    |
| `--radius-xl`   | 20px   | `rounded-xl`   | Dialogs, sheets |
| `--radius-2xl`  | 24px   | `rounded-2xl`  | Feature panels  |
| `--radius-3xl`  | 32px   | `rounded-3xl`  | Hero shells     |
| `--radius-full` | 9999px | `rounded-full` | Pills, avatars  |

## Elevation

`--shadow-ios-xs|sm|md|lg|xl`, usable as `shadow-ios-md` etc. Cards receive
`shadow-ios-sm` by default; hoverable tiles lift to `shadow-ios-lg`; dialogs
sit at `shadow-ios-xl`. Dark mode automatically swaps to deeper values.

## Motion

Full spec: [`docs/motion-tokens.md`](./motion-tokens.md). Quick reference:

- **Duration:** `--duration-fast` 200 ms (input feedback), `--duration-base`
  320 ms (in-place change), `--duration-slow` 480 ms (new surface).
- **Easing:** `--ease-smooth` `cubic-bezier(0.22, 1, 0.36, 1)` (default),
  `--ease-emphasized` `cubic-bezier(0.2, 0.8, 0.2, 1)` (dialogs/sheets).
- **Framer springs:** use the named presets — `springSnappy` (chips/tap),
  `springPill` (shared `layoutId`), `springCount` (numeric flip),
  `springDialog` (surface enter). Never inline a fresh spring config.
- **Aliases:** `--motion-fast|base|slow` are legacy names for the same
  numbers; new code uses `--duration-*`.

Utilities: `duration-fast`, `duration-base`, `duration-slow`, `ease-smooth`,
`ease-emphasized`. All transitions honor `prefers-reduced-motion` globally.

**Never hardcode a duration or `cubic-bezier(...)` literal in a component** —
add a token in `src/styles.css` first (and a row in `motion-tokens.md`).

## Component defaults (auto-applied globally)

Cascading from `src/styles.css` — no per-component styling needed:

- Cards → 16px radius + hairline border + `shadow-ios-sm`; hoverable variants lift.
- Buttons → 12px radius + 0.97 press micro-animation + iOS primary glow.
- Inputs → 12px radius + electric-blue focus ring (dark) / gold (light).
- Dialogs / sheets → 20px radius + `shadow-ios-xl` + backdrop-blur overlay.
- Dropdowns / popovers → 14px radius + `shadow-ios-lg` + hairline border.
- Sticky topbar → translucent frosted chrome (dark: midnight glass).
- Sidebar → floating panel with subtle inner highlight.
- Tables → tabular-nums, hairline rows, subtle hover tint.
- Scrollbars → 10px slate/blue overlay.

## Rules of engagement

1. **Never** write `text-white`, `bg-black`, `bg-[#0B0F1A]`, `p-[13px]`, or a
   raw `hsl(...)` in a component. Use the token or its utility.
2. **Never** create a new color/spacing token in a component file. Add it here
   in `src/styles.css` first.
3. **Never** hand-write vendor prefixes (`-webkit-backdrop-filter`). Tailwind /
   Lightning CSS emits them at build.
4. Interactive elements: radius 12 or 16 px, transitions `duration-fast`
   `ease-smooth`, focus ring via `:focus-visible` (already global).
5. **Motion:** never inline a duration or `cubic-bezier(...)` in a component —
   resolve to a `--duration-*` / `--ease-*` token, or a named Framer spring
   preset. Full rules: [`docs/motion-tokens.md`](./motion-tokens.md).
6. Every new animation must degrade to a 1-frame opacity fade under
   `prefers-reduced-motion: reduce`; verify by toggling the emulator in
   DevTools → Rendering.

7. New surfaces default to the semantic pair, e.g. `bg-card
text-card-foreground border border-border`.
