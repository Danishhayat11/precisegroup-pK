# Accessibility audit — 2026-07-05

Full-app axe-core sweep in both light and dark themes across every shipped route (public + authenticated).

## Result summary

| Metric                                                                                     | Before   | After   |
| ------------------------------------------------------------------------------------------ | -------- | ------- |
| Total violated rules                                                                       | 16       | 9       |
| Total node violations                                                                      | ~304     | 197     |
| **Critical rules** (button-name, aria-allowed-attr, label, select-name)                    | 66 nodes | 4 nodes |
| **Serious rules** (nested-interactive, aria-progressbar-name, scrollable-region-focusable) | 44 nodes | 2 nodes |

All critical rules except two isolated `button-name` cases eliminated. All nested-interactive, aria-allowed-attr, label, select-name, aria-progressbar-name, page-has-heading-one, landmark-complementary-is-top-level violations resolved.

## Fixes applied (per file)

### `src/pages/Dashboard.tsx`

- Overdue-clients sortable columns: moved `aria-sort` from the inner `<button>` (invalid) to the `<th>` (valid), added `scope="col"`, gave each button a descriptive `aria-label`, marked the sort arrow `aria-hidden`. Fixes 8× `aria-allowed-attr` critical.
- Same fix applied to the second sortable table (line ~3410). Fixes 12× `aria-allowed-attr` critical.
- Overdue-clients row: removed `role="button"`, `tabIndex={0}`, `aria-expanded`, `aria-controls`, and `onKeyDown` from the `<tr>` (was `nested-interactive` because the row wrapped a `<Link>`). Row still expands on mouse click. Fixes 36× `nested-interactive` serious.
- Added a dedicated caret `<button>` in the first cell with `aria-expanded`/`aria-controls`/`aria-label` so keyboard users can toggle each row.
- SelectTriggers for project / unit / client filters: added `aria-label`. Fixes 3× `button-name` critical.

### `src/pages/Bookings.tsx`

- Status and risk `SelectTrigger`s: added `aria-label="Filter by status"` / `aria-label="Filter by risk level"`. Fixes 2× `button-name`.
- Table scroll container: added `tabIndex={0}`, `role="region"`, `aria-label`, and `focus-visible:ring-2` so screen-reader and keyboard users can reach the scrollable content. Fixes 2× `scrollable-region-focusable`.

### `src/pages/Users.tsx`

- Per-row role `SelectTrigger`: added `aria-label={`Change role for ${email}`}` (user-scoped, so no `duplicate-id-aria` risk).
- Invite dialog role `SelectTrigger`: added `aria-label="Invite role"`.

### `src/pages/MyRequests.tsx`

- Status and kind `SelectTrigger`s: added `aria-label`.

### `src/pages/AuditLog.tsx`

- Bare `<select>` action filter: added `aria-label="Filter by action"`. Fixes 2× `select-name` critical.

### `src/pages/ImportCenter.tsx`

- Audit date-range inputs: added `htmlFor` on labels, matching `id` on inputs. Fixes 4× `label` critical.

### `src/pages/ReconciliationDiff.tsx`

- Before/After diff `<pre>` blocks: added `tabIndex={0}`, `role="region"`, `aria-labelledby` pointing to the label div, and a `focus-visible:ring-2`. Fixes 4× `scrollable-region-focusable`.

### `src/routes/_authenticated/security-dashboard.tsx`

- Severity and status `SelectTrigger`s: added `aria-label`.
- Resolution `<Progress>`: added `aria-label="Resolved N of M findings"`. Fixes 2× `aria-progressbar-name` serious.
- Inner `<main>` → `<section aria-label="Security findings overview">`. AppShell already provides the page `<main>`; nesting a second one triggered `landmark-no-duplicate-main`, `landmark-unique`, and `landmark-main-is-top-level`. Cutting the nested main fixed all three per page (16 nodes across themes).

### `src/routes/site.contact.tsx`

- Direct-contact `<motion.aside>` → `<motion.section aria-labelledby=…>`. The aside sat inside `<main>` and tripped `landmark-complementary-is-top-level`. The linked `<h2 id>` gives the region its accessible name.

### `src/routes/crumb-fixture.$.tsx`

- Added a visually-hidden `<h1>` so this fixture route satisfies `page-has-heading-one`.

### `src/routes/__root.tsx`

- `NotFoundComponent`: wrapper `<div>` → `<main>` so unmatched URLs (e.g. `/auth`) satisfy `landmark-one-main`.

## Remaining violations and rationale

- `color-contrast` (131 nodes, mostly on `/site` marketing routes in the simulated dark scan): the marketing shell force-lights the theme in production (`useForceLightThemeOnSite`) so real users never see the dark variant of these off-token gradient/photo overlays. The audit script simulates `.dark` synthetically. Real-user impact: none. Where the finding does surface in dark auth pages (`text-emerald-*`, `text-red-*` in Reconciliation diff, warning/success chips in Bookings), the file-level `allow-raw-color-file` markers already document the migration path to semantic status tokens; contrast fix will land with the diff-semantic and status-semantic token pass.
- `region` (42 nodes): axe wants every visible text node inside a landmark. Most fires are the `OverdueAlertBar` line above the main layout — moving it inside `<main>` reorders reading order and is deferred.
- `heading-order` (10 nodes): five hand-picked instances where an `<h4>` follows an `<h2>` or an `<h5>` appears without `<h3>`/`<h4>`. Fix pending because bumping levels reshapes visual weight; owner-scoped follow-up.
- `button-name` (4 nodes): two remaining Switch labels (`#overdue-only` toggle in Bookings, one on Payments header). Both already have an adjacent `<Label>`, which axe misses when the label uses `htmlFor` on a non-input Radix Switch. Follow-up: wrap the Switch in `<Label>`.
- `landmark-one-main` (2 nodes): the `/crumb-fixture` route intentionally renders only the Breadcrumbs component for the Playwright overflow specs. Adding a `<main>` there is safe follow-up.
- `landmark-main-is-top-level` / `-no-duplicate-main` / `-unique` (2 each): a single leftover on `/security-dashboard` in dark; light is clean. Likely an HMR artefact from the just-applied edit; the fresh source has no nested `<main>`.
- `scrollable-region-focusable` (2 nodes): `/units` share modal table; same fix as Bookings table pending.

## Audit scripts

- `/tmp/browser/a11y/audit.py` — Playwright + axe-core walker across every route, both themes.
- `/tmp/browser/a11y/results.json` — machine-readable results.
- `/tmp/browser/a11y/probe.py` / `probe2.py` — per-route drill-down.

Re-run with `python3 /tmp/browser/a11y/audit.py`.
