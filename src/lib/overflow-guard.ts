/**
 * Dev-only runtime guard for horizontal overflow.
 *
 * Watches for two independent signals:
 *   1. The document is WIDER than the viewport
 *      (`documentElement.scrollWidth - clientWidth > THRESHOLD`) —
 *      the classic "page has a horizontal scrollbar" bug.
 *   2. The document has actually SCROLLED sideways
 *      (`window.scrollX > THRESHOLD`) — catches cases where the
 *      user (or a component) has been pushed off-axis even if the
 *      layout later normalises.
 *
 * When either fires, we log ONE warning per (route, signal) pair
 * naming the current pathname + the offending numbers, and — when
 * available — the first few descendant elements whose right edge
 * extends past the viewport. The pair-guard prevents log spam
 * during resize / scroll storms.
 *
 * Runtime cost when the guard is disabled (production): zero — the
 * whole module is tree-shaken out of the client bundle behind
 * `import.meta.env.DEV`.
 *
 * Wire-up: mounted once at the app root in src/routes/__root.tsx.
 */
import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

/** Small pixel tolerance to absorb sub-pixel rounding + scrollbar width. */
const THRESHOLD_PX = 2;

type Signal = "documentWiderThanViewport" | "windowScrolledX";

/** Keyed set of (route, signal) pairs already warned about, to dedupe. */
const warned = new Set<string>();

function offendingElements(viewportWidth: number) {
  const bad: Array<{ tag: string; cls: string; right: number }> = [];
  const els = Array.from(document.querySelectorAll<HTMLElement>("body *"));
  for (const el of els) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (style.position === "fixed") continue;
    // Decorative overlays are almost always intentional bleeds clipped
    // by an ancestor — ignore to keep the warning signal:noise high.
    if (style.pointerEvents === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right - viewportWidth <= THRESHOLD_PX) continue;
    bad.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute("class") ?? "").slice(0, 100),
      right: Math.round(r.right),
    });
    if (bad.length >= 3) break;
  }
  return bad;
}

function checkOverflow(pathname: string) {
  const doc = document.documentElement;
  const docOverflow = doc.scrollWidth - doc.clientWidth;
  const scrolled = Math.abs(window.scrollX);

  if (docOverflow > THRESHOLD_PX) {
    const key = `documentWiderThanViewport@${pathname}`;
    if (!warned.has(key)) {
      warned.add(key);

      console.warn(
        `[overflow-guard] Horizontal overflow on "${pathname}": document is ${docOverflow}px wider than the viewport (scrollWidth=${doc.scrollWidth}, clientWidth=${doc.clientWidth}).`,
        { offenders: offendingElements(doc.clientWidth) },
      );
    }
  }

  if (scrolled > THRESHOLD_PX) {
    const key = `windowScrolledX@${pathname}`;
    if (!warned.has(key)) {
      warned.add(key);

      console.warn(
        `[overflow-guard] Page scrolled sideways on "${pathname}": window.scrollX=${scrolled}px (threshold=${THRESHOLD_PX}).`,
      );
    }
  }
}

/**
 * React hook: install the overflow guard for the lifetime of the app.
 * Safe to call multiple times — the effect is idempotent per mount.
 */
export function useOverflowGuard() {
  const router = useRouter();

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (typeof window === "undefined") return;

    const getPath = () => router.state.location.pathname;

    // Reset the warn-set on real route changes so a page that fixes its
    // layout after mount doesn't stay silently flagged forever, and a
    // regression on a different route can still fire.
    let lastPath = getPath();
    const unsubscribeRouter = router.subscribe("onResolved", () => {
      const next = getPath();
      if (next !== lastPath) {
        lastPath = next;
        for (const k of Array.from(warned)) {
          if (k.endsWith(`@${next}`)) warned.delete(k);
        }
      }
      // Check after the route settles so the new page has painted.
      requestAnimationFrame(() => checkOverflow(next));
    });

    // Sample on resize + scroll (rAF-throttled) to catch dynamic breaks
    // introduced by responsive re-layouts and post-hydration widgets.
    let rafPending = false;
    const sample = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        checkOverflow(getPath());
      });
    };
    window.addEventListener("resize", sample, { passive: true });
    window.addEventListener("scroll", sample, { passive: true });

    // Observe DOM mutations (widgets mounting late, images loading, etc.)
    // — the top-3 real-world source of "why did the page start scrolling
    // sideways five seconds after load".
    const observer = new MutationObserver(sample);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    // Initial check after first paint.
    requestAnimationFrame(() => checkOverflow(getPath()));

    return () => {
      unsubscribeRouter();
      window.removeEventListener("resize", sample);
      window.removeEventListener("scroll", sample);
      observer.disconnect();
    };
  }, [router]);
}

/** Test helper — reset dedupe state between assertions. */
export function __resetOverflowGuardForTests() {
  warned.clear();
}
