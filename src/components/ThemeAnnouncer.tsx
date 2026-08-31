import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

/**
 * Screen-reader-only live region that announces OS-initiated changes to the
 * resolved color scheme and reduced-motion preference.
 *
 * - Theme announcements fire only when `theme === "system"` and the resolved
 *   scheme flips — i.e. the OS changed under us. Manual toggles already have
 *   an accessible name on the theme control itself, so we don't double-speak.
 * - Reduced-motion announcements fire on every OS change (there's no manual
 *   UI for it in-app, so every change is OS-initiated).
 *
 * Uses `aria-live="polite"` so announcements never interrupt the user, and
 * `role="status"` so assistive tech recognizes it as a status region.
 */
export function ThemeAnnouncer() {
  const { theme, resolved, reducedMotion } = useTheme();
  const [message, setMessage] = useState("");

  // Track previous values so we can distinguish "changed" from "initial mount"
  // (SSR renders with defaults; we never want to announce on first paint).
  const firstRun = useRef(true);
  const prevResolved = useRef(resolved);
  const prevReducedMotion = useRef(reducedMotion);
  const prevTheme = useRef(theme);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      prevResolved.current = resolved;
      prevReducedMotion.current = reducedMotion;
      prevTheme.current = theme;
      return;
    }

    const announcements: string[] = [];

    // Only announce a theme change when the user is deferring to the OS.
    // When the user is on "light" or "dark" explicitly, resolved can only
    // change via their own toggle — which has its own accessible label.
    const themeUnchanged = prevTheme.current === theme;
    if (themeUnchanged && theme === "system" && prevResolved.current !== resolved) {
      announcements.push(
        `System appearance changed. ${resolved === "dark" ? "Dark" : "Light"} mode is now active.`,
      );
    }

    if (prevReducedMotion.current !== reducedMotion) {
      announcements.push(
        reducedMotion
          ? "Reduced motion is now on. Animations will be minimized."
          : "Reduced motion is now off. Animations restored.",
      );
    }

    if (announcements.length > 0) {
      // Force the live region to re-fire even for the same text by prepending
      // a zero-width space when the message would otherwise be identical.
      setMessage((prev) => {
        const next = announcements.join(" ");
        return prev === next ? `\u200B${next}` : next;
      });
    }

    prevResolved.current = resolved;
    prevReducedMotion.current = reducedMotion;
    prevTheme.current = theme;
  }, [theme, resolved, reducedMotion]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      // Visually hidden but still available to assistive tech.
      className="sr-only"
    >
      {message}
    </div>
  );
}
