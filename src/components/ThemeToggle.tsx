import { Moon, Sun, Monitor, Check, Zap, ZapOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme, type Theme, type MotionPref } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

const options: { value: Theme; label: string; Icon: typeof Sun; hint: string }[] = [
  { value: "light", label: "Light", Icon: Sun, hint: "Always light theme" },
  { value: "dark", label: "Dark", Icon: Moon, hint: "Always dark theme" },
  { value: "system", label: "System", Icon: Monitor, hint: "Match your operating system" },
];

const LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export function ThemeToggle() {
  const {
    theme,
    resolved,
    setTheme,
    motionPref,
    setMotionPref,
    reducedMotion,
    systemReducedMotion,
  } = useTheme();
  // The TRIGGER icon reflects the selected MODE (Light/Dark/System), so users
  // can tell they picked "System" — the previous version always rendered the
  // resolved icon (Sun/Moon), which made System indistinguishable from Light
  // or Dark. A small resolved-theme dot in the corner still communicates what
  // System resolved to right now.
  const prefersReducedMotion = useReducedMotion();
  // Hydration safety. Two independent sources of SSR/CSR drift:
  //   1. `useTheme()` returns the DEFAULT theme on the server but the
  //      persisted value (from localStorage) on the client — so `theme`,
  //      `resolved`, `SelectedIcon`, and the aria-label all differ on
  //      first paint whenever the user has picked a non-default mode.
  //   2. Framer Motion serializes inline styles as strings during SSR
  //      (`opacity: "1"`) while the client hydration writes numeric
  //      values (`opacity: 1`), which React flags as a mismatch even
  //      when the visual result is identical.
  // Both are silenced by rendering a stable, theme-neutral placeholder
  // until after mount, then swapping in the real, theme-aware tree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Pre-mount values are intentionally NEUTRAL — they must not read from
  // useTheme(), because that value differs between server and client.
  const displayTheme: Theme = mounted ? theme : "system";
  const displayResolved = mounted ? resolved : "light";
  const SelectedIcon = ICONS[displayTheme];

  const triggerLabel = !mounted
    ? "Change theme"
    : theme === "system"
      ? `Theme: System (currently ${LABELS[resolved].toLowerCase()}). Change theme.`
      : `Theme: ${LABELS[theme]}. Change theme.`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={[
            "rounded-full relative overflow-visible",
            // WCAG 2.5.5: guarantee ≥ 44×44 tap target at every breakpoint.
            "min-h-[44px] min-w-[44px]",
            "focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-ring focus-visible:ring-offset-2",
            "focus-visible:ring-offset-background",
          ].join(" ")}
          aria-label={triggerLabel}
          title={triggerLabel}
        >
          {/* suppressHydrationWarning covers any residual style-string vs
              style-number diff that framer-motion emits on the very first
              client render before our mounted-gate flips. */}
          <span className="relative grid h-4 w-4 place-items-center" suppressHydrationWarning>
            {mounted ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={displayTheme}
                  initial={
                    prefersReducedMotion ? { opacity: 0 } : { y: -8, opacity: 0, rotate: -20 }
                  }
                  animate={prefersReducedMotion ? { opacity: 1 } : { y: 0, opacity: 1, rotate: 0 }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { y: 8, opacity: 0, rotate: 20 }}
                  transition={
                    prefersReducedMotion
                      ? { duration: 0 }
                      : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                  }
                  className="absolute inset-0 grid place-items-center"
                  aria-hidden="true"
                >
                  <SelectedIcon className="h-4 w-4" aria-hidden="true" focusable="false" />
                </motion.span>
              </AnimatePresence>
            ) : (
              <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
                <SelectedIcon className="h-4 w-4" aria-hidden="true" focusable="false" />
              </span>
            )}
          </span>

          {/* Resolved-theme indicator dot — bottom-right of the icon. Only
              visible when theme === "system"; otherwise the selected icon
              already communicates the applied theme. Gated on `mounted`
              because `theme` and `resolved` are SSR-unstable. */}
          {mounted && theme === "system" && (
            <span
              aria-hidden="true"
              className={[
                "pointer-events-none absolute -bottom-0.5 -right-0.5",
                "h-2 w-2 rounded-full ring-2 ring-background",
                displayResolved === "dark" ? "bg-foreground" : "bg-primary",
              ].join(" ")}
            />
          )}

          {/* Announces both mode and resolved theme to screen readers.
              Also gated on mount for the same SSR-drift reason. */}
          <span className="sr-only" aria-live="polite">
            {!mounted
              ? "Theme"
              : theme === "system"
                ? `Theme mode: System. Currently applied: ${LABELS[resolved].toLowerCase()}.`
                : `Theme mode: ${LABELS[theme]}. Currently applied: ${LABELS[resolved].toLowerCase()}.`}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64" aria-label="Theme">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Appearance</span>
          <span
            className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            aria-hidden="true"
          >
            {resolved === "dark" ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
            {LABELS[resolved]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {options.map(({ value, label, Icon, hint }) => {
            const isSelected = theme === value;
            const isApplied = value === "system" ? theme === "system" : resolved === value;
            return (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                // Remove the default left indicator slot — we render our own
                // richer row with icon + label + status pill.
                className={[
                  "gap-3 pl-2 pr-2 py-2 [&>span:first-child]:hidden",
                  isSelected ? "bg-accent/60 focus:bg-accent" : "",
                ].join(" ")}
                aria-label={`${label}. ${hint}${isSelected ? ". Selected." : ""}`}
              >
                <span
                  className={[
                    "grid h-8 w-8 shrink-0 place-items-center rounded-md border",
                    isSelected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-muted/40 text-muted-foreground",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {label}
                    {value === "system" && (
                      <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        · resolves to {LABELS[resolved].toLowerCase()}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {isApplied && !isSelected ? `${hint} · applied` : hint}
                  </span>
                </span>
                {isSelected && (
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                )}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        {/* ── Motion preference ─────────────────────────────────────
           User override for `prefers-reduced-motion`. "System" defers
           to the OS media query; "Reduce" forces motion off even if
           the OS is on; "Full" forces motion on even if the OS asks
           to reduce. Persisted in localStorage under `precise.motion`
           and applied via the `<html data-reduced-motion>` selector
           in `src/styles.css`. */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Motion</span>
          <span
            className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            aria-live="polite"
          >
            {reducedMotion ? (
              <ZapOff className="h-3 w-3" aria-hidden />
            ) : (
              <Zap className="h-3 w-3" aria-hidden />
            )}
            {reducedMotion ? "Reduced" : "Full"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={motionPref}
          onValueChange={(v) => setMotionPref(v as MotionPref)}
        >
          {[
            {
              value: "system" as MotionPref,
              label: "System",
              Icon: Monitor,
              hint: `Match your OS · currently ${systemReducedMotion ? "reduced" : "full"}`,
            },
            {
              value: "no-preference" as MotionPref,
              label: "Full motion",
              Icon: Zap,
              hint: "Force animations on",
            },
            {
              value: "reduce" as MotionPref,
              label: "Reduce motion",
              Icon: ZapOff,
              hint: "Force animations off",
            },
          ].map(({ value, label, Icon, hint }) => {
            const isSelected = motionPref === value;
            return (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                className={[
                  "gap-3 pl-2 pr-2 py-2 [&>span:first-child]:hidden",
                  isSelected ? "bg-accent/60 focus:bg-accent" : "",
                ].join(" ")}
                aria-label={`${label}. ${hint}${isSelected ? ". Selected." : ""}`}
              >
                <span
                  className={[
                    "grid h-8 w-8 shrink-0 place-items-center rounded-md border",
                    isSelected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-muted/40 text-muted-foreground",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-[11px] text-muted-foreground">{hint}</span>
                </span>
                {isSelected && (
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                )}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
          Saved to this browser · syncs across tabs
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
