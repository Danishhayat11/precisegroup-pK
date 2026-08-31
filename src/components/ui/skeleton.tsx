import { cn } from "@/lib/utils";

/**
 * iOS-style skeleton: soft rounded block with a slow shimmer sweep.
 * The shimmer keyframe is defined in src/styles.css (`ios-shimmer`).
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("ios-skeleton rounded-lg", className)} {...props} />;
}

export { Skeleton };
