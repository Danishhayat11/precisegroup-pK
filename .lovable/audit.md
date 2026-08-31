# App-wide Audit — Findings

> Generated 2026-07-04. Read-only audit; no code changes shipped this turn.
> Evidence: static scan across 26 pages + 200+ components, Playwright
> screenshot sweep of 10 authed pages × 3 breakpoints (mobile 375,
> tablet 768, desktop 1280). Screenshots at `/tmp/browser/audit/screenshots/`.

## Legend

| Severity | Meaning                                                           |
| -------- | ----------------------------------------------------------------- |
| **P0**   | Broken behavior users hit today (advertised feature doesn't work) |
| **P1**   | Consistent UX gap (missing states / mobile breakage / a11y)       |
| **P2**   | Polish — dead code, redundant styling, minor inconsistency        |

Effort: **S** ≤ 1h · **M** ≤ 4h · **L** ≥ 1 day
Risk: **L**ow — presentational, no data path change; **M**ed — component
refactor with test impact; **H**igh — touches business logic (payments /
ledger / reconciliation).

---

## P0 — Broken advertised features

### 1. Global search input in the header is inert

- **Where:** `src/components/AppShell.tsx` lines 219–229
- **What:** Header renders an `<Input placeholder="Search bookings, clients, units, receipts…">` with a `⌘K` keyboard hint. No `onChange`, `onFocus`, `onKeyDown`, no CommandDialog trigger, no ⌘K listener anywhere in the file (grep: 0 handlers).
- **Impact:** Every user who tries the primary search field or ⌘K gets nothing. This is the top-nav's most prominent affordance.
- **Fix shape:** Wire `Input` (and a `keydown` listener on `document`) to open a `CommandDialog` (`src/components/ui/command.tsx` — already installed) with search over bookings, clients, units, receipts. Debounced supabase query, keyboard navigation, ⌘K + ⌘⇧K support.
- **Effort / Risk:** M / L

### 2. Notifications bell button is inert

- **Where:** `src/components/AppShell.tsx` lines 232–234
- **What:** `<Button aria-label="View notifications"><Bell/></Button>` with no `onClick`, no popover, no unread-count binding.
- **Impact:** Accessible name promises an action; nothing happens. Screen-reader users are especially misled.
- **Fix shape:** Either wire to a real notifications surface (requires a schema — the app has `assistant_messages` + `audit_logs` but no user-notifications table) or remove the button until it has a backing feature.
- **Effort / Risk:** M / L (remove) · L / M (build)

---

## P1 — Missing functional states

### 3. Query pages without error branches — 14 of 22

Pages that fetch via `useQuery` / `useSuspenseQuery` but have **no** `isError`, `.error`, or in-page error UI. When the query fails, they render "Loading…" forever or a bare table shell.

| Page                           | Queries | Skeleton | Empty | Error |
| ------------------------------ | ------- | -------- | ----- | ----- |
| Adjustments.tsx                | 2       | —        | —     | —     |
| AuditLog.tsx                   | 2       | —        | ✓     | —     |
| BookingDetail.tsx              | 3       | ✓        | —     | —     |
| Bookings.tsx                   | 4       | —        | ✓     | —     |
| Clients.tsx                    | 2       | —        | —     | —     |
| Ledger.tsx                     | 2       | —        | —     | —     |
| MyRequests.tsx                 | 4       | —        | ✓     | —     |
| PaymentEditHistoryPage.tsx     | 2       | —        | ✓     | —     |
| Payments.tsx                   | 4       | —        | ✓     | —     |
| PlanRestructureHistoryPage.tsx | 2       | —        | ✓     | —     |
| Projects.tsx                   | 3       | —        | —     | —     |
| Reports.tsx                    | 2       | —        | ✓     | —     |
| Settings.tsx                   | 3       | —        | —     | —     |
| Units.tsx                      | 2       | —        | —     | —     |

- **Fix shape:** Introduce a small `<QueryState query={q} skeleton={<TableSkeleton rows={8} />} empty={…}>` wrapper (or an `errorComponent` on the route file) so every query renders one of {skeleton, error, empty, data} — never "silently empty".
- **Effort / Risk:** M / L per page × 14; or single shared component + route-level error boundaries in one turn.

### 4. Plain "Loading…" text instead of Skeletons — 11 sites

Grep found 11 places using `Loading…` in raw text. Skeleton components exist (`src/components/ui/skeleton.tsx`) but aren't used here.

- `src/pages/Bookings.tsx:259` — table body loading row
- `src/pages/Users.tsx:101` — table body (see mobile screenshot: reads as broken page)
- `src/pages/BookingDetail.tsx:44` — full-page fallback
- `src/pages/Units.tsx:38`, `Reports.tsx:21`, `MyRequests.tsx:195`
- `src/pages/PaymentEditHistoryPage.tsx:57`, `PlanRestructureHistoryPage.tsx:40`
- `src/components/DocumentVault.tsx:553`, `PaymentCommentsPanel.tsx:150`, `PaymentHistoryDialog.tsx:162`

- **Fix shape:** Replace with `<Skeleton>` rows / cards matching final layout. Consistent perceived-performance win.
- **Effort / Risk:** S / L each — mechanical.

### 5. Empty states — 15 of 22 pages lack one

Same grid as above: 15 pages have no visible "no data yet" surface. On a fresh install / newly-cleared filter, users see a bare page. Notable: **Adjustments, Clients, Ledger, Projects, Settings, Units** have neither empty nor error UI.

- **Fix shape:** Reuse existing `<EmptyState>` (`src/components/EmptyState.tsx`) — same visual language everywhere, add an actionable CTA when the empty state is caused by a filter (`Clear filters`).
- **Effort / Risk:** S / L each.

---

## P1 — Responsive / mobile breakage

### 6. Header search input truncates on mobile (375) and tablet (768)

- **Evidence:** `mobile-*.png`, `tablet-*.png` — placeholder reads "Sear…" (mobile) or "Search bookin…" (tablet).
- **Cause:** `max-w-xl` on the search wrapper + fixed pixel padding + no min-width management. The input still occupies the row but truncates.
- **Fix shape:** Below `md`, replace input with an icon-only trigger that opens the CommandDialog full-width (ties into finding #1).
- **Effort / Risk:** S / L (bundled with fix #1).

### 7. Wide data tables clip past viewport — Bookings, Ledger, Payments

- **Evidence:** `mobile-bookings.png` clips "TYPE" column and further; `mobile-ledger.png` clips "DUE DATE"; horizontal scroll exists but no scroll hint / fade edge / column priority.
- **Fix shape:** Two options per table — (a) wrap in `overflow-x-auto` with edge-fade + scroll shadows; (b) collapse to card layout below `sm`. Option (b) preferable for the highest-traffic tables (Bookings, Payments).
- **Effort / Risk:** M / M — table structure change, needs visual baselines re-run.

### 8. `AppShell` sidebar consumes 33% of a tablet viewport

- **Evidence:** `tablet-dashboard.png` — fully expanded sidebar (~250px) at 768 leaves ~518px for content. Skeletons render only two-across cards where mobile shows one-across (fine) and desktop shows four (expected).
- **Fix shape:** Default sidebar to collapsed (`w-14`, icon-only) below `lg`, expandable via SidebarTrigger. Reclaim ~200px on tablet.
- **Effort / Risk:** M / M — need to verify shortcut/hover reveal doesn't clash with existing `SidebarProvider` state.

### 9. `h-screen` vs `h-dvh`

- **Where:** grep `h-screen` in pages — appears on Login, DocumentView, print modal.
- **Impact:** Address-bar chrome causes 100vh calc bugs on iOS Safari.
- **Fix:** Swap to `h-dvh` on all interactive full-height layouts (keep `h-screen` on print — physical page unit).
- **Effort / Risk:** S / L.

---

## P1 — Accessibility

### 10. Icon-only buttons without `aria-label` — up to 32 of 39

- **Evidence:** 39 `size="icon"` buttons across `src/`; only 7 explicitly carry `aria-label`. Some inherit via `<TooltipTrigger asChild>` or wrapped context; count is an upper bound.
- **Fix shape:** Sweep — add `aria-label` where absent. shadcn Button + Radix Tooltip already ARIA-correct when labels are provided.
- **Effort / Risk:** S / L.

### 11. Focus-visible rings inconsistent

- Some custom action pills (see `Dashboard.tsx` KPI cards) lack the `focus-visible:ring-*` chain the `ThemeToggle` component uses.
- **Fix shape:** Extract the focus-ring class chain into a `@utility focus-ring` in `styles.css` and apply consistently.
- **Effort / Risk:** S / L.

---

## P2 — Missing / half-implemented features

### 12. No dedicated `/profile` route

- Account info lives under `/settings` (Email + Role rows). The user-menu dropdown routes to `/settings` for "Settings".
- **Verdict:** _Not a bug_ — this is a design choice consistent with small-team ERPs. Only revisit if you want per-user display name / avatar upload / notification prefs. If yes, promote Account section from Settings into a `/settings/profile` sub-route + add a "Profile" item to the user dropdown.
- **Effort / Risk:** M / L (new sub-route).

### 13. Breadcrumbs

- `src/components/ui/breadcrumb.tsx` is scaffolded but never imported by any page. Deep routes (`/bookings/$id`, `/admin/payment-edit-history`, `/documents/$type`) have no back-context beyond the browser Back button.
- **Verdict:** Optional — the app's sidebar already exposes top-level nav clearly. Recommend adding breadcrumbs **only** on 2+ level-deep routes (BookingDetail, DocumentView, admin subpages, PaymentEditHistoryPage, PlanRestructureHistoryPage) — 6 routes total.
- **Effort / Risk:** S / L.

### 14. `PreciseAssistantPanel` shortcut promised but not verified

- SidebarBody shows `⌘⇧A` next to "AI Assistant"; need to confirm the global keydown listener is wired.
- **Effort / Risk:** S / L to verify + fix.

---

## P2 — Codebase hygiene

### 15. `Index.tsx` is a placeholder page

- `src/pages/Index.tsx` — still a `PlaceholderIndex` with a hex-tinted div and `placeholder.svg`. Not routed anywhere in `_authenticated/` (the auth-gated home is `_authenticated/index.tsx → Dashboard`), so this file only ships if something imports it. **Verify** by grep; if unreferenced, delete.
- **Effort / Risk:** S / L.

### 16. Grandfathered `allow-raw-color-file` markers — 8 pages

- Debt from the color-audit guardrail turn: `Login`, `AuditLog`, `MyRequests`, `Documents`, `Dashboard`, `DataHealth`, `ReconciliationDiff`, `ImportCenter` each carry a whole-file color opt-out for legacy palette utilities pending semantic-token migration.
- **Fix shape:** Mechanically migrate to `bg-warning / bg-success / bg-destructive / bg-info` semantic tokens. Each file is a self-contained refactor; the 16 committed visual baselines and the guardrail catch regressions immediately.
- **Effort / Risk:** M / L per file × 8. Order: smallest first (Login, AuditLog, MyRequests) → largest (ImportCenter 36 hits, DocumentView-exempt).

### 17. Dead / dev-only routes surface in prod

- `builder-checklist`, `chart-preview`, `fit-tester`, `health-check`, `theme-preview`, `token-reference`, `visual-qa`, `test-long-receipt`, `test-print-modal`, `test-throw` — dev routes shipped without gating. Sitemap / crawler exposure risk.
- **Fix shape:** Gate under `import.meta.env.DEV` OR move to a `.dev.tsx` naming convention the router ignores in prod. At minimum, add `robots: noindex` to each `head()`.
- **Effort / Risk:** S / L.

### 18. `Dashboard.tsx` is 3,509 lines

- Single-file ownership of KPIs + banners + diagnostics + charts + tables + drill-downs. Hard to review, hard to test, hard to code-split.
- **Fix shape:** Extract by concern — `DashboardKpis.tsx`, `DashboardCharts.tsx`, `DashboardOverdueTable.tsx`, keep the route file <400 lines. Behavior-preserving refactor; the visual baseline catches drift.
- **Effort / Risk:** L / M — worthwhile but needs its own turn.

---

## What I did NOT find (good news)

- **Design system**: Navy #1B2B4B + Gold #C9A84C tokens present with full light/dark ramps in `src/styles.css`; semantic status tokens (`success`, `warning`, `destructive`, `info`) exist and are wired via `@theme inline`. `PageHeader` component **is** used on 20+ pages.
- **Skeleton loading on Dashboard**: Already implemented and looks clean on mobile.
- **UserMenu**: Avatar dropdown with Settings + Sign out already present in `AppShell` header.
- **Global search UI**: Component is in place — just needs behavior wired (finding #1).
- **Auth**: `_authenticated` layout gates all business routes; sign-out already navigates to `/login`.
- **Color guardrail + visual regression**: Recently landed and protecting drift.
- **Error boundary**: `DashboardErrorBoundary` on `/`, route-level `errorComponent` on the same route.

---

## Recommended next turn — smallest useful slice

If you want a single high-value follow-up turn, do these together (bundles well, low risk):

1. **Wire global search + ⌘K CommandDialog** (P0 #1) — closes the most visible broken promise; simultaneously fixes mobile/tablet header truncation (P1 #6) by making the button collapse to an icon.
2. **Route-level `errorComponent`** on the 14 query pages missing error UI (P1 #3) — one shared component, ~10 lines added per route.
3. **Skeleton sweep** — replace the 11 raw "Loading…" strings (P1 #4).
4. **Dead-route noindex** (P2 #17) — trivial `head: { meta: [{ name: "robots", content: "noindex,nofollow" }] }` on 10 dev routes.

Estimated total: one focused turn, all Low-risk. Leaves the big-ticket items (notifications feature, sidebar tablet collapse, Dashboard extraction, palette redesign, semantic-token migration) for you to prioritize individually.

---

## What I still need from you

- **Design direction call**: You picked "Not sure — show me options" for the palette. Say the word and I'll capture the current dashboard, run the redesign ritual (palette / type / layout picks → 3 rendered directions), and hold implementation until you pick one. This is a separate track from the fixes above — do not bundle.
- **Which slice to build first**: default is the "smallest useful slice" above. If you want a different order (e.g. "just tables on mobile" or "notifications feature"), say so.
