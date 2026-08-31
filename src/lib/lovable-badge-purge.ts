/**
 * Runtime purge for the Lovable branding badge.
 *
 * The CSS override in `src/styles.css` hides `#lovable-badge` in the light
 * DOM. If the injector ever mounts the badge inside a shadow root (or the
 * badge is added dynamically after hydration), scoped CSS from the document
 * cannot reach it — shadow trees have their own style scope. This script
 * closes that gap:
 *
 *   1. Walks the entire document tree, descending into every open shadow
 *      root, and removes any node matching `#lovable-badge`.
 *   2. Installs a MutationObserver on the document AND on every shadow root
 *      it discovers, so later injections are removed on the next microtask.
 *   3. Patches `Element.prototype.attachShadow` so shadow roots created after
 *      this script runs are also observed (open roots only — closed roots
 *      remain inaccessible by design).
 *
 * Gated by `<html data-hide-lovable-badge="true">` so the same
 * `VITE_HIDE_LOVABLE_BADGE` env flag controls both the CSS override and this
 * runtime purge — no divergence between the two mechanisms.
 *
 * Exported as an inline-script string so `__root.tsx` can ship it via the
 * head() `scripts` array (runs before hydration, no separate request).
 */

const BADGE_SELECTOR = "#lovable-badge";

/**
 * The IIFE body. Kept as a template string so `__root.tsx` can hand it to
 * TanStack Router's head() `scripts` entry (which expects a `children`
 * string). Also exported as a function for the Vitest unit tests.
 */
export const LOVABLE_BADGE_PURGE_SCRIPT = `(function(){
  try {
    if (typeof document === "undefined") return;
    var root = document.documentElement;
    if (!root) return;

    var SEL = ${JSON.stringify(BADGE_SELECTOR)};
    var observed = typeof WeakSet === "function" ? new WeakSet() : null;

    // Re-checked on every mutation so the runtime override
    // (see src/lib/lovable-badge-runtime.ts) can flip behavior without a
    // reload. Observers stay wired for the lifetime of the page — only the
    // remove-on-match decision is gated.
    function enabled(){
      return root.getAttribute("data-hide-lovable-badge") === "true";
    }

    function removeMatches(node) {
      if (!node) return;
      if (!enabled()) {
        // Still recurse so we discover and observe shadow roots for later,
        // but do not remove anything while the override is off.
      }
      // Element itself
      if (node.nodeType === 1 && typeof node.matches === "function") {
        try { if (enabled() && node.matches(SEL)) { node.remove(); return; } } catch (_) {}
      }
      // Light-DOM descendants
      if (typeof node.querySelectorAll === "function" && enabled()) {
        try {
          var hits = node.querySelectorAll(SEL);
          for (var i = 0; i < hits.length; i++) {
            try { hits[i].remove(); } catch (_) {}
          }
        } catch (_) {}
      }
      // Recurse into open shadow roots
      if (typeof node.querySelectorAll === "function") {
        try {
          var all = node.querySelectorAll("*");
          for (var j = 0; j < all.length; j++) {
            var sr = all[j].shadowRoot;
            if (sr) {
              observe(sr);
              removeMatches(sr);
            }
          }
        } catch (_) {}
      }
    }

    function observe(target) {
      if (!target || !("MutationObserver" in window)) return;
      if (observed && observed.has(target)) return;
      if (observed) observed.add(target);
      try {
        var mo = new MutationObserver(function(muts){
          for (var i = 0; i < muts.length; i++) {
            var m = muts[i];
            for (var j = 0; j < m.addedNodes.length; j++) {
              removeMatches(m.addedNodes[j]);
            }
          }
        });
        mo.observe(target, { childList: true, subtree: true });
      } catch (_) {}
    }

    // Patch attachShadow so shadow roots created later are also observed.
    try {
      var proto = Element.prototype;
      var orig = proto.attachShadow;
      if (typeof orig === "function" && !proto.__lovableBadgeShadowPatched) {
        proto.attachShadow = function(init){
          var sr = orig.call(this, init);
          try { observe(sr); removeMatches(sr); } catch (_) {}
          return sr;
        };
        Object.defineProperty(proto, "__lovableBadgeShadowPatched", { value: true });
      }
    } catch (_) {}

    function sweep(){
      removeMatches(document);
      observe(document);
    }

    // Expose a manual sweep hook so the runtime override (see
    // src/lib/lovable-badge-runtime.ts) can force an immediate purge of
    // any already-rendered badge the moment the admin flips to "hide",
    // without waiting for the next mutation or a page reload.
    try { window.__lovableBadgeSweep = sweep; } catch (_) {}

    sweep();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", sweep, { once: true });
    }
    // Belt-and-braces: one deferred sweep for late injectors.
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      window.setTimeout(sweep, 0);
      window.setTimeout(sweep, 1500);
    }
  } catch (_) { /* never break the page over a badge */ }
})();`;
