# UI QA Checklist

Quick pass to run on every new page before merging. Verify at **375px (iPhone SE)**, **390px (iPhone 14)**, **412px (Pixel 7)**, and **≥1024px** desktop.

---

## 1. Status badges

- [ ] Uses shared `<StatusBadge label tone />` from `src/components/StatusBadge.tsx` — no raw `<span>` with color utilities.
- [ ] Tone comes from `statusTone(label)`; add new statuses to that map, not inline.
- [ ] Allowed tones only: `success | danger | warning | info | muted | neutral`. No hex, no `bg-green-500`, no `text-red-600`.
- [ ] Pill height ~22–24px, `px-2 py-0.5`, `text-xs font-medium`, `rounded-full`. Never wraps to 2 lines.
- [ ] Right-aligned in card headers, inline in table rows. Same badge = same tone across every page.

## 2. Empty states

- [ ] Uses shared `<EmptyState icon title description action? />` from `src/components/EmptyState.tsx`. Tables/lists pass `emptyTitle` + `emptyDescription` to `DataTable`.
- [ ] Icon is a `lucide-react` outline icon, `size={40}`, muted foreground, centered above title.
- [ ] Title is one short sentence (≤6 words). Description is one helper sentence explaining _why it's empty_ or _what to do next_.
- [ ] Includes a primary CTA when the user can act (`Add booking`, `Record payment`). Omit CTA on read-only/derived screens.
- [ ] Vertically centered in its container with `py-12` minimum. Never a bare "No data" string.

## 3. Skeleton loading

- [ ] Initial render shows skeleton, **not** a spinner. Use `TableRowsSkeleton`, `ListSkeleton`, `KpiCardSkeleton`, `ChartSkeleton`, `DashboardSkeleton`, `DialogSkeleton` from `src/components/ui/skeletons.tsx`.
- [ ] Skeleton mirrors the real layout: same number of cards/rows, same heights (±4px), same paddings — no layout shift when data arrives.
- [ ] Uses `ios-skeleton` shimmer class (already inside the shared components). No custom `animate-pulse` gradients.
- [ ] Suspense/loader fires within 100ms; skeleton visible for ≥200ms to avoid flash. Never render both skeleton _and_ real data at once.
- [ ] Route loaders use `ensureQueryData` + `useSuspenseQuery`; do not gate on `isLoading` in the component.

## 4. Section dividers

Dividers are the ONLY structural line users see between two blocks of
content. Wrong tone, wrong weight, or inconsistent spacing reads as
"broken layout" more than any other UI defect — verify each rule at
every breakpoint (375 / 390 / 412 / ≥ 1024), light AND dark.

### 4.1 Token & color

- [ ] Uses the `border-border` token — never `border-gray-*`, `border-slate-*`, `border-neutral-*`, a raw hex, or `border-black/10`. This is the only line color that respects light/dark and iOS/Android theme scoping.
- [ ] Dividers between elevated surfaces (card-on-card, sheet-on-modal) use `border-border/60` to soften the seam so the surface shadow doesn't fight the line.
- [ ] Never colored dividers to indicate state. Status changes tone via `<StatusBadge>`, not the divider.

### 4.2 Weight & style

- [ ] Thickness is exactly `1px` (`border`, not `border-2`). No dashed or dotted dividers anywhere.
- [ ] No gradient / faded dividers (`from-transparent via-border to-transparent`). One flat token line, edge-to-edge, unless the design explicitly calls for inset rules.
- [ ] Full-bleed inside a card: divider spans the FULL card width — reset the parent's padding with `-mx-4 md:-mx-6` when the surrounding content is padded, so the line touches both card edges.

### 4.3 Utility per surface

- [ ] Card header ↔ body: `border-b border-border` on the header row.
- [ ] Card body ↔ footer: `border-t border-border` on the footer row.
- [ ] Table rows: `border-t border-border` on `<tr>`, never `<td>` (avoids double lines and gaps at sticky columns).
- [ ] Stacked list on mobile: `divide-y divide-border` on the list container (`<ul>` / `<div role="list">`), NOT a per-item `border-b` (which double-strokes the last item over the page background).
- [ ] Sidebar / nav groups: `divide-y divide-border/60` between groups; no divider between the group heading and its first item.
- [ ] Modal / sheet header + footer bars: `border-b border-border` and `border-t border-border` respectively — matches the sticky card pattern so scrolled content doesn't bleed into the chrome.

### 4.4 Spacing above and below (mobile → desktop)

- [ ] Card header/footer padding: `px-4 py-3 md:px-6 md:py-4`. The divider inherits this rhythm — DO NOT add extra `mt-*` / `mb-*` around it.
- [ ] Standalone section rule between two blocks (no card): `my-6 md:my-10`. Never `my-4` (too tight, reads as a border), never `my-12` on mobile (wastes vertical real estate).
- [ ] Table rows: default row padding `py-2.5 md:py-3`; touch-friendly rows (mobile action lists) `py-3`. The `border-t` inherits.
- [ ] Divided list items: `py-3 md:py-4` per item. Last item MUST NOT add a trailing `border-b` — rely on `divide-y` so the list ends cleanly on the card edge.
- [ ] Section labels above a divider: label sits `mb-2 md:mb-3` above the rule, content resumes `mt-4 md:mt-6` below.

### 4.5 Alignment & inset

- [ ] Horizontal dividers stretch edge-to-edge of their container (`w-full`). No centered rules with side margin — that pattern is decorative, not structural.
- [ ] Inset dividers (used ONLY in dense mobile lists where an icon column would otherwise cut through the line) start at the content edge: `ml-[52px]` for a 40 px avatar + 12 px gap. Use sparingly and NEVER on desktop.
- [ ] Vertical dividers between inline chip groups: `h-4 w-px bg-border mx-2` (mobile) / `h-5 mx-3` (desktop). Never a full-height vertical rule inside a card — use a column gap instead.
- [ ] Sticky headers/footers keep their divider ON the sticky element (`border-b` on the sticky container), so the line stays put while content scrolls under it.

### 4.6 Mobile vs desktop variants (side-by-side)

| Surface                        | Mobile (≤ 767 px)                    | Desktop (≥ 768 px) |
| ------------------------------ | ------------------------------------ | ------------------ |
| Card header/footer padding     | `px-4 py-3`                          | `md:px-6 md:py-4`  |
| Card body top/bottom gap       | `py-4`                               | `md:py-6`          |
| Standalone section rule (`my`) | `my-6`                               | `md:my-10`         |
| Table row padding              | `py-2.5`                             | `md:py-3`          |
| Divided list item padding      | `py-3`                               | `md:py-4`          |
| Section label ↔ divider gap    | `mb-2`                               | `md:mb-3`          |
| Divider ↔ content gap          | `mt-4`                               | `md:mt-6`          |
| Vertical chip separator        | `h-4 w-px bg-border mx-2`            | `h-5 mx-3`         |
| Inset for icon lists           | `ml-[52px]` (only when 40 px avatar) | not used           |

- [ ] Every divider on the page appears at the correct row of this table when the viewport crosses `md`. If a rule "looks fine on desktop but crowded on mobile", the mobile spacing token is the fix — never bump desktop looser to compensate.

### 4.7 Anti-patterns (all must be absent)

- [ ] No stacked dividers (two `border-b` lines meeting a `border-t` — pick one).
- [ ] No divider between an `<EmptyState>` and its parent card body — the empty state IS the body.
- [ ] No divider inside a skeleton — skeletons render a flat surface until data arrives.
- [ ] No divider immediately under a `<PageHeader>` — the header already carries its own bottom rule; a second line reads as a bug.
- [ ] No `<hr>` elements. Always utility classes on the container above or below.
- [ ] No content block "hanging" on the page background — every section sits inside a card, table, or divided list.

---

## 5. Accessibility

Every page must clear this section before merging. Findings from the
`accessibility` skill (`docs/ui-qa-checklist.md` cross-references it)
map 1:1 onto the buckets below. Verify at 375 / 390 / 412 / ≥ 1024,
light AND dark, keyboard AND touch.

### 5.1 Color contrast (WCAG 2.1 AA)

- [ ] Body text ≥ **4.5:1** against its background; large text (≥ 18.66 px bold or ≥ 24 px regular) ≥ **3:1**. Verified with `bun run check:wcag:contrast` (or DevTools → Accessibility → Contrast) in BOTH themes.
- [ ] Non-text UI (icon strokes, input borders, focus rings, chart lines, badge borders) ≥ **3:1** against the adjacent surface.
- [ ] Text is set via semantic tokens — `text-foreground` / `text-muted-foreground` / token-derived shades like `text-foreground/60`. No `text-gray-*`, no `text-white`, no `text-black`, no arbitrary hex.
- [ ] Placeholder text uses `placeholder:text-muted-foreground` (token) — never `placeholder:text-gray-400` or opacity below 60 %.
- [ ] Disabled controls keep ≥ 3:1 contrast for the label; do not rely on opacity alone to communicate "disabled" (pair with `aria-disabled` + visible label like "Locked").
- [ ] Status conveyed by color (success / warning / danger badges, chart series, error borders) is ALSO conveyed by an icon, label, or pattern — color is never the only channel.

### 5.2 Focus states (keyboard visibility)

- [ ] Every interactive element (`<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, Radix triggers) shows a visible focus ring when Tab reaches it. Test with keyboard only — never `mousedown`.
- [ ] Focus ring uses the shared tokens: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`. No `focus:outline-none` without a `focus-visible:` replacement.
- [ ] Focus ring has ≥ **3:1** contrast against BOTH the element's own background AND the surrounding page background (check dark theme especially — a `ring-primary` on `bg-primary/10` is a common failure).
- [ ] No `outline: none` / `outline: 0` in `src/styles.css` or component-level CSS without a `:focus-visible` replacement in the same rule.
- [ ] Focus order matches visual order (Tab traverses left-to-right, top-to-bottom). No `tabIndex` > 0 anywhere. `tabIndex={-1}` only on programmatically-focused non-interactive containers (dialogs, live regions).
- [ ] Skip-to-content link is the first Tab stop on every top-level route, visible on focus.
- [ ] Modals, sheets, and menus use Radix (`Dialog`, `Sheet`, `DropdownMenu`, `Popover`) — never hand-rolled focus traps. Escape closes; focus returns to the trigger.
- [ ] `autoFocus` used only inside modals / drawers / dialogs — never on landing pages, forms rendered inline, or search bars in the header.

### 5.3 Tap targets (WCAG 2.5.5, iOS HIG)

- [ ] Every mobile-visible interactive element measures ≥ **44 × 44 CSS px** in its hit area. Verified with `bun run check:a11y:tap-targets` and by inspecting bounding boxes at 375 / 390 / 412 px.
- [ ] shadcn `<Button size="icon">` (36 × 36 by default) is bumped to `min-h-11 min-w-11` (44 × 44) for any primary tap target, or wrapped so the padded parent hits 44 px.
- [ ] Icon-only buttons in list cards (chat / edit / overflow) declare an explicit `h-11 w-11` (or `min-h-11 min-w-11`), NOT `h-9 w-9` + a hover expansion.
- [ ] Table row action columns provide ≥ 44 px vertical rhythm (`py-2.5` = 20 px + 24 px content = 44 px), so every row's tap target is reachable without pinch-zoom.
- [ ] Adjacent tap targets are separated by ≥ **8 px** of non-clickable space (`gap-2` minimum) so users don't miss-tap.
- [ ] Segmented controls, tab bars, and bottom-nav items are ≥ 44 px tall AND ≥ 44 px wide per item — no 44-tall / 32-wide "thumbnail" tabs.
- [ ] Links inline in prose (`<a>` inside a `<p>`) receive `py-1` on mobile so the underlined word is finger-hittable without hitting an adjacent line.

### 5.4 Semantics, ARIA, and forms (from the accessibility skill)

- [ ] Icon-only `<button>` / `<a>` has an `aria-label` (or visible text via `<span className="sr-only">`). No bare `<Button size="icon"><X /></Button>`.
- [ ] Every `<input>`, `<select>`, `<textarea>` is associated with a `<Label htmlFor={id}>` OR carries `aria-label` / `aria-labelledby`. `id`s in list-rendered rows include the row key (`id={\`email-${row.id}\`}`) — no duplicate ids.
- [ ] `onClick` is on `<button>` / `<a>` — NOT on `<div>` / `<span>`. When a wrapper element must be clickable, add `role="button"`, `tabIndex={0}`, and an `onKeyDown` that fires on Enter and Space.
- [ ] Exactly one `<main>` per route, rendered in the layout that owns `<Outlet />` — not inside each page component.
- [ ] Heading levels do not skip (`h1 → h2 → h3`); one `<h1>` per route, matching the page title.
- [ ] Dynamic status updates (toasts, inline validation, loading→loaded transitions, "3 items added") announce via `role="status"` / `aria-live="polite"`, or Sonner toasts (already wired). Never fully silent.
- [ ] `aria-hidden="true"` is NEVER placed on an element that contains focusable children.
- [ ] Lists use `<ul>` / `<ol>` — not stacks of `<div>`s. `<html lang="en">` is set (from `__root.tsx`).

### 5.5 Motion & viewport

- [ ] Full-height layouts use `h-dvh` — not `h-screen` (which under-crops behind the iOS URL bar). Overlays use `min-h-dvh`.
- [ ] All non-essential animation respects `prefers-reduced-motion: reduce` (already enforced by `useReducedMotion()` in framer-motion primitives — verify no direct CSS `@keyframes` bypasses it).
- [ ] No auto-playing motion longer than 5 seconds without a pause control.

### 5.6 Automated gates (must pass in CI)

- [ ] `bun run check:wcag:contrast` — token-pair contrast audit, zero failures.
- [ ] `bun run check:a11y:tap-targets` — bounding-box audit at 375 / 390 / 412, zero failures.
- [ ] `bun run test:visual:mobile-primary-tap-targets` — runtime paint check that FAB, all bottom-nav tabs (Dashboard / Bookings / Payments / Reports / Menu), and per-card chat button measure ≥ 44 × 44 CSS px at 375 / 390 / 412 AND their pixel baselines are green.
- [ ] `bun run test:visual:mobile-primitives` — dark/light snapshots green (regressions surface as diff triptychs in the PR summary).
- [ ] `bun run typecheck` — zero errors (guards against TS7016 / TS2307 regressions that can silently remove a11y props).

---

## 6. Visual regression workflow

Every PR that touches a badge, empty state, or skeleton MUST attach a
device-screenshot triptych and confirm the expected-vs-actual diff is
clean. This section is the short recipe reviewers run before ticking
§ 1 – § 3. Snapshots live in `tests/visual/__snapshots__/` and are
overwritten with `bun run test:visual:mobile-primitives -- -u` ONLY when
an intentional design change is documented in the PR body.

### 6.1 Capture (per surface × per theme × per breakpoint)

- [ ] Run `bun run test:visual:mobile-primitives` locally. It boots the running preview and captures Playwright screenshots at **375 × 812** (mobile) and **1280 × 800** (desktop), in BOTH `[data-theme="ios"]` light and dark.
- [ ] Output triptych (baseline | actual | diff) lands in `tests/visual/__diff__/`. Attach the three affected surfaces to the PR:
  - `badges.<theme>.<viewport>.png` — every tone rendered on a card + on a table row
  - `empty-state.<theme>.<viewport>.png` — icon + title + description + CTA in a card body
  - `skeleton.<theme>.<viewport>.png` — `TableRowsSkeleton`, `KpiCardSkeleton`, `ListSkeleton` on the same route the real data will render on
- [ ] For any NEW surface (new badge tone, new empty state variant, new skeleton primitive) add a fixture route under `tests/visual/fixtures/` and a matching entry in `tests/visual/mobile-primitives.spec.ts` — never snapshot a live route with mutable data.

### 6.2 Compare against expected

- [ ] Zero pixel diff on unchanged surfaces. A diff > 0 on a surface you did NOT edit is a regression — bisect BEFORE re-baselining.
- [ ] For intentional changes: diff must be visually explainable in one sentence in the PR body (e.g. "warning badge switched to token `warning/15` background for AA contrast"). Vague "small tweak" descriptions block merge.
- [ ] Cross-theme parity: the light and dark diffs must describe the SAME change. A change that only appears in one theme means a token is missing its dark counterpart — fix the token, don't accept the diff.
- [ ] Cross-viewport parity: mobile and desktop diffs must describe the SAME change. A mobile-only diff usually means a hardcoded desktop-first size — fix the responsive utility, don't accept the diff.

### 6.3 Re-baseline (only when the diff is intentional)

- [ ] Design change is referenced in the PR description with a link to the design token, Figma frame, or issue that authorized it.
- [ ] Re-baseline in a dedicated commit: `bun run test:visual:mobile-primitives -- -u` — never mix baseline updates with logic changes in the same commit (makes the next regression un-bisectable).
- [ ] Old baseline is deleted, not renamed. `git status` shows only `M` on the affected `__snapshots__/*.png` files — no orphaned `.png` left behind.
- [ ] `bun run test:visual:mobile-primitives` re-run after `-u` exits green with zero diffs.

### 6.4 CI gate

- [ ] `test:visual:mobile-primitives` job on the PR is green. A red job blocks merge — do NOT bypass with "re-run" without a diff explanation.
- [ ] Failing diffs are uploaded as PR artifacts (`visual-diffs.zip`); reviewers open at least one before approving a red-then-green PR.

### 6.5 Pixel-diff budgets (`tests/visual/thresholds.config.json`)

- [ ] Per-test / per-screenshot pixel-diff budgets live in `tests/visual/thresholds.config.json` — NOT inline in specs. Specs call `screenshotOptionsFor(name)` from `tests/visual/_thresholds.ts`; the resolver merges global → per-spec → per-screenshot (glob).
- [ ] Anti-aliasing / font-hinting noise is absorbed via the per-pixel `threshold` knob (0.2 default, raise to **0.25–0.35** for tinted surfaces or icon strokes). Do NOT bump `maxDiffPixelRatio` to hide AA — that also hides real regressions.
- [ ] Element screenshots (< ~100 × 100) use `maxDiffPixels` (absolute cap, e.g. 30–60) instead of `maxDiffPixelRatio`, which rounds to 0 on tiny surfaces.
- [ ] Every new budget entry MUST include a `_why` field explaining the noise source it absorbs — the diff-report renders it inline so reviewers can judge whether the suppression is still justified.
- [ ] After a threshold change, the diff report shows the affected screenshot as **🟡 within budget** with the new budget printed. A **🔴 over budget** entry blocks merge even if the Playwright job passed a lenient run.

---

## Cross-cutting

- [ ] Tap targets ≥ 44×44px on mobile. _(deep dive in § 5.3)_
- [ ] Form inputs ≥ 16px font-size (prevents iOS auto-zoom).
- [ ] No horizontal scroll at 375px.
- [ ] Header rows with text + widgets: `grid grid-cols-[minmax(0,1fr)_auto] sm:flex`, text container gets `min-w-0`, icons get `shrink-0`, single-line titles get `truncate`.
- [ ] Dark theme parity: toggle `[data-theme="ios"]` and re-check every badge/empty/skeleton/divider — none should invert or lose contrast. _(contrast rules in § 5.1)_
- [ ] No console hydration warnings on first paint.
