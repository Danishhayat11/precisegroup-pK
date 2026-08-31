/**
 * PendingSurface — the default loading state for route loaders and
 * in-page async islands. Matches the Editorial Noir & Gold aesthetic:
 * a hairline ring with a slow gold sweep, plus a set of shimmer bars
 * that echo the layout instead of a naked spinner.
 *
 *   • Full-viewport variant (`<PendingSurface />`) — use as router
 *     `defaultPendingComponent` and per-route `pendingComponent`.
 *   • Inline variant (`<PendingSurface inline rows={3} />`) — use
 *     inside cards / panels waiting for their own query.
 *
 * All motion respects `prefers-reduced-motion` via root MotionConfig.
 */
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { durations, easeSignature } from "@/lib/motion";

type PendingSurfaceProps = {
  /** Render inline (no min-height, no centering) for use inside cards. */
  inline?: boolean;
  /** Number of shimmer bars to render below the mark. */
  rows?: number;
  /** Optional label announced to screen readers. */
  label?: string;
  className?: string;
};

export function PendingSurface({
  inline = false,
  rows = 3,
  label = "Loading",
  className,
}: PendingSurfaceProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        inline ? "w-full py-6" : "flex min-h-[60vh] w-full items-center justify-center",
        className,
      )}
    >
      <div
        className={cn(
          "flex w-full max-w-md flex-col items-center gap-6",
          inline && "max-w-none items-stretch",
        )}
      >
        {!inline && (
          <div className="relative h-9 w-9">
            {/* Hairline ring */}
            <span className="absolute inset-0 rounded-full border border-border" />
            {/* Champagne sweep */}
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-transparent"
              style={{ borderTopColor: "var(--primary)" }}
              animate={{ rotate: 360 }}
              transition={{ duration: 1.1, ease: "linear", repeat: Infinity }}
            />
          </div>
        )}

        {!inline && (
          <span className="text-[10.5px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
            {label}
          </span>
        )}

        {/* Shimmer skeleton rows */}
        <div
          className={cn("flex w-full flex-col gap-2.5", inline ? "" : "mt-2")}
          aria-hidden="true"
        >
          {Array.from({ length: rows }).map((_, i) => (
            <Shimmer key={i} width={i === rows - 1 ? "60%" : "100%"} delay={i * 0.08} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Shimmer({ width, delay }: { width: string; delay: number }) {
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-muted/60" style={{ width }}>
      <motion.div
        className="absolute inset-y-0 -left-1/3 w-1/3"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, hsl(41 45% 62% / 0.22) 50%, transparent 100%)",
        }}
        animate={{ x: ["-100%", "400%"] }}
        transition={{
          duration: 1.6,
          ease: easeSignature,
          repeat: Infinity,
          delay,
          repeatDelay: 0.2,
        }}
      />
    </div>
  );
}

/** Compact one-line variant for buttons/inputs waiting on a mutation. */
export function PendingInline({ label = "Working" }: { label?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 text-xs text-muted-foreground"
    >
      <motion.span
        className="inline-block h-3 w-3 rounded-full border-2 border-transparent"
        style={{ borderTopColor: "var(--primary)", borderRightColor: "var(--primary)" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
      />
      <span>{label}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

// Re-export easeSignature/durations import so tree-shaking keeps the
// motion tokens on the same chunk as the loader UI.
export { durations, easeSignature };
