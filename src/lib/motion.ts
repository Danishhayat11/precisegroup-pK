/**
 * Global motion tokens for the app-wide animation system.
 *
 * All transitions use the same "signature" easing so hero sections,
 * cards, dialogs and page transitions feel like one product.
 *
 * `prefers-reduced-motion: reduce` is respected globally by Framer Motion
 * via `MotionConfig reducedMotion="user"` in the root, so consumers do NOT
 * need to branch — Framer will collapse the animations to instant.
 */

// Signature easing — the classic "premium software" out-curve.
export const easeSignature: [number, number, number, number] = [0.22, 1, 0.36, 1];

// Expressive easing — slightly deeper anticipation, used for hero/route moves.
export const easeExpressive: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Snappy durations (seconds) — 200ms–500ms window (expressive tier).
export const durations = {
  fast: 0.2,
  base: 0.32,
  slow: 0.48,
} as const;

/** Expressive spring — bouncy but controlled; use for layout / route moves. */
export const springExpressive = {
  type: "spring" as const,
  stiffness: 260,
  damping: 26,
  mass: 0.9,
};

/** Stagger container for sections composed of multiple animated children. */
export const staggerContainer = {
  hidden: { opacity: 1 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.05,
    },
  },
} as const;

/** Fade + slide-up entrance for individual items inside a stagger container. */
export const fadeSlideUp = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: durations.base,
      ease: easeSignature,
    },
  },
} as const;

/** Standalone (no-stagger) fade+slide, e.g. for a single hero block. */
export const sectionEntrance = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: durations.slow,
      ease: easeSignature,
    },
  },
} as const;

/** Page-transition variants used by AnimatePresence around <Outlet />. */
export const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.base, ease: easeSignature },
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: { duration: durations.fast, ease: easeSignature },
  },
} as const;
