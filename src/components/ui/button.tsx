import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    // Layout + typography
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium cursor-pointer select-none",
    // Motion tokens — high-precision spring timing
    "transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
    // Focus ring — Mac-style soft halo
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
    // Active/pressed — Apple tactile press
    "active:scale-[0.96]",
    // Disabled — no shadow, no motion, no filter, cursor blocked
    "disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:scale-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-none",
    // Error state via aria-invalid
    "aria-invalid:ring-4 aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
    // Icons
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-primary/90 to-primary text-primary-foreground font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.2)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.05)] border border-primary/50 relative overflow-hidden after:absolute after:inset-0 after:bg-gradient-to-b after:from-white/10 after:to-transparent after:opacity-0 hover:after:opacity-100 after:transition-opacity",
        destructive:
          "bg-gradient-to-b from-destructive/90 to-destructive text-white font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_8px_20px_rgba(255,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.2)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm border border-destructive/50",
        outline:
          "border border-border/40 bg-white/5 dark:bg-black/10 backdrop-blur-md text-foreground font-medium shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-white/40 dark:hover:bg-white/10 hover:border-foreground/20 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] hover:-translate-y-0.5 active:translate-y-0",
        secondary:
          "bg-secondary/70 backdrop-blur-lg text-secondary-foreground font-medium shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-white/20 dark:border-white/5 hover:bg-secondary/90 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:translate-y-0",
        ghost: "text-foreground font-medium hover:bg-foreground/5 hover:text-foreground",
        link: "text-primary font-medium underline-offset-4 hover:underline active:opacity-70",
      },
      size: {
        // Mobile/tablet meet WCAG 2.5.5 (≥44×44); lg: restores compact desktop sizing.
        default: "h-11 px-5 py-2 lg:h-9 rounded-full",
        sm: "h-11 rounded-full px-4 text-xs lg:h-8",
        lg: "h-12 rounded-full px-8 lg:h-10 text-base",
        icon: "h-11 w-11 lg:h-9 lg:w-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

// --- Accessible-name safeguard for icon-only buttons ---------------------
// Icon-only buttons render no visible text (the child is an <svg>), so
// screen readers need an explicit accessible name. We enforce it at the
// TYPE level via a discriminated union on `size`:
//
//   • `size="icon"` → the prop bag MUST include a non-empty
//     `aria-label` or `aria-labelledby`. Omitting both is a compile-time
//     error, which fails `bun run build` / `tsgo`. This catches the
//     class of bug where a new header icon button ships without a
//     label and only surfaces in the a11y e2e suite.
//
//   • Any other size → props are unchanged, since text-labelled
//     buttons already carry their accessible name in `children`.
//
// `aria-labelledby` must point at an element whose text supplies the
// name — the type only guarantees the attribute is set to a string;
// the e2e `header-controls-names` spec validates it actually resolves.
type SizeVariant = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

type BaseButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "aria-labelledby"
> &
  Omit<VariantProps<typeof buttonVariants>, "size"> & {
    asChild?: boolean;
  };

type AccessibleName =
  | { "aria-label": string; "aria-labelledby"?: string }
  | { "aria-label"?: string; "aria-labelledby": string };

type IconButtonProps = BaseButtonProps & { size: "icon" } & AccessibleName;

type NonIconButtonProps = BaseButtonProps & {
  size?: Exclude<SizeVariant, "icon">;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export type ButtonProps = IconButtonProps | NonIconButtonProps;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
