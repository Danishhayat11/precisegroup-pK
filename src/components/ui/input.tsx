import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Base
          "flex h-9.5 w-full rounded-xl border border-input bg-card/60 px-3.5 py-1.5 text-base shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] md:text-sm backdrop-blur-xs",
          // Motion
          "transition-[color,border-color,box-shadow,background-color] duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
          // File input reset
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          // Placeholder token
          "placeholder:text-muted-foreground/70",
          // Hover — hairline deepens toward foreground
          "hover:border-foreground/25 hover:bg-card/80",
          // Focus — macOS focus ring + soft halo
          "focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:bg-white dark:focus-visible:bg-black/50",
          // Error via aria-invalid
          "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25",
          // Disabled
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/60 disabled:hover:border-input",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
