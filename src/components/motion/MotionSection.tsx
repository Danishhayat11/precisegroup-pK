import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ElementType } from "react";
import { fadeSlideUp, sectionEntrance, staggerContainer } from "@/lib/motion";

type MotionSectionProps = HTMLMotionProps<"section"> & {
  as?: ElementType;
  /** When true, children animate individually with a stagger. */
  stagger?: boolean;
  /** Amount of the element that must be visible before triggering. */
  amount?: number;
  /** Only animate once per mount. */
  once?: boolean;
};

/**
 * Viewport-triggered entrance wrapper. Fades in and slides up 20px using the
 * app's signature easing. Set `stagger` to have direct children animate in
 * sequence — wrap each child in <MotionItem /> to opt in.
 */
export const MotionSection = forwardRef<HTMLElement, MotionSectionProps>(function MotionSection(
  { as, stagger = false, amount = 0.2, once = true, children, ...rest },
  ref,
) {
  const Comp = motion.create(as ?? "section") as typeof motion.section;
  const variants = stagger ? staggerContainer : sectionEntrance;
  return (
    <Comp
      ref={ref as never}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      variants={variants}
      {...rest}
    >
      {children}
    </Comp>
  );
});

/** Individual staggered child. Use inside <MotionSection stagger>. */
export const MotionItem = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function MotionItem(props, ref) {
    return <motion.div ref={ref} variants={fadeSlideUp} {...props} />;
  },
);
