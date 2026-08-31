import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wider transition-all select-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary hover:bg-primary/25 backdrop-blur-md shadow-sm",
        secondary:
          "border-transparent bg-secondary/80 text-secondary-foreground hover:bg-secondary backdrop-blur-md shadow-sm",
        destructive:
          "border-transparent bg-destructive/15 text-destructive hover:bg-destructive/25 backdrop-blur-md shadow-sm",
        outline: "text-foreground border-border/40 bg-white/5 dark:bg-black/10 backdrop-blur-md shadow-sm",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeTone =
  | "high"
  | "medium"
  | "low"
  | "active"
  | "completed"
  | "pending"
  | "overdue"
  | "paid";

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  /**
   * Semantic status tone. When set, scoped iOS design-system CSS applies the
   * spec pill tint (e.g. HIGH → red text on red-tinted bg). Overrides variant.
   */
  tone?: BadgeTone;
}

function Badge({ className, variant, tone, ...props }: BadgeProps) {
  return (
    <div
      data-slot="badge"
      data-status={tone}
      data-tone={tone}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
