# Perfect for iPhone — ERP app

Four passes, executed in order. Each pass ends with a visual-regression baseline update so nothing silently regresses later.

Target widths locked to **375 / 390 / 430 px** (iPhone SE, iPhone 14, 15 Pro Max). Dark + light theme parity checked on every pass.

---

## Pass 1 — Known-bug fixes (quick, no design risk)

1. **CRM `/crm` mobile header** — "Leads" H1 currently dark navy on dark navy. Swap to header-foreground token, verify contrast ≥ 4.5:1 in both themes. Fix the search input placeholder icon artifact.
2. **Bookings FAB overlap** — floating `+` covers the per-card chat button on the bottom-right card. Add safe bottom offset (`bottom-[calc(env(safe-area-inset-bottom)+96px)]` on mobile) or hide the FAB when a card action is within the tap radius. Verify with the mobile-primitives snapshot suite.
3. **ThemeToggle hydration warning** — `style.opacity: "1"` (string) vs `1` (number) mismatch. Normalize to numeric in the motion.span initial/animate values.

**Deliverable:** 3 files touched, existing `test:visual:mobile-primitives` re-baselined, hydration console clean.

---

## Pass 2 — iOS-native feel across the shell

Global shell upgrades, applied once, benefit every page.

- **Large title headers** on scroll-top, collapsing to a compact inline title on scroll — like Mail/Settings. Uses `IntersectionObserver` on the page-title element, no layout thrash.
- **iOS bottom sheets** replace `<Dialog>` on mobile for: New booking, Record payment, Add lead, Filters. Desktop keeps centered dialogs. Uses vaul's `<Drawer>` (already in deps) with snap points `[0.5, 1]`, drag handle, backdrop dim.
- **Segmented controls** replace tab bars on Bookings (Status filter) and Payments (Type filter) — iOS-native pill segmented style using existing Tabs primitive + new `variant="segmented"`.
- **Springy page transitions** — replace current fade with a horizontal push (`x: 12 → 0`, opacity 0 → 1, 220ms `cubic-bezier(0.32,0.72,0,1)`) that respects `prefers-reduced-motion`.
- **Sticky sub-headers** — filters/search rows stick to the top of the scroll container on mobile so long lists stay actionable.
- **Toast placement** — bottom-center on mobile (thumb-reachable), top-right on desktop. Sonner already responsive; move mobile origin from top-center → bottom-center with safe-area padding.
- **Pull-to-refresh** — native browser gesture only, plus a subtle SF-Symbols-style spinner during query refetch. No custom pull physics.

**Deliverable:** one shared `MobileSheet` + `MobileLargeTitle` + `SegmentedControl` in `src/components/ui/`, applied across the app.

---

## Pass 3 — Page-by-page sweep

For each page: audit spacing, type scale, card density, empty/loading states, tap targets, horizontal overflow at 375px, then apply fixes.

Order & focus:

1. **Dashboard** — collapse KPI grid to 2-up cards on mobile with condensed values; single-column hero; move overdue banner to a sticky pill above the tab bar.
2. **Bookings** — mobile cards get a compact info row (Sale price + status pill), swipe-right → Ledger, swipe-left → Edit (Framer Motion `useDrag`). Booking detail becomes a full-screen sheet, not a modal.
3. **Payments** — receipt cards get a leading amount column, currency prefix aligned right, print icon moves to a card-level overflow menu.
4. **Clients** — table → grouped card list on mobile, sticky alphabet index on the right edge, tap-to-call / tap-to-WhatsApp actions inline.
5. **CRM /crm** — Kanban stays desktop-only; mobile shows a segmented pipeline picker + card feed. Fixes header contrast (from Pass 1) permanently.
6. **Maintenance** — KPI trio becomes horizontal-scroll card row, empty state gets a "Set up on desktop" secondary action.

**Deliverable:** each page verified against `test:visual:mobile-primitives` (extend suite to cover new surfaces).

---

## Pass 4 — Installed-app polish (Add-to-Home-Screen)

- **Apple splash screens** for each iPhone size (SE, 14, 14 Plus, 14 Pro, 14 Pro Max, 15 Pro Max) — auto-generated from a source PNG, referenced via `<link rel="apple-touch-startup-image" media="…">` in `__root.tsx`.
- **Apple touch icons** — 180×180 with proper padding, no transparency (iOS masks it), matching manifest theme color.
- **Status bar tuning** — `apple-mobile-web-app-status-bar-style: black-translucent` so the app draws under the notch; combined with the safe-area-top padding already in the shell.
- **Standalone-mode chrome** — hide "install this app" prompts when `display-mode: standalone`, show a compact "Open in Safari" affordance for external-link taps.
- **Offline banner** — thin sticky pill at the top when `navigator.onLine === false`, shows cached-data notice. Uses existing offline.html for hard-offline navigations.

**Deliverable:** manifest verified in Lighthouse Installability, splash + icon set committed under `public/apple/`.

---

## Verification

After each pass:

- `bun run test:visual:mobile-primitives` (re-baseline on intentional changes)
- `bun run check:a11y:tap-targets` — no target < 44×44 px
- `bun run check:wcag:contrast` — no new contrast failures
- Manual review at 375 / 390 / 430 px, light + dark themes
- Playwright script captures the six primary pages at all three widths → attach screenshots to the pass summary

---

## Technical details

- **New primitives:** `src/components/ui/mobile-sheet.tsx` (vaul wrapper), `src/components/ui/mobile-large-title.tsx`, `src/components/ui/segmented-control.tsx`.
- **Motion utility:** `src/lib/motion.ts` centralizes the iOS timing curve + reduced-motion helper so every animation uses the same spring.
- **Safe-area helpers:** extend `src/styles.css` with `.pt-safe`, `.pb-safe`, `.px-safe` utilities; replace ad-hoc `env(safe-area-inset-*)` inline styles.
- **Splash generator:** `scripts/pwa/generate-apple-splash.mjs` produces the 6 required images from `public/apple/source.png` using sharp (worker-safe, run at build time only).
- **Snapshot suite growth:** each new primitive gets one entry in `tests/visual/mobile-primitives.spec.ts` at 375 / 390 / 430 px.

---

## Out of scope

- Native Capacitor wrapper / App Store submission (separate track).
- New features or business logic — this is purely presentation, motion, and installed-app polish.
- Desktop redesign — desktop views are audited only for parity/regression, not restyled.
- Android-only tweaks — that's a follow-up sweep after this ships.

---

## Estimated cadence

Pass 1 → same session. Passes 2–4 are separate sessions (each ~1 build cycle) so you can review, publish, and gather feedback between them. Confirm and I'll start Pass 1 immediately.
