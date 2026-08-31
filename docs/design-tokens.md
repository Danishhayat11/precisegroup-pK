# Design Token Reference — Refined Enterprise Deep

All tokens live in `src/styles.css` under `:root` (light) and `.dark`. Components
consume them via Tailwind utilities (`bg-primary`, `text-muted-foreground`,
`border-border`, …) — **never** hardcode hex/HSL literals or `text-white` /
`bg-black` in component code.

**Preview:** `/theme-preview` renders every token side-by-side in both modes.

---

## 1. Surfaces & Type

| Token                  | Utility                   | Where to use                                                     |
| ---------------------- | ------------------------- | ---------------------------------------------------------------- |
| `--background`         | `bg-background`           | Page canvas. Root of every route.                                |
| `--foreground`         | `text-foreground`         | Default body text. Never use `text-black`/`text-white`.          |
| `--card`               | `bg-card`                 | Elevated content containers, KPI tiles, panels.                  |
| `--card-foreground`    | `text-card-foreground`    | Text sitting on `--card`.                                        |
| `--popover`            | `bg-popover`              | Floating surfaces: dropdown, select, popover, command menu.      |
| `--popover-foreground` | `text-popover-foreground` | Text inside popovers.                                            |
| `--muted`              | `bg-muted`                | Subtle fills: table headers, disabled inputs, section backdrops. |
| `--muted-foreground`   | `text-muted-foreground`   | Secondary/helper text, captions, axis labels, placeholders.      |

**Rule:** every text node's color must resolve to `--foreground`,
`--muted-foreground`, or a role-foreground token (`--primary-foreground`, etc.).

---

## 2. Brand & Interaction

| Token                    | Utility                                    | Where to use                                                                                      |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `--primary`              | `bg-primary` / `text-primary`              | Deep navy (light) / steel-blue (dark). Primary CTA, active nav, key numeric emphasis, link hover. |
| `--primary-foreground`   | `text-primary-foreground`                  | Text on `--primary` fills.                                                                        |
| `--secondary`            | `bg-secondary`                             | Neutral chip / secondary button fill.                                                             |
| `--secondary-foreground` | `text-secondary-foreground`                | Text on `--secondary`.                                                                            |
| `--accent`               | `bg-accent`                                | Hover state for nav items, list rows, menu items. Never a resting fill.                           |
| `--accent-foreground`    | `text-accent-foreground`                   | Text on `--accent` hover.                                                                         |
| `--ring`                 | `ring-ring` / `focus-visible:ring-ring`    | Focus ring on every interactive element. Steel-blue.                                              |
| `--border`               | `border-border`                            | All hairlines: cards, tables, dividers, inputs at rest.                                           |
| `--input`                | Used internally by `<Input/>`, `<Select/>` | Input border resting state.                                                                       |

**Interaction pattern**

- Rest: `--border` hairline, no fill.
- Hover: `bg-accent text-accent-foreground`.
- Active/selected: `bg-primary text-primary-foreground` (nav) or `bg-accent` (menu).
- Focus: `ring-2 ring-ring ring-offset-2 ring-offset-background`.
- Disabled: `opacity-50 pointer-events-none`.

---

## 3. Signal Tokens

Reserved for meaning — never used decoratively.

| Token                      | Utility                               | Where to use                                 |
| -------------------------- | ------------------------------------- | -------------------------------------------- |
| `--success`                | `bg-success` / `text-success`         | Paid, reconciled, verified. Positive deltas. |
| `--success-foreground`     | `text-success-foreground`             | Text on success fills.                       |
| `--warning`                | `bg-warning` / `text-warning`         | Upcoming due, needs review, partial state.   |
| `--warning-foreground`     | `text-warning-foreground`             | Text on warning fills.                       |
| `--destructive`            | `bg-destructive` / `text-destructive` | Overdue, delete, error, cancellation.        |
| `--destructive-foreground` | `text-destructive-foreground`         | Text on destructive fills.                   |
| `--info`                   | `bg-info` / `text-info`               | Neutral information callouts.                |
| `--adjustment`             | `bg-adjustment` / `text-adjustment`   | Ledger adjustments, manual corrections.      |

**Rule:** signal color is the message. Do not use `--destructive` for a red
accent, or `--success` because green looks nice — it will mislead users
scanning ledger, booking, and reconciliation screens.

---

## 4. Chart Palette

Ordered navy → steel → mist. Multi-series charts should consume them in order
so the visual weight (dark = primary series) matches the data hierarchy.

| Token       | Light      | Dark         | Use for                          |
| ----------- | ---------- | ------------ | -------------------------------- |
| `--chart-1` | deep navy  | steel-blue   | Primary series / totals.         |
| `--chart-2` | navy hero  | deeper steel | Secondary series.                |
| `--chart-3` | steel-blue | soft steel   | Tertiary / comparison series.    |
| `--chart-4` | mist steel | mist         | Fourth series, background bands. |
| `--chart-5` | pale mist  | muted steel  | Fifth series, faint overlays.    |

Gridlines, cursors, tooltip borders come from `--border`; axis text from
`--muted-foreground`; tooltip surface from `--popover`. All handled by
`<ChartContainer>` — do not restyle recharts primitives inline.

---

## 5. Sidebar Tokens

Scoped to the app shell; never used outside `<Sidebar/>`.

| Token                         | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `--sidebar`                   | Sidebar background (flat deep navy in both modes). |
| `--sidebar-foreground`        | Nav label default color.                           |
| `--sidebar-primary`           | Brand/logo accent inside sidebar.                  |
| `--sidebar-accent`            | Active/hover row fill (steel-blue at 20%).         |
| `--sidebar-accent-foreground` | Text on active row.                                |
| `--sidebar-border`            | Section dividers in sidebar.                       |
| `--sidebar-ring`              | Focus ring for sidebar controls.                   |

---

## 6. Editorial Tokens

For document surfaces (`/documents`, printed notices) — not app chrome.

| Token     | Use                                                                |
| --------- | ------------------------------------------------------------------ |
| `--paper` | Document canvas fill.                                              |
| `--ink`   | Document body copy.                                                |
| `--sage`  | Confirmation / positive callout in documents.                      |
| `--rust`  | Emphasis / seal / annotation in documents.                         |
| `--gold`  | Repurposed to steel-blue; use for eyebrow labels, section markers. |

---

## 7. Gradient & Elevation

| Token             | Use                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------ |
| `--gradient-hero` | Hero surfaces only (dashboard header, login). Navy base with steel-blue corner glow. |

Shadows use Tailwind's scale (`shadow-sm`, `shadow-md`) — no custom shadow tokens.
Keep elevation restrained: enterprise feel prefers hairlines over drop shadows.

---

## Anti-patterns (grep these before shipping)

```
text-white         text-black         bg-white          bg-black
text-gray-*        bg-gray-*          border-gray-*
text-slate-*       bg-slate-*         text-zinc-*
hsl(217 91% …)     hsl(43 …)          #[0-9a-f]{6} in .tsx
```

Any hit bypasses the theme and will regress WCAG contrast the next time tokens
shift. Replace with the semantic token above.
