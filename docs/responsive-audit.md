# Responsive Audit — mobile / tablet / desktop

Date: 2026-07-05
Scope: Dashboard, `/site` marketing, Auth, and every route in `src/routes/_authenticated/`.

## Method

Playwright drove the running dev server at three viewport widths, once per route:

| Class   | Width × Height |
| ------- | -------------- |
| Mobile  | 390 × 844      |
| Tablet  | 820 × 1180     |
| Desktop | 1440 × 900     |

For every route × viewport the audit measured:

- `documentElement.scrollWidth − innerWidth` (horizontal overflow)
- Any element whose bounding box extended past the viewport right edge
- A full-page screenshot for visual inspection

Authenticated routes used the injected Supabase session so the real dashboard,
sidebar drawer, and data pages rendered — not the placeholder / redirect shell.

Audit scripts and screenshots: `/tmp/browser/responsive/` (audit.py, audit_auth.py, shots/).

## Routes audited

Public: `/`, `/site`, `/site/services`, `/site/projects`, `/site/contact`, `/login`, `/resources/property-management-vs-erp`.

Authenticated: `/` (dashboard), `/bookings`, `/payments`, `/ledger`, `/reports`,
`/clients`, `/projects`, `/settings`, `/adjustments`, `/documents`, `/import`,
`/my-requests`, `/health`, `/admin`, `/audit`, `/security-dashboard`,
`/security-review`.

## Results

**Zero horizontal-overflow findings.** 0 offending elements across
7 public × 3 widths + 17 authenticated × 3 widths = 72 route/viewport checks.

Visual spot-checks at 390 px confirmed:

- **`/site`** — sticky header collapses to hamburger; hero H1 wraps cleanly;
  CTAs stack vertically; brand row wraps to two lines without clipping.
- **`/login`** — sign-in card centers, full-width email/password fields,
  primary button spans width, helper copy wraps.
- **Dashboard (`/`)** — `AppShell` renders the hamburger + search + notifications
  in a single row (grid-cols-[minmax(0,1fr)_auto] pattern); KPI grid stacks to
  a single column; sidebar collapses to an off-canvas drawer.
- **Data pages** (`/payments`, `/ledger`, `/bookings`) — content column stays
  inside the viewport; tables scroll horizontally inside their own container
  rather than pushing the page width out.

## Findings by category

| Check                                                                                  |                                                        Result                                                        |
| -------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------: |
| Horizontal overflow at 390 px                                                          |                                                       ✅ none                                                        |
| Horizontal overflow at 820 px                                                          |                                                       ✅ none                                                        |
| Horizontal overflow at 1440 px                                                         |                                                       ✅ none                                                        |
| `h-screen` used where `h-dvh` needed                                                   | ✅ only in `src/pages/Index.tsx` placeholder (intentional) and `ui/toast.tsx` (toast list max height, correct usage) |
| Header rows use `grid-cols-[minmax(0,1fr)_auto]` + `min-w-0` / `shrink-0` / `truncate` |                          ✅ AppShell, PageHeader, DashboardHero already follow the pattern                           |
| Sidebar mobile drawer + always-visible trigger                                         |        ✅ shadcn `SidebarProvider` with `collapsible="offcanvas"`; trigger sits in header outside the sidebar        |
| Login viewport-safe on mobile                                                          |                                ✅ card centers within `min-h-dvh`, inputs full-width                                 |
| Tap targets on primary icon-only controls                                              |                          ✅ 44 × 44 minimum on hamburger, search, notification bell, avatar                          |

## Changes made

None — the responsive foundation was already correct. The earlier a11y pass
had already migrated header rows to the responsive grid pattern, swapped
`h-screen` for `h-dvh` on full-height layouts, and added the mobile hamburger
to the site shell.

## Known intentional limitations

- **Print-only routes** (`/print-ledger/*`, `/test-long-receipt`,
  `/test-print-modal`) are laid out for A4 paper by design; they are not
  audited for mobile fitness.
- **`src/pages/Index.tsx`** is a hardcoded placeholder page (marked
  `allow-raw-color`) — intentionally off-token until replaced.
- **Toast list** uses `max-h-screen` to bound the stack against the visual
  viewport, which is the intended behavior for `@radix-ui/react-toast`.

## Re-run

```bash
python3 /tmp/browser/responsive/audit.py       # public routes
python3 /tmp/browser/responsive/audit_auth.py  # requires injected session
```

Both scripts print a per-route/per-viewport summary; a non-zero `overflow` on
any row is a regression.
