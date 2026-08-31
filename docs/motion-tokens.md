# Motion Design Tokens

Single source of truth for animation timing across the app. Every transition,
Framer Motion spring, `@keyframes` step, and CSS transition on a shadcn
primitive must resolve to one of the tokens below — never a raw duration or
`cubic-bezier(...)` literal in a component.

Tokens live in `src/styles.css` (`:root` + `@theme inline`) and are exposed as
both CSS variables and Tailwind utilities.

---

## Duration scale

| Token             | Value  | Tailwind utility | Use for                                                                                             |
| ----------------- | ------ | ---------------- | --------------------------------------------------------------------------------------------------- |
| `--duration-fast` | 200 ms | `duration-fast`  | Hover, focus, pressed, tap-scale, color/background swaps, icon rotate, chip highlight               |
| `--duration-base` | 320 ms | `duration-base`  | Card/row appear + disappear, popover/menu open, tab crossfade, KPI number tween, filter-region swap |
| `--duration-slow` | 480 ms | `duration-slow`  | Dialog / sheet / drawer enter, hero orchestration, first-paint reveal, page transitions             |

Aliases `--motion-fast|base|slow` are the same numbers, kept for legacy call
sites — prefer `--duration-*` in new code.

**Rule of thumb:** if the animation runs on user input, use `fast`. If it moves
existing content on the same surface, use `base`. If it introduces a whole new
surface, use `slow`.

## Easing scale

| Token               | Curve                            | Use for                                                                             |
| ------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `--ease-smooth`     | `cubic-bezier(0.22, 1, 0.36, 1)` | **Default.** Cards, rows, popovers, tabs, chips, hover/focus state, shimmer sweeps. |
| `--ease-emphasized` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Dialogs, sheets, drawers, and any surface that enters from off-canvas.              |

Both are asymmetric ease-out curves so motion decelerates into rest —
matches Apple's iOS system feel.

## Framer Motion spring presets

Springs are stateful and cannot use CSS variables; use these exact tuples for
consistency:

| Preset         | `{ type, stiffness, damping }`                    | Use for                                                               |
| -------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `springSnappy` | `{ type: "spring", stiffness: 460, damping: 28 }` | Filter chips, tap-scale, hover-lift, badge toggles                    |
| `springPill`   | `{ type: "spring", stiffness: 380, damping: 30 }` | Shared-layoutId active pills between chips / tabs                     |
| `springCount`  | `{ type: "spring", stiffness: 500, damping: 30 }` | Numeric flip inside a chip / KPI (`AnimatePresence mode="popLayout"`) |
| `springDialog` | `{ type: "spring", stiffness: 260, damping: 26 }` | Dialog / sheet / drawer enter                                         |

## Global auto-applied transitions

`src/styles.css` normalises every shadcn primitive so components rarely need to
write a `transition` themselves:

```css
.transition-all,
.transition,
.transition-colors,
.transition-transform,
.transition-opacity,
.transition-shadow {
  transition-duration: var(--motion-base);
  transition-timing-function: var(--ease-smooth);
}

button,
[role="button"],
a,
[data-slot="button"],
[data-slot="tabs-trigger"],
[data-slot="select-trigger"] {
  transition:
    background-color var(--motion-fast) var(--ease-smooth),
    color var(--motion-fast) var(--ease-smooth),
    border-color var(--motion-fast) var(--ease-smooth),
    box-shadow var(--motion-fast) var(--ease-smooth),
    transform var(--motion-fast) var(--ease-smooth);
}
```

## Reduced-motion contract

A single global rule collapses every non-essential animation to a zero-duration
opacity fade:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

For Framer Motion, read `reducedMotion` from `useTheme()` and pass a
zero-duration `transition={{ duration: 0 }}` (or `undefined` variants) — never
run a spring in reduced-motion mode.

## Named keyframes (canonical)

Keep new `@keyframes` in `src/styles.css` and prefix them with a scope:
`ios-*` for shell/dashboard, `gs-*` for global search. Existing:

| Name                | Duration               | Purpose                              |
| ------------------- | ---------------------- | ------------------------------------ |
| `ios-shimmer`       | `var(--duration-slow)` | Skeleton placeholder shimmer         |
| `gs-shimmer`        | 1.6 s                  | Global-search loading skeleton sweep |
| `ios-page-enter`    | `var(--duration-base)` | Route-level content mount            |
| `ios-menu-in`       | `var(--duration-fast)` | Dropdown / popover open              |
| `ios-result-enter`  | `var(--duration-base)` | Search result row mount              |
| `ios-result-fade`   | `var(--duration-fast)` | Search result row unmount            |
| `ios-kpi-settle`    | `var(--duration-slow)` | KPI number settle after tween        |
| `ios-reduced-pulse` | 1.4 s                  | Reduced-motion-safe status pulse     |

---

## Component authoring guidelines

When you add or edit UI, follow these rules — no exceptions.

### 1. Never hardcode timing values.

❌ `transition: opacity 250ms ease-out;`
✅ `transition: opacity var(--duration-fast) var(--ease-smooth);`

❌ `transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}`
✅ Read the CSS var, or use one of the Framer spring presets above.

### 2. Match the token to the surface.

- **User input feedback** (hover, focus, press, toggle): `duration-fast` + `ease-smooth`.
- **In-place content change** (row add/remove, chip flip, popover reveal): `duration-base` + `ease-smooth`.
- **New surface entering** (dialog, sheet, drawer, first mount): `duration-slow` + `ease-emphasized`.

### 3. Prefer the shadcn primitive.

If a `Button`, `Card`, `Tabs`, `Select`, `DropdownMenu`, `Dialog`, or `Sheet`
already exists, use it — the global cascade above wires the correct transitions
automatically. Do not re-declare `transition-*` classes just to override.

### 4. `AnimatePresence` regions.

Wrap conditional groups (search results, filter regions, banners) in
`AnimatePresence` with the `REGION_VARIANTS` / `ITEM_VARIANTS` already defined
in the codebase. New regions must:

- Use `initial={false}` for regions that are visible on mount (avoids
  unwanted enter animation on hydration).
- Provide `layout` on child motion elements only if the parent uses
  `layout` — otherwise `AnimatePresence` handles the shift.
- Fall back to zero-duration when `reducedMotion` is true.

### 5. Shared-layout `layoutId`.

Use `springPill` for the moving pill and namespace the `layoutId` per group
(e.g. `chips-${label}`) so pills don't teleport between unrelated groups.

### 6. Numeric changes.

For counts, KPIs, or badges whose number changes, wrap the value in
`AnimatePresence mode="popLayout"` with `springCount` — never re-render a
static `<span>{value}</span>` if the number moves; users need to see it change.

### 7. Reduced motion.

Every new animation MUST be either:

- Purely CSS (auto-covered by the global reduce-motion rule), OR
- Framer Motion behind a `reducedMotion` check that skips springs.

Manual QA: toggle "Reduce Motion" in macOS System Settings → Accessibility, or
DevTools → Rendering → Emulate CSS media feature → `prefers-reduced-motion:
reduce`. Nothing should slide, scale, or spin beyond a 1-frame opacity fade.

### 8. No new easing curves.

Do not introduce a fifth cubic-bezier. If a case truly requires one, add it as
a `--ease-*` token in `src/styles.css` first, add a row above, and get review.

---

## Where to find things

- CSS tokens: `src/styles.css` (search `--duration-` / `--ease-`).
- Global transition cascade: `src/styles.css` (search `Normalize transition cadence`).
- Framer helpers: `REGION_VARIANTS`, `ITEM_VARIANTS`, `AnimRegion` in
  `src/components/GlobalSearch.tsx` (canonical) and mirrored in
  `src/pages/Dashboard.tsx` (`FilterChipGroup`).
- Reduced-motion source of truth: `useTheme().reducedMotion`.
