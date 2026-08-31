import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-xl border border-input bg-card/60 px-3.5 py-2.5 text-base shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] md:text-sm backdrop-blur-xs",
          "transition-[color,border-color,box-shadow,background-color] duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
          "placeholder:text-muted-foreground/70",
          "hover:border-foreground/25 hover:bg-card/80",
          "focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:bg-white dark:focus-visible:bg-black/50",
          "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/60 disabled:hover:border-input",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
