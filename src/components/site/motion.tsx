/**
 * Reusable motion primitives for the /site marketing surface.
 *
 * All primitives:
 *   · honour `useReducedMotion` — if the user opts out, they render a plain
 *     `div` with no animation, no `will-change`, no repaint cost.
 *   · use tasteful, fast timings (200–400ms) with a single shared easing
 *     curve so entrances feel like one system, not a grab-bag of libraries.
 *   · keep transforms GPU-friendly (opacity + translateY only) so scrolling
 *     stays 60fps on mid-range hardware.
 */
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { useRouterState } from "@tanstack/react-router";
import { type ReactNode } from "react";

// Shared easing — a soft "expo-out" that feels editorial rather than bouncy.
const EASE = [0.22, 1, 0.36, 1] as const;

/** ─────────────────────── Reveal ───────────────────────
 * Fade-and-slide-up on scroll-into-view. Fires once per element, at 20%
 * visibility (`amount: 0.2`), with a small negative margin so short
 * sections don't feel late.
 *
 * Usage:
 *   <Reveal><h2>Hello</h2></Reveal>
 *   <Reveal delay={0.08}><Card /></Reveal>
 */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  duration = 0.55,
  as: Tag = "div",
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  duration?: number;
  as?: "div" | "section" | "article" | "li" | "header";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const MotionTag = motion[Tag] as typeof motion.div;

  if (reduce) {
    const Static = Tag as "div";
    return <Static className={className}>{children}</Static>;
  }

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2, margin: "-40px 0px" }}
      transition={{ duration, ease: EASE, delay }}
    >
      {children}
    </MotionTag>
  );
}

/** ─────────────────────── RevealStagger ───────────────────────
 * Container that staggers direct children as they enter viewport.
 * Children can be plain elements — no per-child motion wrapper needed.
 *
 * Usage:
 *   <RevealStagger>
 *     <Card />
 *     <Card />
 *   </RevealStagger>
 */
const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const staggerChild: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

export function RevealStagger({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "ul" | "ol" | "section";
}) {
  const reduce = useReducedMotion();
  const MotionTag = motion[Tag] as typeof motion.div;

  if (reduce) {
    const Static = Tag as "div";
    return <Static className={className}>{children}</Static>;
  }

  return (
    <MotionTag
      className={className}
      variants={staggerParent}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15, margin: "-40px 0px" }}
    >
      {Array.isArray(children) ? (
        children.map((child, i) => (
          <motion.div key={i} variants={staggerChild}>
            {child}
          </motion.div>
        ))
      ) : (
        <motion.div variants={staggerChild}>{children}</motion.div>
      )}
    </MotionTag>
  );
}

/** ─────────────────────── PageTransition ───────────────────────
 * Cross-fades /site routes on pathname change. Keyed on location.pathname
 * so back/forward, in-page links, and programmatic navigation all animate.
 * 240ms in, 180ms out — fast enough that navigation feels immediate,
 * slow enough that the swap doesn't flicker.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (reduce) return <>{children}</>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.24, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** ─────────────────────── SiteLoading ───────────────────────
 * Full-viewport pending state used by TanStack Router's `pendingComponent`.
 * A subtle centered mark with a hairline sweep — never a spinner-and-shrug.
 * Only visible if a route pends longer than `pendingMs` (250ms by default,
 * set on the route). Below that threshold the transition is instantaneous.
 */
export function SiteLoading() {
  const reduce = useReducedMotion();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="flex min-h-[60vh] items-center justify-center"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-8 w-8">
          <span className="absolute inset-0 rounded-full border border-foreground/15" />
          {!reduce && (
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-transparent border-t-foreground"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
            />
          )}
        </div>
        <span className="text-[10.5px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
          Loading
        </span>
      </div>
    </div>
  );
}
