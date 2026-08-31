/**
 * GlowCard — noir-and-gold hover affordance for cards, tiles, and
 * clickable panels. Wraps children in a motion.div that:
 *
 *   • lifts 2px on hover with a snappy 220ms transition
 *   • fades a soft champagne-gold glow ring in behind the card
 *   • presses 1% on tap for tactile feedback
 *
 * Honours reduced-motion (MotionConfig `reducedMotion="user"` in root).
 * Works with any child — Card, Link, button — by passing through classes.
 */
import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { durations, easeSignature } from "@/lib/motion";

type GlowCardProps = Omit<HTMLMotionProps<"div">, "children"> & {
  children: ReactNode;
  /** Disable the glow, keep only lift. Useful for dense grid cards. */
  subtle?: boolean;
};

export const GlowCard = forwardRef<HTMLDivElement, GlowCardProps>(function GlowCard(
  { children, className, subtle = false, ...rest },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      className={cn("relative isolate", className)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: durations.fast, ease: easeSignature }}
      {...rest}
    >
      {!subtle && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px rounded-[inherit] opacity-0"
          style={{
            boxShadow: "0 0 0 1px hsl(41 45% 62% / 0.35), 0 12px 40px -12px hsl(41 45% 62% / 0.45)",
          }}
          whileHover={{ opacity: 1 }}
          transition={{ duration: durations.base, ease: easeSignature }}
        />
      )}
      {children}
    </motion.div>
  );
});
