# Tap targets: the 44×44 rule

**TL;DR** — every button, link, input, and icon-only control MUST paint at
**≥ 44 × 44 CSS px** on mobile and tablet viewports. This is WCAG 2.5.5
Level AAA and it is a build-blocking gate in this repo (see
`scripts/ci/tap-target-audit.mjs` + `.github/workflows/tap-target-audit.yml`).

If you're here because CI failed with a `Tap target < 44×44` annotation,
skip to [Fixing a failing control](#fixing-a-failing-control).

---

## Why 44 px

- WCAG 2.5.5 (Target Size, Enhanced) — the checkpoint tools screen readers
  and accessibility auditors report against.
- Apple HIG (44 pt) and Material Design (48 dp) both cite the same
  neighborhood for the smallest reliably-hittable target with a fingertip.
- Below ~40 px, mistap rates climb sharply on real devices; the audit
  bakes in a small margin.

Desktop pointers are precise enough that compact controls (36 px shadcn
`sm`, 32 px icon buttons) are fine — the rule only fires on touch
viewports.

## The breakpoint contract

Tailwind's default breakpoints, and how the audit treats them:

| Prefix   | Min width | Treated as          | Small-size classes allowed?                             |
| -------- | --------: | ------------------- | ------------------------------------------------------- |
| _(none)_ |      0 px | Touch (mobile)      | No — must be ≥ 44 px or paired with `min-h-11 min-w-11` |
| `sm:`    |    640 px | Touch (large phone) | No                                                      |
| `md:`    |    768 px | Touch (tablet)      | No                                                      |
| `lg:`    |   1024 px | Pointer (desktop)   | **Yes**                                                 |
| `xl:`    |   1280 px | Pointer (desktop)   | Yes                                                     |
| `2xl:`   |   1536 px | Pointer (desktop)   | Yes                                                     |

**Rule of thumb:** if a size class fires below `lg:`, it must land at ≥ 44 px.

## Class cheatsheet

Tailwind's spacing scale is `1 unit = 4 px`, so `h-11 = 44 px`. The audit
uses `MIN_TAP_UNIT = 11`.

```tsx
// ✅ Default touch-friendly button (already ≥ 44 px)
<Button>Save</Button>

// ✅ Compact button, but forced to 44 px on touch, 36 px only on desktop
<Button className="h-9 min-h-11 min-w-11 lg:min-h-9 lg:min-w-9">Save</Button>

// ✅ Desktop-only small size (allowed — never renders < 44 px on touch)
<Button className="lg:h-9 lg:w-9">
  <Icon />
</Button>

// ✅ Icon button explicitly bumped to 44 px on touch
<Button size="icon" className="min-h-11 min-w-11 lg:min-h-9 lg:min-w-9">
  <Icon />
</Button>

// ❌ Fails audit — h-9 (36 px) with no min-h-11 and no lg:/xl: gate
<Button className="h-9">Save</Button>

// ❌ Fails audit — shadcn icon size defaults to 36 px on every viewport
<Button size="icon"><Icon /></Button>
```

## Desktop breakpoint sizing (`lg:` / `xl:` / `2xl:`)

Once you're past `md:` (≥ 1024 px), the rule flips: pointers are precise,
vertical space is scarce, and the touch minimums stop applying. Use the
same three classes everywhere so density scales predictably:

| Breakpoint | Min width | Standard control height                | Icon button            | Typical class pairing                                                |
| ---------- | --------: | -------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `lg:`      |   1024 px | 36 px (`h-9`)                          | 36 px (`h-9 w-9`)      | `h-11 w-11 lg:h-9 lg:w-9`                                            |
| `xl:`      |   1280 px | 36 px (`h-9`) — inherits `lg:`         | 36 px — inherits `lg:` | Only override when a control genuinely needs to grow at wider widths |
| `2xl:`     |   1536 px | 40 px (`h-10`) for hero / primary CTAs | 36 px — inherits `lg:` | `h-11 lg:h-9 2xl:h-10` for marketing / dashboard primaries           |

Guidelines:

- **Set the desktop size at `lg:` and let `xl:` inherit.** Don't repeat
  the same value at `xl:` — it adds noise and drifts out of sync. Only
  add an `xl:` or `2xl:` override when the control's role changes at
  that width (e.g. a sidebar action becoming a primary CTA).
- **Always pair a small `lg:` size with a touch-safe base.** The
  canonical pattern is `min-h-11 min-w-11 lg:min-h-9 lg:min-w-9` (or
  the `h-`/`w-` equivalents). Writing `lg:h-9 lg:w-9` alone is fine
  only if the unprefixed size is already ≥ 44 px.
- **Reserve `2xl:` for layout, not shrinking.** Growing to `h-10` on
  ultra-wide screens is fine; shrinking below the `lg:` size at `2xl:`
  is almost always a bug — it makes bigger monitors harder to click.
- **Never introduce a new small-size prefix below `lg:`.** `sm:h-8`
  and `md:w-9` are audit failures by construction; the scanner treats
  `sm:` and `md:` as touch viewports.

## Fixing a failing control

The audit reports the file, line, rule, and offending class list. You
have three legitimate paths:

1. **Bump the size on touch.** Add `min-h-11 min-w-11`. Keep the
   compact `h-9`/`w-9` if you want the desktop look — pair them:
   `className="h-9 w-9 min-h-11 min-w-11 lg:min-h-9 lg:min-w-9"`.
2. **Gate the small size behind a desktop breakpoint.** Prefix every
   under-44 class with `lg:`, `xl:`, or `2xl:` so it can never render
   that small on a touch viewport.
3. **Escape hatch (needs a git-blame reason).** For genuinely rare
   cases (dense legacy tables, print-only chrome), add one of:

   ```tsx
   {
     /* same line */
   }
   <Button className="h-8 w-8" />; // allow-small-tap: dense admin table row action

   {
     /* preceding line */
   }
   {
     /* allow-small-tap: report grid cell */
   }
   <Button className="h-8 w-8" />;

   {
     /* whole-file, at the top of the file */
   }
   /* allow-small-tap-file: legacy print letterhead — no interactive touch */
   ```

   The reason string is required and shows in `git blame`. Do not use
   the escape hatch to silence net-new components.

## What the audit checks

`scripts/ci/tap-target-audit.mjs` statically scans every `.tsx`/`.jsx`
file under `src/` for two rule categories:

- **R1** — `<Button size="icon">` without a ≥ 44 px override
  (`min-h-11 min-w-11`, `size-11+`, `h-11 w-11+`, or an arbitrary
  `min-h-[≥44px]`). Default shadcn icon buttons are 36 × 36.
- **R2** — Any `<Button>`, `<button>`, `<a>`, `<input>`, or
  `<textarea>` carrying an explicit `h-<N>` / `w-<N>` / `size-<N>`
  with `N < 11` at an unprefixed / `sm:` / `md:` breakpoint, without
  a matching `min-h-11 min-w-11` at those breakpoints.

Both rules ignore desktop-only prefixes (`lg:`, `xl:`, `2xl:`) and
non-layout prefixes (`print:`, `motion-reduce:`, `motion-safe:`).

Runtime verification lives in `tests/visual/ledger-tap-targets.spec.ts`
(Playwright, three viewports) — it measures `getBoundingClientRect()`
on real controls so a global CSS rule can't quietly shrink them below
what the static audit would catch.

## Related

- `scripts/ci/tap-target-audit.mjs` — the scanner
- `scripts/ci/tap-target-audit.allowlist.json` — grandfathered offenders
- `.github/workflows/tap-target-audit.yml` — the CI gate + PR annotations
- `tests/visual/ledger-tap-targets.spec.ts` — runtime size assertion
- `docs/a11y-audit.md` — broader a11y coverage
