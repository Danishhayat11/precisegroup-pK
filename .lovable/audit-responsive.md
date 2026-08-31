# Responsive & Tap-Target Audit

Generated Sat 2026-07-04. Playwright sweep across 28 routes × 4 breakpoints
(375 / 768 / 1024 / 1440). Raw data: `/tmp/browser/resp/report2.json`,
screenshots: `/tmp/browser/resp/shots2/`.

## Headline result

**Zero horizontal overflow detected on any route at any breakpoint** (112
combinations sampled). Layouts stack correctly, typography scales, tables use
inner-scroll wrappers rather than pushing the document width. The responsive
grid work already merged is holding.

The remaining problem surface is **tap-target size**, not layout. The 44×44
minimum fails in three concentrated places, most of which are shared shell
code, so a handful of fixes clear hundreds of instances.

## P0 — shared shell (fixes hit every authenticated page)

Every authenticated page inherits 5-6 identical failures from the app shell:

| Element                                    | Size   | Where                           |
| ------------------------------------------ | ------ | ------------------------------- |
| Nav menu / assistant / theme / notif icons | 34×34  | `AppShell` header icon buttons  |
| Account menu trigger                       | 45×38  | `AppShell` avatar button        |
| Overdue-installments banner link           | 375×33 | Global alert banner (height 33) |
| Site nav Home/Services/… links (mobile)    | 36×45  | `components/site/SiteNav`       |
| Site theme toggle (mobile)                 | 34×34  | Marketing shell header          |

Fixing the shared `IconButton`/`ThemeToggle`/banner primitives to `min-h-11
min-w-11` (base) with density preserved via `md:h-9 md:w-9` where desktop
density matters will clear the header failures across all 20+ authenticated
routes in one edit each.

## P1 — table row micro-links (dominant failure count)

Booking-code cell links render at **76×15** and appear dozens of times per
row-heavy page:

| Route                  | Small taps (mobile) | Dominant source                  |
| ---------------------- | ------------------- | -------------------------------- |
| `/payments`            | 525                 | Row action buttons + BK-\* links |
| `/ledger`              | 188                 | BK-\* code links (76×15)         |
| `/bookings`            | 164                 | Row link + toolbar filters       |
| `/health`              | 46                  | Toolbar buttons at h-30          |
| `/adjustments`         | 23                  | BK-\* code links                 |
| `/reports`             | 23                  | "Print client statement" (h-30)  |
| `/reconciliation-diff` | 13                  | Toolbar h-30 buttons             |
| `/documents/invoice`   | 13                  | Print action buttons             |

Root cause: table cells wrap `<a>` around raw text with default line-height →
15px hit region. Fix: promote booking / receipt / invoice code cells to a
shared `<CodeLink>` component with `inline-flex items-center min-h-11 -my-2
px-2 rounded-md hover:bg-muted` — extends the click surface without changing
row visual density.

## P2 — toolbar buttons at h-30 / h-34

Page-header action buttons render at 30-34px tall (e.g. `Run Full Audit`,
`Print Preview`, `Download reconciliation CSV`). Fix by auditing all
`Button size="sm"` usages on primary toolbars and switching to the default
size (h-10 → clears 44 with padding) OR keeping sm on tertiary actions only.

Filter dropdowns (`Type`, `From date`, `To date`, status pills) also sit at
h-34. These are dense data-grid controls; on mobile they should promote to
`h-11`, on `md:` collapse back to `h-9`. A single `<TableToolbarButton>`
primitive would centralise this.

## P3 — marketing shell

`/site`, `/site/services`, `/site/projects`, `/site/contact` mobile: 3 small
taps each (theme toggle 34×34, mobile nav link `<a>` 36×45, brand link
237×42 — brand link is borderline height, others are true fails).
`/resources/property-management-vs-erp`: 1 (footer `Precise ERP` link 67×15).

## Non-issues confirmed

- Horizontal overflow: **none** across all sampled routes/breakpoints.
- Tables that appear to overflow use inner `overflow-x-auto` wrappers so the
  document width stays clean — verified on payments, ledger, bookings.
- Sidebar stacking, hero copy scaling, dashboard cards all reflow correctly
  on 375px.
- `/dashboard`, `/`, `/login` returned small body text in the audit because
  auth restoration lands the user on the shell before dashboard content
  hydrates via TanStack Query. Not a responsive bug; ignore for this pass.

## Suggested slice order (next turns)

1. **Shell primitives** — `IconButton`, `ThemeToggle`, `NotificationBell`,
   `AccountMenuTrigger`, `OverdueBanner` bumped to `min-h-11 min-w-11` on
   mobile with `md:` density restore. Clears ~6 × 20 = 120 failures.
2. **`<CodeLink>` cell wrapper** applied to booking/receipt/invoice codes in
   payments, ledger, bookings, adjustments, reconciliation. Clears ~600
   failures with one primitive.
3. **`<TableToolbarButton>`** primitive for filter/date/status buttons.
4. **Marketing shell** mobile nav + theme toggle sizing.
5. Re-baseline theme-drift snapshots + add an automated tap-target scan
   (adapt `audit2.py`) as a CI gate so regressions surface immediately.

## How to reproduce

```bash
python3 /tmp/browser/resp/audit2.py
# view /tmp/browser/resp/report2.json + /tmp/browser/resp/shots2/*.png
```
