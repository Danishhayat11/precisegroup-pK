<!--
  Pull-request template for this repository.

  GitHub auto-populates the PR description with this file. Reviewers are
  BLOCKED from approving until every UI-QA checkbox below is ticked.
  Enforcement lives in `.github/workflows/pr-ui-qa-checklist.yml` — it
  fails a required status check whenever an unchecked `- [ ]` remains
  inside the "UI QA checklist" section.

  If the change touches only non-UI code (workflows, docs, migrations
  with no UI surface), tick every box AND add the `no-ui` label to the
  PR — the check treats that label as an opt-out.
-->

## Summary

<!-- 1-3 sentences: what changed and why. -->

## Screenshots / recordings

<!-- Required for any UI change. Attach mobile (390 px) + desktop
     captures for both light and dark themes. Delete this section for
     no-ui PRs. -->

| viewport         | light | dark |
| ---------------- | ----- | ---- |
| iPhone 14 (390)  |       |      |
| Desktop (≥ 1024) |       |      |

---

## UI QA checklist

Reviewers: every box in this section MUST be ticked before approving.
The full rationale for each item lives in
[`docs/ui-qa-checklist.md`](../blob/main/docs/ui-qa-checklist.md).
Verified at **375 px (iPhone SE)**, **390 px (iPhone 14)**,
**412 px (Pixel 7)**, and **≥ 1024 px** desktop, in **light and dark**.

### 1. Status badges

- [ ] Uses shared `<StatusBadge label tone />` — no raw `<span>` with color utilities.
- [ ] Tone comes from `statusTone(label)`; new statuses added to that map.
- [ ] Only the allowed tones (`success | danger | warning | info | muted | neutral`); no hex, no `bg-green-500`, no `text-red-600`.
- [ ] Pill height ~22–24 px, `rounded-full`, never wraps to 2 lines.
- [ ] Same badge = same tone across every page.

### 2. Empty states

- [ ] Uses shared `<EmptyState icon title description action? />` (or `DataTable` `emptyTitle` / `emptyDescription`).
- [ ] `lucide-react` outline icon, `size={40}`, muted foreground, centered above title.
- [ ] Title ≤ 6 words; description explains _why it's empty_ or _what to do next_.
- [ ] Primary CTA present when the user can act; omitted on read-only screens.
- [ ] Vertically centered with `py-12` minimum. No bare "No data" strings.

### 3. Skeleton loading

- [ ] Initial render is a skeleton, not a spinner — uses the shared skeletons in `src/components/ui/skeletons.tsx`.
- [ ] Skeleton mirrors real layout (row/card count, heights ± 4 px, paddings) — no layout shift when data arrives.
- [ ] Uses the `ios-skeleton` shimmer class; no custom `animate-pulse` gradients.
- [ ] Route loaders use `ensureQueryData` + `useSuspenseQuery`; the component does not gate on `isLoading`.
- [ ] Skeleton visible ≥ 200 ms (no flash) and never rendered alongside real data.

### 4. Section dividers

- [ ] Card headers `border-b border-border`; table rows `border-t border-border`; stacked lists `divide-y divide-border`. No hex, no `border-gray-*`.
- [ ] 1 px thickness; `py-4` (mobile) / `py-6` (desktop) around the divider.
- [ ] Every content block sits inside a card, table, or divided list — nothing floats on the page background.
- [ ] Headings above dividers use one consistent style per screen (`text-sm font-semibold uppercase tracking-wide text-muted-foreground` OR `text-lg font-bold`).

### 5. Accessibility _(deep dive in `docs/ui-qa-checklist.md` § 5)_

- [ ] Text ≥ 4.5:1, large text ≥ 3:1, non-text UI ≥ 3:1 — verified in **light and dark**.
- [ ] Only semantic color tokens (`text-foreground`, `text-muted-foreground`, etc.); no `text-gray-*` / `text-white` / hex.
- [ ] Status is never conveyed by color alone — icon or label present.
- [ ] Every interactive element has a visible `focus-visible` ring using the shared tokens (`ring-2 ring-ring ring-offset-2 ring-offset-background`) with ≥ 3:1 contrast in both themes.
- [ ] Focus order matches visual order; no `tabIndex` > 0; skip-to-content link is the first Tab stop.
- [ ] Every mobile tap target ≥ 44 × 44 px; adjacent targets separated by ≥ 8 px. `bun run check:a11y:tap-targets` passes.
- [ ] Icon-only buttons carry `aria-label`; all form inputs are labeled; ids in lists include the row key (no duplicate ids).
- [ ] Exactly one `<main>` per route; heading levels don't skip; dynamic updates announce via `role="status"` / `aria-live` / Sonner.
- [ ] Modals / sheets / menus use Radix (no hand-rolled focus traps); Escape closes, focus returns to trigger.
- [ ] Full-height layouts use `h-dvh` (not `h-screen`); animation respects `prefers-reduced-motion`.
- [ ] `bun run check:wcag:contrast` — green.

### Cross-cutting

- [ ] Tap targets ≥ 44 × 44 px on mobile. _(deep dive in § 5.3)_
- [ ] Form inputs ≥ 16 px font-size (prevents iOS auto-zoom).
- [ ] No horizontal scroll at 375 px.
- [ ] Header rows: `grid grid-cols-[minmax(0,1fr)_auto] sm:flex`, text container `min-w-0`, icons `shrink-0`, single-line titles `truncate`.
- [ ] Dark theme parity: toggled `[data-theme="ios"]` and re-checked every badge / empty / skeleton / divider — no inversion, no contrast loss. _(contrast rules in § 5.1)_
- [ ] No console hydration warnings on first paint.
- [ ] `bun run test:visual:mobile-primitives` passes locally (or the CI job is green with intentional baseline updates committed).

---

## Non-UI opt-out

If this PR has zero UI surface (workflow, docs, migration with no rendered
change), tick every box above AND add the **`no-ui`** label to opt out of
the checklist enforcement.
