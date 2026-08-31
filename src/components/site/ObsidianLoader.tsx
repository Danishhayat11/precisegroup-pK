/* allow-raw-color-file: brand loader uses fixed cyan→violet gradient stops (no semantic token equivalent for gradient interpolation) */
/**
 * ObsidianLoader — premium SVG + Framer Motion loading sequence.
 *
 * A full-viewport pending state used by TanStack Router's `pendingComponent`.
 * Two counter-rotating hairline arcs stroked with a cyan → violet gradient
 * frame a center mark that morphs through four keyframes. A radial glow
 * pulses beneath the mark at 1.2s cadence to build anticipation without
 * distracting from the content that's about to reveal.
 *
 *   · Pure SVG — no Lottie / no external assets, ships in the bundle.
 *   · GPU-friendly: only `rotate`, `opacity`, and `d` path morphing.
 *   · Honours `useReducedMotion` — static mark + label, no spin, no pulse.
 *   · Router pairs it with `pendingMs`/`pendingMinMs` so it never flickers.
 */
import { motion, useReducedMotion } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;

// Four morph targets for the center mark — a tight loop that reads as
// "assembling" rather than "spinning". Each path is 24×24 viewBox.
const MARK_PATHS = [
  "M12 4 L20 12 L12 20 L4 12 Z", // diamond
  "M4 6 L20 6 L20 18 L4 18 Z", // slab
  "M12 3 A9 9 0 1 1 11.99 3 Z", // ring
  "M6 4 L18 4 L12 20 Z", // wedge
] as const;

export function ObsidianLoader() {
  const reduce = useReducedMotion();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="relative flex min-h-[60vh] items-center justify-center overflow-hidden"
    >
      {/* Soft ambient wash — violet halo behind the mark, unobtrusive on
          both light and dark surfaces. Absolutely positioned so it never
          affects layout. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(139,92,246,0.14), rgba(34,211,238,0.06) 55%, transparent 78%)",
          filter: "blur(2px)",
        }}
      />

      <div className="relative flex flex-col items-center gap-5">
        <div className="relative h-20 w-20">
          {/* Radial pulse — sits directly under the arcs, opacity + scale. */}
          {!reduce && (
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background: "radial-gradient(closest-side, rgba(34,211,238,0.28), transparent 70%)",
              }}
              animate={{ opacity: [0.35, 0.9, 0.35], scale: [0.85, 1.05, 0.85] }}
              transition={{ duration: 1.2, ease: EASE, repeat: Infinity }}
            />
          )}

          <svg viewBox="0 0 80 80" className="relative h-full w-full" aria-hidden>
            <defs>
              <linearGradient id="obsidian-loader-stroke" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#22D3EE" />{" "}
                {/* allow-raw-color: neon-cyan gradient stop for premium loader mark */}
                <stop offset="100%" stopColor="#8B5CF6" />{" "}
                {/* allow-raw-color: soft-violet gradient stop for premium loader mark */}
              </linearGradient>
              <linearGradient id="obsidian-loader-mark" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#67E8F9" />{" "}
                {/* allow-raw-color: neon-cyan-soft gradient stop for premium loader mark */}
                <stop offset="100%" stopColor="#A78BFA" />{" "}
                {/* allow-raw-color: soft-violet-soft gradient stop for premium loader mark */}
              </linearGradient>
            </defs>

            {/* Outer arc — clockwise. */}
            <motion.circle
              cx={40}
              cy={40}
              r={34}
              fill="none"
              stroke="url(#obsidian-loader-stroke)"
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeDasharray="80 213"
              style={{ transformOrigin: "40px 40px" }}
              animate={reduce ? undefined : { rotate: 360 }}
              transition={reduce ? undefined : { duration: 2.4, ease: "linear", repeat: Infinity }}
              opacity={0.85}
            />

            {/* Inner arc — counter-clockwise, slower. */}
            <motion.circle
              cx={40}
              cy={40}
              r={26}
              fill="none"
              stroke="url(#obsidian-loader-stroke)"
              strokeWidth={1}
              strokeLinecap="round"
              strokeDasharray="42 122"
              style={{ transformOrigin: "40px 40px" }}
              animate={reduce ? undefined : { rotate: -360 }}
              transition={reduce ? undefined : { duration: 3.2, ease: "linear", repeat: Infinity }}
              opacity={0.55}
            />

            {/* Center mark — morphs through the 4 keyframes. */}
            <g transform="translate(28,28)">
              <motion.path
                fill="url(#obsidian-loader-mark)"
                initial={{ d: MARK_PATHS[0] }}
                animate={reduce ? { d: MARK_PATHS[0] } : { d: [...MARK_PATHS, MARK_PATHS[0]] }}
                transition={
                  reduce
                    ? undefined
                    : {
                        duration: 3.6,
                        ease: EASE,
                        repeat: Infinity,
                        times: [0, 0.25, 0.5, 0.75, 1],
                      }
                }
              />
            </g>
          </svg>
        </div>

        <span className="text-[10.5px] font-medium uppercase tracking-[0.32em] text-muted-foreground">
          Loading
        </span>
      </div>
    </div>
  );
}
