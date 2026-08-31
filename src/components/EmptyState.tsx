import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
};

/**
 * iOS-style empty state — soft rounded glyph disc, quiet copy, optional CTA.
 * Use inside cards, dialogs, and table bodies (wrap in a <td colSpan>).
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 py-8 px-4" : "gap-3 py-14 px-6",
        "animate-fade-in",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-2xl",
          "border border-border/60 bg-gradient-to-b from-muted/40 to-transparent",
          "shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06)]",
          compact ? "h-10 w-10" : "h-14 w-14",
        )}
      >
        <Icon
          className={cn("text-muted-foreground", compact ? "h-5 w-5" : "h-6 w-6")}
          strokeWidth={1.5}
        />
      </div>
      <div className="space-y-1">
        <p
          className={cn(
            "font-semibold tracking-tight text-foreground",
            compact ? "text-sm" : "text-base",
          )}
        >
          {title}
        </p>
        {description ? (
          <p
            className={cn(
              "mx-auto max-w-sm text-muted-foreground",
              compact ? "text-xs" : "text-sm",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
