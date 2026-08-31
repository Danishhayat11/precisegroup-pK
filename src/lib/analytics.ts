/**
 * Lightweight, provider-agnostic analytics dispatcher.
 *
 * Tries in order:
 *   1. window.posthog.capture
 *   2. window.gtag('event', ...)
 *   3. window.dataLayer.push
 *   4. console.info (dev fallback)
 *
 * Safe on SSR (no-op when window is undefined) and never throws.
 */
type AnalyticsProps = Record<string, unknown>;

type PosthogLike = { capture: (event: string, props?: AnalyticsProps) => void };
type GtagLike = (command: "event", event: string, props?: AnalyticsProps) => void;

declare global {
  interface Window {
    posthog?: PosthogLike;
    gtag?: GtagLike;
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function track(event: string, props: AnalyticsProps = {}): void {
  if (typeof window === "undefined") return;
  const payload = { ...props, ts: Date.now() };
  try {
    if (window.posthog?.capture) {
      window.posthog.capture(event, payload);
      return;
    }
    if (typeof window.gtag === "function") {
      window.gtag("event", event, payload);
      return;
    }
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event, ...payload });
      return;
    }
    if (import.meta.env.DEV) {
      console.info("[analytics]", event, payload);
    }
  } catch {
    // Never let analytics break the UI.
  }
}
