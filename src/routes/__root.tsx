import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { PageTransition } from "@/components/motion/PageTransition";
import { RouteProgress } from "@/components/motion/RouteProgress";
import { ThemeAnnouncer } from "@/components/ThemeAnnouncer";
import { easeSignature } from "@/lib/motion";

import appCss from "../styles.css?url";
import "@fontsource/sora/500.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
// Inter — primary sans for the authenticated dashboard/admin surfaces
// (scoped via [data-theme="ios"] in src/styles.css). The public /site
// marketing pages continue to use Manrope/Sora.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
// Critical font subsets used for the first paint on the marketing site:
// Manrope 400 (body copy / .site-lead / .site-prose), Sora 600 (kickers and
// mid-weight display), and Sora 700 (.site-h1 / .site-h2 headings — the
// largest text on the page and therefore the biggest CLS risk if it swaps
// in late). Imported as `?url` so Vite fingerprints them and we can preload
// the exact same hashed asset the @font-face rules reference — that
// guarantees the preload is a cache hit, not a duplicate fetch. Other
// weights load on-demand from the @fontsource CSS above.
import manrope400Woff2 from "@fontsource/manrope/files/manrope-latin-400-normal.woff2?url";
import manrope700Woff2 from "@fontsource/manrope/files/manrope-latin-700-normal.woff2?url";
import sora600Woff2 from "@fontsource/sora/files/sora-latin-600-normal.woff2?url";
import sora700Woff2 from "@fontsource/sora/files/sora-latin-700-normal.woff2?url";
// Inter is the web-font fallback inside `--font-ios` (used by the /site
// editorial ramp AND the dashboard iOS theme). On Apple devices SF Pro
// matches first and Inter never fetches; on Linux / Windows / Android
// Inter is what actually renders — so preloading 400 (body) and 700
// (site-h1/h2/h3) prevents the marketing headings from swapping late.
import inter400Woff2 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import inter700Woff2 from "@fontsource/inter/files/inter-latin-700-normal.woff2?url";

import { useAutoRetry } from "../lib/useAutoRetry";
import { getOrCreateErrorId } from "../lib/error-id";
import { ErrorRef } from "../components/ErrorRef";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";
import { UpdateBanner } from "@/pwa/UpdateBanner";
import { InstallPrompt } from "@/pwa/InstallPrompt";

import { useOverflowGuard } from "@/lib/overflow-guard";
import {
  ThemeProvider,
  THEME_INIT_SCRIPT,
  THEME_COLOR_LIGHT,
  THEME_COLOR_META_ID,
} from "@/lib/theme";

function NotFoundComponent() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const shouldRedirectToLogin = pathname === "/superadmin";

  useEffect(() => {
    if (!shouldRedirectToLogin) return;
    void router.navigate({
      to: "/login" as never,
      search: { next: pathname } as never,
      replace: true,
    });
  }, [pathname, router, shouldRedirectToLogin]);

  if (shouldRedirectToLogin) {
    return (
      <main
        className="flex min-h-dvh items-center justify-center bg-background px-4"
        role="status"
        aria-live="polite"
      >
        <div className="max-w-md text-center text-sm text-muted-foreground">
          Redirecting to sign in…
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-bold text-foreground">404</h1>
        <h2 className="mt-4 font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  const auto = useAutoRetry({
    onRetry: () => {
      router.invalidate();
      reset();
    },
    resetKey: error,
  });
  const errorId = getOrCreateErrorId(error);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. We'll retry automatically — you can also refresh or head
          back home.
        </p>
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
          {auto.exhausted
            ? `Couldn't recover after ${auto.attempt} attempts. Please try again.`
            : auto.isRetrying
              ? `Retrying now (attempt ${auto.attempt + 1})…`
              : `Retrying automatically in ${auto.secondsUntilRetry}s (attempt ${auto.attempt + 1})…`}
        </p>
        <ErrorRef id={errorId} />
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={auto.retryNow}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

const SITE_NAME = "Precise ERP";
const ORG_NAME = "Precise Realtors & Builders";
const SITE_TITLE = "Precise ERP — Real Estate Operations";
const SITE_DESCRIPTION =
  "A premium ERP for Precise Realtors & Builders to manage projects, bookings, and installments";
const SOCIAL_DESCRIPTION = "Real-estate operations management for Precise Realtors & Builders";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "author", content: ORG_NAME },
      { name: "color-scheme", content: "light dark" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SOCIAL_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "en_PK" },
      { property: "og:image", content: "https://precisegroup-pk.lovable.app/og-image.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: `${ORG_NAME} — premium real estate in Islamabad` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://precisegroup-pk.lovable.app/og-image.jpg" },
      { name: "twitter:image:alt", content: `${ORG_NAME} — premium real estate in Islamabad` },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Preload the woff2 subsets used by first paint so text lands in its
      // final typeface before the swap event fires. `crossOrigin=anonymous`
      // matches the @font-face fetch mode Vite emits — mismatched CORS on
      // the preload causes the browser to re-fetch the font, negating the
      // preload entirely. Weights chosen to cover the visible-above-fold
      // hierarchy: 400 body copy and 700 headings for each family.
      //
      //   • Inter    → /site editorial ramp + dashboard iOS theme on
      //                non-Apple devices (Apple picks SF Pro first).
      //   • Manrope  → alternate body font on any surface outside the iOS
      //                theme scope (still referenced by --font-sans).
      //   • Sora     → display headings in the same non-iOS scope.
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: inter400Woff2,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: inter700Woff2,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: manrope400Woff2,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: manrope700Woff2,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: sora600Woff2,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: sora700Woff2,
        crossOrigin: "anonymous",
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },

      // Non-render-blocking web fonts: preload the CSS as a resource and let
      // the swap script (see `scripts` below) promote it to a stylesheet on
      // load. `display=swap` in the URL keeps fallback typography visible
      // while the web fonts arrive, so there is no invisible-text flash.
      {
        rel: "preload",
        as: "style",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Urbanist:wght@500;600;700;800&family=Epilogue:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,700&display=swap",
      },
      // Brand favicons — champagne monogram on navy. Multi-size PNG set
      // plus a legacy .ico fallback for older crawlers.
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/favicon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/favicon-512.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/favicon-180.png" },
    ],
    scripts: [
      {
        // Promote the preloaded Google Fonts CSS to an active stylesheet on
        // load — keeps the request non render-blocking without needing an
        // `onLoad` attribute on the <link>.
        children:
          "(function(){var h='https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Urbanist:wght@500;600;700;800&family=Epilogue:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,700&display=swap';var l=document.createElement('link');l.rel='stylesheet';l.href=h;l.media='print';l.onload=function(){l.media='all'};document.head.appendChild(l);})();",
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          "@id": "https://precisegroup-pk.lovable.app/#organization",
          name: ORG_NAME,
          alternateName: "Precise Realtors and Builders",
          url: "https://precisegroup-pk.lovable.app/site",
          description:
            "Real estate developer behind the Manal Arcade project; operator of the Precise ERP platform for bookings, payments, and client document management.",
          industry: "Real Estate",
          areaServed: [
            { "@type": "City", name: "Islamabad" },
            { "@type": "City", name: "Rawalpindi" },
            { "@type": "Country", name: "Pakistan" },
          ],
          address: {
            "@type": "PostalAddress",
            addressLocality: "Islamabad",
            addressRegion: "Islamabad Capital Territory",
            addressCountry: "PK",
          },
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE_NAME,
          url: "https://precisegroup-pk.lovable.app/site",
          description: SITE_DESCRIPTION,
          publisher: { "@id": "https://precisegroup-pk.lovable.app/#organization" },
          inLanguage: "en-PK",
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // Server renders <html lang="en"> with no theme class or color-scheme so
  // the SSR HTML and the client's initial React tree match exactly. The
  // pre-hydration script (THEME_INIT_SCRIPT) mutates the live DOM to the
  // stored/system theme before React hydrates; `suppressHydrationWarning`
  // permits that intentional DOM-vs-vdom divergence on <html>.
  return (
    <html lang="en-PK" suppressHydrationWarning>
      <head suppressHydrationWarning>
        {/* suppressHydrationWarning on <head> silences a dev-only
            mismatch: the Lovable dev-source injector tags the <head>
            element with `data-tsd-source` values that differ between
            the SSR bundle (post-transform line offsets) and the
            client bundle. Application code doesn't set this attribute
            and the attribute has no runtime meaning, so silencing the
            warning at this element is safe and does not mask real
            content mismatches (children are still checked). */}
        {/* Single dynamic theme-color <meta>. The SSR value is the light
            literal; THEME_INIT_SCRIPT rewrites `content` to the dark literal
            pre-hydration when the stored/system theme resolves to dark, and
            ThemeProvider keeps it in sync on runtime theme changes. Emitted
            directly in the shell (not via head()) so we control the element
            id — TanStack Router's head() also dedupes <meta> by `name`. */}
        <meta id={THEME_COLOR_META_ID} name="theme-color" content={THEME_COLOR_LIGHT} />
        {/* Installable PWA manifest (Precise ERP). Emitted here — not via
            head() — because TanStack Router's head() dedupes <link rel="manifest">. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Precise ERP" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />

        <HeadContent />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // Dev-only: warn once per (route, signal) if the page overflows
  // horizontally or has been scrolled sideways. Tree-shaken in prod.
  useOverflowGuard();

  // Dev-only Supabase mock. No-op unless VITE_SUPABASE_MOCK=1 in dev.
  useEffect(() => {
    if (typeof window === "undefined") return;
    void import("@/lib/dev/supabase-mock").then((m) => m.installSupabaseMockIfEnabled());
  }, []);

  // Install console capture early so the print debug bundle can include
  // recent log/warn/error output when the user asks for a diagnostic dump.
  useEffect(() => {
    if (typeof window === "undefined") return;
    void import("@/lib/printDebugBundle").then((m) => m.installConsoleCapture());
  }, []);

  // App-wide startup: HEAD every team headshot AVIF/WebP/JPG URL exactly
  // once per session, on any entry route (not only /site). Failures land in
  // the console + `team-headshot:error` event stream so QA sees CDN 404s
  // regardless of where a user first lands. In-flight requests are cached
  // in localStorage (24h) so this is a cheap no-op on repeat visits.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const run = () =>
      Promise.all([
        import("@/lib/site/teamHeadshotHealthCheck"),
        import("@/lib/site/teamHeadshotGroups"),
      ])
        .then(([mod, groupsMod]) => {
          if (cancelled) return;
          return mod.runTeamHeadshotHealthCheck(groupsMod.TEAM_HEADSHOT_GROUPS);
        })
        .catch((err) => {
          console.warn("[TeamHeadshot] startup health check failed to run", err);
        });
    // Defer to idle so the check never competes with LCP work.
    const idle = (
      window as typeof window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof idle === "function") {
      idle(run, { timeout: 3000 });
    } else {
      setTimeout(run, 1200);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MotionConfig reducedMotion="user" transition={{ duration: 0.3, ease: [...easeSignature] }}>
          <TooltipProvider>
            <AuthProvider>
              <RouteProgress />
              <ThemeAnnouncer />
              <UpdateBanner />
              {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
              <PageTransition>
                <Outlet />
              </PageTransition>
              <InstallPrompt />
              <Toaster />
              <Sonner />
            </AuthProvider>
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
