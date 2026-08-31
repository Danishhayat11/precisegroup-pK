import { Wifi, WifiOff, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Status values map 1:1 to what Supabase Realtime reports via
 * `channel.subscribe((status, err) => …)`:
 *
 *   - "connecting"      → initial subscribe in-flight, no ack yet
 *   - "connected"       → SUBSCRIBED, receiving events
 *   - "reconnecting"    → transient close/timeout; realtime-js will
 *                         auto-retry with backoff
 *   - "error"           → CHANNEL_ERROR or exhausted retries; app is
 *                         serving CACHED / MANUALLY-REFRESHED data
 *                         until the user reloads or connectivity
 *                         recovers
 *
 * The indicator is intentionally small and unobtrusive during the
 * "connected" state (single dot + hidden label) and expands to a
 * readable pill only when something is wrong — the classic pattern
 * used by Slack/Figma/Notion for connection health, so users only
 * pay attention to it when they need to.
 */
export type RealtimeStatus = "connecting" | "connected" | "reconnecting" | "error";

const PRESET: Record<
  RealtimeStatus,
  {
    label: string;
    srLabel: string;
    Icon: typeof Wifi;
    dotClass: string;
    pillClass: string;
    animate: boolean;
  }
> = {
  connecting: {
    label: "Connecting…",
    srLabel: "Live updates connecting",
    Icon: Loader2,
    dotClass: "bg-muted-foreground/60",
    pillClass: "text-muted-foreground border-border/60 bg-muted/40",
    animate: true,
  },
  connected: {
    label: "Live",
    srLabel: "Live updates connected",
    Icon: Wifi,
    // Emerald conveys "healthy connection" across every major SaaS
    // status indicator. Kept faint (dot only in the compact form) so
    // it fades into the chrome once users trust it.
    dotClass: "bg-emerald-500",
    pillClass: "text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
    animate: false,
  },
  reconnecting: {
    label: "Reconnecting…",
    srLabel: "Live updates reconnecting",
    Icon: Loader2,
    dotClass: "bg-amber-500",
    pillClass: "text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/10",
    animate: true,
  },
  error: {
    label: "Offline",
    srLabel: "Live updates offline — showing last known data. Refresh to sync.",
    Icon: WifiOff,
    dotClass: "bg-destructive",
    pillClass: "text-destructive border-destructive/40 bg-destructive/10",
    animate: false,
  },
};

export function RealtimeStatusIndicator({
  status,
  onRetry,
  className,
}: {
  status: RealtimeStatus;
  /**
   * Optional retry hook. When provided AND the status is "error", the
   * indicator becomes a button that re-attempts the subscription
   * (parent typically triggers `queryClient.invalidateQueries` +
   * `channel.subscribe()` teardown/rebuild).
   */
  onRetry?: () => void;
  className?: string;
}) {
  const preset = PRESET[status];
  const Icon = preset.Icon;
  const isProblem = status === "error";
  const isTransient = status === "connecting" || status === "reconnecting";

  // Compact form (a single dot + sr-only label) when everything is
  // healthy; expanded pill with icon + text when something needs the
  // user's attention or is in-flight.
  const compact = status === "connected";

  const commonProps = {
    role: "status" as const,
    "aria-live": (isProblem ? "polite" : "off") as "polite" | "off",
    "aria-label": preset.srLabel,
    title: preset.srLabel,
  };

  if (compact) {
    return (
      <span
        {...commonProps}
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-2 w-2 rounded-full shadow-[0_0_0_2px_hsl(var(--background))] transition-all duration-200",
            preset.dotClass,
          )}
        />
        <span className="hidden md:inline">{preset.label}</span>
        <span className="sr-only">{preset.srLabel}</span>
      </span>
    );
  }

  const inner = (
    <>
      <Icon aria-hidden="true" className={cn("h-3 w-3", preset.animate && "animate-spin")} />
      <span>{preset.label}</span>
      {isProblem && onRetry && <span className="opacity-70 group-hover:opacity-100">· Retry</span>}
    </>
  );

  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all duration-200 backdrop-blur-sm",
    preset.pillClass,
    isProblem && onRetry && "group cursor-pointer hover:brightness-105",
    className,
  );

  if (isProblem && onRetry) {
    return (
      <button
        type="button"
        {...commonProps}
        onClick={onRetry}
        aria-label={`${preset.srLabel} Click to retry.`}
        className={classes}
      >
        {inner}
      </button>
    );
  }

  // Non-interactive pill for transient / error-without-retry cases.
  // Include an AlertTriangle marker for the error state so it reads
  // as a warning even without color perception.
  return (
    <span {...commonProps} className={classes}>
      {inner}
      {isProblem && !onRetry && <AlertTriangle aria-hidden="true" className="h-3 w-3" />}
      {isTransient && <span className="sr-only">Reconnection in progress.</span>}
    </span>
  );
}
