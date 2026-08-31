/**
 * /site layout — Precise Realtors & Builders marketing surface.
 *
 * Palette: warm off-white base, deep charcoal ink, slate secondary,
 * champagne gold accent. Serif display (Playfair) + Inter body. Lives
 * outside the ERP auth tree so anonymous visitors can browse freely.
 */
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Phone, ArrowUpRight } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";
import { ObsidianLoader } from "@/components/site/ObsidianLoader";

export const Route = createFileRoute("/site")({
  // theme-color is intentionally inherited from the root shell so the
  // media-scoped light/dark pair renders correctly (TanStack Router
  // dedupes <meta> by `name`, which would drop one half here).
  component: SiteLayout,
  // Only surface the loading state if a nested route pends >250ms — under
  // that threshold users perceive the swap as instantaneous, and flashing
  // a spinner for 80ms feels janky.
  pendingComponent: ObsidianLoader,
  pendingMs: 250,
  pendingMinMs: 400,
});

/**
 * Force the marketing surface to render in the light palette regardless of
 * the app's saved theme.
 *
 * The `/site` pages are an intentionally light-only editorial aesthetic
 * (Playfair display + charcoal ink on off-white, hero panels with hardcoded
 * arbitrary bg utilities, etc.). Tailwind v4 bakes theme colors into utility CSS at
 * build time via `@theme inline`, so overriding CSS custom properties on an
 * inner `.site-luxury` container does NOT change the compiled dark variants.
 * The only reliable way to keep contrast correct is to strip `.dark` from
 * `<html>` while the site tree is mounted, then restore it on unmount so the
 * app returns to whatever theme the user selected.
 */
function useForceLightThemeOnSite() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const prevColorScheme = root.style.colorScheme;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
    return () => {
      if (wasDark) root.classList.add("dark");
      root.style.colorScheme = prevColorScheme;
    };
  }, []);
}

function SiteLayout() {
  useForceLightThemeOnSite();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const showFab = pathname !== "/site/contact";
  return (
    <div
      data-theme="editorial"
      className="site-liquid min-h-svh text-foreground antialiased selection:bg-primary/25 selection:text-primary-foreground"
    >
      {/* iOS 26 liquid-glass aurora ambient wash */}
      <div aria-hidden className="lg-aurora" />

      <SiteHeader />
      <main className="pt-28">
        <Outlet />
      </main>
      <SiteFooter />

      {/* Floating iOS-26 liquid-glass action bar — lead conversion */}
      {showFab ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 md:hidden">
          <div className="lg-nav pointer-events-auto flex items-center gap-2 p-1.5">
            <a
              href="tel:+923445533767"
              aria-label="Call Precise Realtors"
              className="lg-btn-ghost min-h-11 px-4 text-[12px] uppercase tracking-[0.18em]"
            >
              <Phone className="h-4 w-4" /> Call
            </a>
            <Link
              to="/site/contact"
              className="lg-btn-primary lg-shine min-h-11 px-5 text-[12px] uppercase tracking-[0.18em]"
            >
              Enquire <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
