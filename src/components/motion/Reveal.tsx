/**
 * App-wide viewport reveal primitives.
 *
 * Wraps the existing motion tokens in `@/lib/motion` so any surface —
 * CRM screens, marketing pages, dashboards — animates from one shared
 * choreography language. Honours `prefers-reduced-motion` via the root
 * MotionConfig; consumers do NOT need to branch on it.
 *
 * `<Reveal>`  — single element fades + slides up when it enters the viewport.
 * `<Stagger>` — container that staggers its direct children (no per-child wrapper needed).
 * `<StaggerItem>` — opt-in child wrapper if you want fine-grained control.
 */
import { motion, type Variants, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ElementType, type ReactNode } from "react";
import { durations, easeSignature } from "@/lib/motion";

const enter: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.slow, ease: easeSignature },
  },
};

const staggerParent: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.07, delayChildren: 0.04 },
  },
};

type RevealProps = HTMLMotionProps<"div"> & {
  as?: ElementType;
  /** Fraction of the element that must be in view before firing. */
  amount?: number;
  /** Fire once per mount (default) or on every re-entry. */
  once?: boolean;
  /** Optional entrance delay in seconds. */
  delay?: number;
  children: ReactNode;
};

export const Reveal = forwardRef<HTMLElement, RevealProps>(function Reveal(
  { as, amount = 0.2, once = true, delay = 0, children, ...rest },
  ref,
) {
  const Comp = motion.create(as ?? "div") as typeof motion.div;
  return (
    <Comp
      ref={ref as never}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount, margin: "-40px 0px" }}
      variants={enter}
      transition={{ duration: durations.slow, ease: easeSignature, delay }}
      {...rest}
    >
      {children}
    </Comp>
  );
});

type StaggerProps = HTMLMotionProps<"div"> & {
  as?: ElementType;
  amount?: number;
  once?: boolean;
  /** Seconds between each child's entrance. */
  gap?: number;
  children: ReactNode;
};

/**
 * Container that reveals its direct children in sequence. If the child is a
 * plain element, it is auto-wrapped with the `enter` variant. If you need
 * finer control (e.g. animating a Card wrapper directly), use `<StaggerItem>`
 * as the child instead — its `variants` short-circuit the auto-wrap.
 */
export const Stagger = forwardRef<HTMLElement, StaggerProps>(function Stagger(
  { as, amount = 0.15, once = true, gap, children, ...rest },
  ref,
) {
  const Comp = motion.create(as ?? "div") as typeof motion.div;
  const variants: Variants =
    gap == null
      ? staggerParent
      : {
          hidden: {},
          show: { transition: { staggerChildren: gap, delayChildren: 0.04 } },
        };
  const items = Array.isArray(children) ? children : [children];
  return (
    <Comp
      ref={ref as never}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount, margin: "-40px 0px" }}
      variants={variants}
      {...rest}
    >
      {items.map((child, i) => (
        <motion.div key={i} variants={enter}>
          {child}
        </motion.div>
      ))}
    </Comp>
  );
});

/** Explicit stagger child — use when auto-wrapping would break layout. */
export const StaggerItem = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function StaggerItem(props, ref) {
    return <motion.div ref={ref} variants={enter} {...props} />;
  },
);
