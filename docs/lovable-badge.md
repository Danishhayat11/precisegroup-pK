# Lovable badge suppression

The Lovable branding widget (`#lovable-badge`) is suppressed on every page
by a layered mechanism: a **CSS fallback**, a **runtime purge script**, and
a **per-browser runtime override** with an admin UI. This document
describes what each layer does, how to configure it, and its known
limitations — most importantly, the closed-shadow-root gap.

## Configuration surface

| Knob                                          | Where               | Effect                                                                     | Scope                   |
| --------------------------------------------- | ------------------- | -------------------------------------------------------------------------- | ----------------------- |
| `VITE_HIDE_LOVABLE_BADGE`                     | env file (`.env*`)  | Build-time default written to `<html data-hide-lovable-badge>` at SSR      | Environment (all users) |
| `localStorage["lovable-badge-hide-override"]` | browser             | Overrides the env default at runtime; values `"true"` / `"false"` / absent | Per-browser             |
| `/admin/lovable-badge`                        | app UI (admin-only) | Reads / writes the localStorage override, flips the attribute live         | Per-browser             |

Default is `hidden` when the env var is unset. Set
`VITE_HIDE_LOVABLE_BADGE=false` in an env file to ship the badge visible
for that environment (e.g. local visual QA).

## Layer 1 — CSS fallback

`src/styles.css` contains a scoped rule:

```css
html[data-hide-lovable-badge="true"] #lovable-badge,
html[data-hide-lovable-badge="true"] #lovable-badge * {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
```

- **Scoped to the html attribute**, so toggling
  `data-hide-lovable-badge` from `"true"` to `"false"` at runtime disables
  the rule without a reload.
- Hides the parent `#lovable-badge` container AND every descendant, so no
  orphan "close X" button or empty box remains visible.
- Runs before any JS — the badge never paints on the initial frame when
  the env default is `hidden`.

### Fallback role

The CSS layer is the primary defense. Even with all JS disabled or a
purge-script error, the badge stays hidden on every route as long as
`<html data-hide-lovable-badge="true">` is present.

## Layer 2 — Runtime purge script

`src/lib/lovable-badge-purge.ts` ships as an inline script in the root
route's `head()`. It:

1. Walks the document and every reachable **open** shadow root, removing
   nodes matching `#lovable-badge`.
2. Installs a `MutationObserver` on the document and each shadow root it
   discovers, so late injections are removed on the next microtask.
3. Patches `Element.prototype.attachShadow` so shadow roots created
   **after** the script runs are also observed.
4. Re-reads `html[data-hide-lovable-badge]` on every mutation. Flipping
   the override to `"true"` at runtime re-arms removal for future
   injections; the observers stay installed for the page lifetime.

## Layer 3 — Runtime override + admin UI

`src/lib/lovable-badge-runtime.ts` exposes a per-browser override backed
by `localStorage["lovable-badge-hide-override"]`. The admin route
`/admin/lovable-badge` (gated by `useAuth().isAdmin`) offers three
buttons — **Hide badge**, **Show badge**, **Clear (use build default)** —
and reflects the effective state live via `useSyncExternalStore`.

Behavior when the override changes:

- **`null` → `"true"` / `"false"`**: `<html data-hide-lovable-badge>` is
  rewritten immediately in this tab. Cross-tab changes propagate via the
  native `storage` event.
- **`"false"` → `"true"`**: the attribute flips and the runtime immediately
  re-sweeps the document (light DOM + every reachable open shadow root),
  removing any already-rendered badge without a reload. The observer also
  stays armed to remove future injections.
- **`"true"` → `"false"`**: the attribute flips, CSS un-hides. **Nodes
  that were removed by the purge script during this session do not come
  back.** The admin UI includes a "Reload page" button for exactly this
  case.

## Known limitation — closed shadow roots

The purge script uses `Element.shadowRoot`, which returns `null` for any
shadow tree attached with `{ mode: "closed" }`. That means:

- **Closed shadow roots are inaccessible by design.** No JS on the page
  (ours or otherwise) can traverse into them. If the badge is ever
  injected inside a closed shadow root, the runtime purge cannot remove
  it.
- **The CSS rule also cannot reach into any shadow root** (open or
  closed) — shadow trees have their own style scope. Document-level CSS
  never applies to shadow descendants.

Practical implications:

- **Open shadow root**: Layer 2 handles it. The purge script recursively
  removes the node from the tree, which the CSS never could.
- **Closed shadow root**: Neither layer can touch it. The badge would
  remain visible. Mitigation: the `attachShadow` patch in the purge
  script runs before any consumer calls it — but if a third-party bundle
  loads and creates a closed root **before our inline script executes**
  (e.g. via a `<script>` earlier in the document), we cannot intercept
  it. Today the Lovable injector uses light DOM; this is a defense
  against a hypothetical future change.

If the injector ever switches to closed shadow roots, the only
guaranteed fix is server-side suppression (don't include the injector
script at all on the deployment target). Log a bug so the injector's
behavior can be re-inspected.

## Verification

- **Unit / e2e**: `tests/e2e/lovable-badge-hidden.spec.ts` walks every
  public route and asserts `#lovable-badge` is absent or fully hidden.
  It reads `html[data-hide-lovable-badge]` and self-skips when the flag
  is `"false"`.
- **CI matrix**: `.github/workflows/lovable-badge-hidden.yml` runs the
  spec once with `VITE_HIDE_LOVABLE_BADGE=true` and once with `false`,
  guarding both branches of the toggle.

## File map

| File                                                | Role                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/styles.css`                                    | CSS fallback (scoped to `html[data-hide-lovable-badge="true"]`)              |
| `src/lib/lovable-badge-purge.ts`                    | Inline purge script (light DOM + open shadow roots)                          |
| `src/lib/lovable-badge-runtime.ts`                  | Resolver, localStorage override, change events                               |
| `src/routes/__root.tsx`                             | Wires SSR attribute, injects purge script, applies runtime override on mount |
| `src/routes/_authenticated/admin.lovable-badge.tsx` | Admin-only toggle UI                                                         |
| `tests/e2e/lovable-badge-hidden.spec.ts`            | End-to-end coverage across public routes                                     |
| `.github/workflows/lovable-badge-hidden.yml`        | CI matrix (env flag on / off)                                                |
