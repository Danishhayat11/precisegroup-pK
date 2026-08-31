import { useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { easeSignature } from "@/lib/motion";

/**
 * Slim branded progress bar that appears at the top of the viewport while
 * the router is loading a new route (loaders / lazy chunks). Uses GPU
 * transforms only — no layout impact.
 */
export function RouteProgress() {
  const isLoading = useRouterState({
    select: (s) => s.isLoading || s.isTransitioning,
  });

  return (
    <AnimatePresence>
      {isLoading ? (
        <motion.div
          key="route-progress"
          className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-0.5 origin-left bg-primary"
          initial={{ scaleX: 0, opacity: 0.9 }}
          animate={{
            scaleX: [0, 0.4, 0.75, 0.9],
            opacity: 1,
            transition: { duration: 1.2, ease: easeSignature, times: [0, 0.3, 0.7, 1] },
          }}
          exit={{
            scaleX: 1,
            opacity: 0,
            transition: { duration: 0.25, ease: easeSignature },
          }}
          style={{ willChange: "transform, opacity" }}
          aria-hidden="true"
        />
      ) : null}
    </AnimatePresence>
  );
}
