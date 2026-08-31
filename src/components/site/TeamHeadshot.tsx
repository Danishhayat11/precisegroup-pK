/**
 * TeamHeadshot — single source of truth for the /site team cards' portrait
 * media. Every team member (Mushtaq, Danish, Saeed ullah, …) renders through
 * this component so `srcSet`, `sizes`, aspect ratio, intrinsic dimensions,
 * lazy-loading, and alt-text policy cannot drift per-person.
 *
 * Contract:
 *   - `alt` is required. TS enforces it and we assert non-empty at runtime
 *     so decorative/empty alts can't slip through review.
 *   - Fixed 4:5 slot at 768×960 intrinsic → CLS-stable across all viewports.
 *   - `sizes` matches the 3-col leadership grid: full-width phone,
 *     ~50vw tablet, ~400px desktop slot. Do not override per instance —
 *     any grid change should be reflected here so all cards stay in sync.
 *   - Accepts either a full <picture> chain (`avifSrcSet` + `webpSrcSet` +
 *     `fallback`) or renders an initials tile when no photo is available yet.
 */
import * as React from "react";

// Responsive `sizes` for the leadership grid. Derived from the actual
// layout — do NOT change without also checking `Section` container padding
// and `.lg-tile` inner padding, or the browser will download the wrong
// srcset variant on every card.
//
//   Container `Section`:  max-w-7xl (1280px), px-5 (20) mobile, sm:px-10 (40)
//   Card `.lg-tile`:      p-4 (16) mobile, sm:p-5 (20)
//   Leadership grid:      grid-cols-1, md:grid-cols-3, gap-6 (24)
//
// Per-breakpoint effective image slot width (CSS px):
//   • <640px  (1 col):   100vw − 20·2 − 16·2 = 100vw − 72px
//   • 640–767 (1 col):   100vw − 40·2 − 20·2 = 100vw − 120px
//   • 768–1279 (3 col):  (100vw − 40·2 − 24·2) / 3 − 20·2
//                      = (100vw − 128px) / 3 − 40px
//   • ≥1280   (3 col, container capped): (1280 − 128) / 3 − 40 = 344px
//
// The browser picks the closest srcset entry (320/480/640/800/1000/1200/1600)
// after multiplying by DPR. With this hint a 2× retina desktop card
// (~344 CSS × 2 = 688) selects 800w instead of the previous 1200w — a
// ~35% smaller payload — while mobile (≤~320 CSS × 2 = 640) drops to
// 640w instead of 1000w+.
const SLOT_SIZES = [
  "(min-width: 1280px) 344px",
  "(min-width: 768px) calc((100vw - 128px) / 3 - 40px)",
  "(min-width: 640px) calc(100vw - 120px)",
  "calc(100vw - 72px)",
].join(", ");

export interface TeamHeadshotProps {
  /** Full name; used to derive initials for the placeholder tile. */
  name: string;
  /** Non-empty descriptive alt: subject, role, company, setting. Required. */
  alt: string;
  /** Optional AVIF srcSet across widths (320/480/640/800/1000/1200/1600). */
  avifSrcSet?: string;
  /** Optional WebP srcSet — same widths as AVIF. */
  webpSrcSet?: string;
  /** Optional JPG/PNG fallback URL for browsers without WebP/AVIF. */
  fallback?: string;
  /**
   * Optional ~1KB base64 data URI (JPEG/PNG/SVG) rendered blurred behind the
   * <picture> as a low-quality image placeholder. Fades out on img load so
   * the card shows a smooth color/shape preview while AVIF/WebP downloads.
   */
  lqip?: string;
  /** Optional decorative gradient overlay class chain (mix-blend-overlay). */
  overlayClassName?: string;
  /** Small uppercase pill in the corner ("Engineering leadership", etc.). */
  tag?: string;
  /**
   * When true, the browser is told to fetch and decode this portrait with
   * the highest priority possible: `loading="eager"`, `fetchpriority="high"`,
   * `decoding="sync"`. Set this on the first row of team cards (visible
   * without scrolling on desktop) so hero portraits like Saeed's paint on
   * initial view instead of waiting for lazy-load. Leave false (the default)
   * for anything below the fold — marking every image priority just
   * re-creates the un-prioritised state.
   */
  priority?: boolean;
  /**
   * `object-position` value for the <img>. Portraits framed slightly above
   * center (e.g. `"center 28%"`) keep the subject's face stable when the
   * 4:5 slot is squeezed to a narrower aspect on small screens or wider
   * card widths. Defaults to `"center 30%"` — a face-safe crop that works
   * for standard editorial headshots. Override per person only when their
   * source image needs it (framing high or off-center).
   *
   * Typed as a strict {@link ObjectPosition} union so typos (`"centre …"`),
   * unsupported units (`"30vh"`), `calc()` expressions, and >2 tokens are
   * caught at compile time. The runtime validator remains as a defense in
   * depth for values that slip past TS via `as ObjectPosition` casts or
   * `any`-typed callers.
   */
  objectPosition?: ObjectPosition;
}

/**
 * Compile-time `object-position` grammar for team portraits. Deliberately
 * narrower than the full CSS spec — we only allow the shapes that keep the
 * subject's face inside the 4:5 slot:
 *
 *   • 1 or 2 whitespace-separated tokens
 *   • each token is a keyword (`top` | `right` | `bottom` | `left` |
 *     `center`) OR a numeric length in `%` / `px` / `em` / `rem`
 *     (positive or negative, integer or fractional)
 *
 * Excluded on purpose: `calc()`, `vh`/`vw`/`vmin`/`vmax`, `ch`, `ex`,
 * `inherit` / `initial` / `unset`, and 3+ token strings. Those routinely
 * crop the face out on some breakpoint.
 *
 * NOTE on template-literal `${number}`: TypeScript accepts any numeric
 * literal (including `NaN`, `Infinity`, exponent notation). The runtime
 * validator inside {@link TeamHeadshot} still rejects those, so a caller
 * that manages to construct e.g. `"NaN%"` at the type level will fall
 * back to the default at render time with a `[TeamHeadshot]` warning.
 */
export type ObjectPositionKeyword = "top" | "right" | "bottom" | "left" | "center";
export type ObjectPositionUnit = "%" | "px" | "em" | "rem";
export type ObjectPositionLength =
  | `${number}${ObjectPositionUnit}`
  | `-${number}${ObjectPositionUnit}`;
export type ObjectPositionToken = ObjectPositionKeyword | ObjectPositionLength;
export type ObjectPosition = ObjectPositionToken | `${ObjectPositionToken} ${ObjectPositionToken}`;

function initialsFor(name: string): string {
  return name
    .replace(/\b(engr\.?|dr\.?|mr\.?|ms\.?|mrs\.?)\s*/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * Report a headshot load failure. Fires a `console.warn` (dev + prod so
 * QA can see it in the browser console), and dispatches a
 * `team-headshot:error` CustomEvent on `window` so external observability
 * (Sentry breadcrumbs, product analytics, Playwright regression tests)
 * can subscribe without importing this module.
 */
function reportHeadshotFailure(detail: {
  name: string;
  reason: "onError" | "cached-decode-failure";
  url: string | undefined;
  avifSrcSet: string | undefined;
  webpSrcSet: string | undefined;
  currentSrc: string | undefined;
}) {
  // Keep the warning single-line so it groups cleanly in the console.

  console.warn(
    `[TeamHeadshot] failed to load "${detail.name}" (${detail.reason}): ${detail.currentSrc ?? detail.url ?? "<no src>"}`,
    detail,
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("team-headshot:error", { detail }));
  }
}

/**
 * Validate an `object-position` value. Accepts the CSS grammar we actually
 * use for portraits: 1 or 2 tokens drawn from keywords (top/right/bottom/
 * left/center) or `<percentage>` / `<length>` (px, %, em, rem). This is
 * deliberately narrower than the full CSS spec — we don't want portraits
 * anchored with `calc()` or negative lengths, since those routinely crop
 * the subject's face out of the 4:5 slot.
 */
const OBJECT_POSITION_TOKEN = /^(top|right|bottom|left|center|-?\d+(?:\.\d+)?(?:px|%|em|rem))$/i;
function isValidObjectPosition(value: string): boolean {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 1 || tokens.length > 2) return false;
  return tokens.every((t) => OBJECT_POSITION_TOKEN.test(t));
}

const DEFAULT_OBJECT_POSITION = "center 30%";

/**
 * Minimal structural type for the optional `window.Sentry` global. Kept
 * inline (no `@sentry/browser` import) so this component doesn't add a
 * hard dependency or bundle weight when Sentry isn't loaded.
 */
type SentryLike = {
  captureMessage?: (
    msg: string,
    ctx?: {
      level?: "info" | "warning" | "error";
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    },
  ) => void;
  addBreadcrumb?: (b: {
    category: string;
    message: string;
    level?: "info" | "warning" | "error";
    data?: Record<string, unknown>;
  }) => void;
};

/**
 * Report an `objectPosition` validation failure to every observability
 * surface we care about:
 *
 *   1. `console.warn` — the primary QA signal, kept single-line so it
 *      groups cleanly in DevTools and shows up in Playwright's
 *      `page.on("console")`.
 *   2. `CustomEvent("team-headshot:objectPosition-invalid")` on `window`
 *      — lets any host page hook production monitoring (Datadog RUM,
 *      LogRocket, custom telemetry) without importing this module.
 *   3. `window.Sentry` (if present) — forwards a `warning`-level
 *      `captureMessage` with the member identifier (`name`) and the
 *      offending value as tags/extra, plus a breadcrumb so surrounding
 *      user actions are captured on the same issue. We deliberately do
 *      NOT import `@sentry/browser`; if the host page didn't load
 *      Sentry, this branch is a no-op.
 *
 * SSR-safe: every window-dependent branch is guarded, so calling this
 * during a server render (React 18 useMemo runs on the server too) is
 * harmless.
 */
function reportObjectPositionValidationFailure(detail: {
  name: string;
  reason: "missing" | "invalid";
  value: string | undefined;
  fallback: string;
}) {
  const summary =
    detail.reason === "missing"
      ? `[TeamHeadshot] missing objectPosition for "${detail.name}" — falling back to "${detail.fallback}". Set an explicit per-subject anchor (e.g. "center 22%") so the face stays framed across breakpoints.`
      : `[TeamHeadshot] invalid objectPosition="${detail.value}" for "${detail.name}" — falling back to "${detail.fallback}". Expected 1–2 tokens from {top,right,bottom,left,center} or a <percentage>/<length> (px, %, em, rem).`;

  console.warn(summary);

  if (typeof window === "undefined") return;

  // Non-Sentry observability hook — always dispatched so monitors that
  // don't route through Sentry still see the event.
  try {
    window.dispatchEvent(new CustomEvent("team-headshot:objectPosition-invalid", { detail }));
  } catch {
    /* CustomEvent unsupported — ignore */
  }

  const sentry = (window as unknown as { Sentry?: SentryLike }).Sentry;
  if (!sentry) return;
  try {
    sentry.addBreadcrumb?.({
      category: "ui.team-headshot",
      message: `objectPosition ${detail.reason}`,
      level: "warning",
      data: {
        member: detail.name,
        value: detail.value ?? null,
        fallback: detail.fallback,
      },
    });
    sentry.captureMessage?.(summary, {
      level: "warning",
      tags: {
        component: "TeamHeadshot",
        kind: "objectPosition",
        reason: detail.reason,
        // Tags are indexed & searchable in Sentry — keep the member id
        // and offending value here so ops can group / filter by them.
        member: detail.name,
      },
      extra: {
        value: detail.value ?? null,
        fallback: detail.fallback,
      },
    });
  } catch {
    /* Sentry global misbehaved — swallow so a broken monitor never
       cascades into a portrait render failure. */
  }
}

export function TeamHeadshot({
  name,
  alt,
  avifSrcSet,
  webpSrcSet,
  fallback,
  lqip,
  overlayClassName,
  tag,
  priority = false,
  objectPosition,
}: TeamHeadshotProps) {
  // Fail loud in dev — an empty alt is an accessibility regression, not a
  // presentation choice for team portraits.
  if (import.meta.env.DEV && !alt.trim()) {
    throw new Error(`TeamHeadshot: alt is required and must be non-empty (name="${name}")`);
  }

  // Validate `objectPosition` at runtime. TS enforces the string type but
  // can't catch typos ("centre 30%"), unsupported units ("30vh"), or a
  // caller that forgot to pass one entirely. Both cases silently break the
  // face crop, so warn loudly (dev + prod so QA sees it) and fall back to
  // the face-safe default rather than letting a bad value reach the DOM.
  const resolvedObjectPosition = React.useMemo(() => {
    if (objectPosition === undefined) {
      reportObjectPositionValidationFailure({
        name,
        reason: "missing",
        value: undefined,
        fallback: DEFAULT_OBJECT_POSITION,
      });
      return DEFAULT_OBJECT_POSITION;
    }
    if (!isValidObjectPosition(objectPosition)) {
      reportObjectPositionValidationFailure({
        name,
        reason: "invalid",
        value: objectPosition,
        fallback: DEFAULT_OBJECT_POSITION,
      });
      return DEFAULT_OBJECT_POSITION;
    }
    return objectPosition;
  }, [objectPosition, name]);

  const hasPhoto = Boolean(fallback && avifSrcSet && webpSrcSet);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  // Single source of truth for the media lifecycle. The fade-in only runs
  // when we transition to "loaded" — never on mount, never on error — so a
  // slow network can't briefly reveal a half-decoded frame, and a broken
  // URL can't leave the <img> stuck at opacity:0 waiting for an onLoad
  // that will never fire.
  type Status = "loading" | "loaded" | "error";
  const [status, setStatus] = React.useState<Status>("loading");
  const loaded = status === "loaded";
  const errored = status === "error";

  // Reconcile the state machine against the live <img> element. Runs on
  // mount, whenever the source changes (new headshot, hot reload), and
  // whenever the page is restored from the browser's back/forward cache
  // (`pageshow` with `persisted: true`) — in BFCache the component is not
  // remounted, so without this the fade-in would be stuck at whatever
  // state was frozen when the user navigated away.
  //
  // The browser flips `img.complete` to false the moment `src`/`srcSet`
  // changes, so a stale "loaded" from the previous URL can't leak through:
  // if the new bytes aren't ready we go back to "loading" and wait for
  // `onLoad` / `onError`. If they *are* ready (memory cache, disk cache,
  // service worker) we flip straight to "loaded" or "error" here because
  // neither event will re-fire for a resource that resolved before React
  // attached its listeners.
  const reconcile = React.useCallback(() => {
    const el = imgRef.current;
    if (!el) return;
    if (!el.complete) {
      setStatus("loading");
      return;
    }
    if (el.naturalWidth > 0) {
      setStatus("loaded");
      return;
    }
    setStatus("error");
    reportHeadshotFailure({
      name,
      reason: "cached-decode-failure",
      url: fallback,
      avifSrcSet,
      webpSrcSet,
      currentSrc: el.currentSrc || el.src,
    });
  }, [fallback, avifSrcSet, webpSrcSet, name]);

  React.useEffect(() => {
    reconcile();
  }, [reconcile]);

  React.useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (import.meta.env.DEV && event.persisted) {
        console.debug("[TeamHeadshot] BFCache restore — reconciling", { name });
      }
      reconcile();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reconcile, name]);

  const showPhoto = hasPhoto && !errored;

  return (
    <div
      className="lg-media relative aspect-[4/5] bg-muted"
      data-headshot-state={showPhoto ? status : errored ? "error" : "placeholder"}
      // Belt-and-braces CLS lock:
      //   • `aspectRatio` inline duplicates the `aspect-[4/5]` utility so
      //     the 4:5 slot survives if Tailwind's arbitrary-value class ever
      //     fails to compile (e.g. CSS purge, custom production build).
      //   • `contain: layout paint` scopes layout/paint work to this box
      //     so a slow portrait decode can't nudge sibling cards.
      // Together these guarantee the reserved height is stable from first
      // paint through decode — Saeed's 4:5 slot exists before any bytes
      // for the AVIF/WebP arrive.
      style={{ aspectRatio: "4 / 5", contain: "layout paint" }}
      // Announce the loading state to assistive tech while the portrait
      // decodes. `aria-busy` flips to `false` once the <img> fires onLoad
      // (status === "loaded") or falls back to the error/placeholder tile.
      aria-busy={showPhoto && status === "loading" ? true : undefined}
    >
      {showPhoto ? (
        <>
          {/* Skeleton shimmer: reserves the 4:5 slot visually while the
              AVIF/WebP decodes. Sits below the LQIP layer so the blurred
              preview (when available) still takes visual priority. Fades
              out on load in lockstep with the LQIP to avoid any flash. */}
          <div
            role="status"
            aria-live="polite"
            className={`pointer-events-none absolute inset-0 overflow-hidden bg-muted transition-opacity duration-500 ${
              loaded ? "opacity-0" : "opacity-100"
            }`}
          >
            <div
              aria-hidden
              className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-muted-foreground/10 to-muted"
            />
            <div aria-hidden className="skeleton-shimmer absolute inset-0" />
            <span className="sr-only">Loading portrait of {name}…</span>
          </div>

          {lqip ? (
            // Blurred LQIP layer: cheap CSS-only preview. `aria-hidden` since
            // the real <img> owns the accessible name. Fades out once the
            // AVIF/WebP finishes decoding so there's no double-image flash.
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 bg-cover bg-center transition-opacity duration-500 ${
                loaded ? "opacity-0" : "opacity-100"
              }`}
              style={{
                backgroundImage: `url("${lqip}")`,
                filter: "blur(18px)",
                transform: "scale(1.06)", // hide blur edge bleed
              }}
            />
          ) : null}

          <picture>
            <source type="image/avif" srcSet={avifSrcSet} sizes={SLOT_SIZES} />
            <source type="image/webp" srcSet={webpSrcSet} sizes={SLOT_SIZES} />
            <img
              src={fallback}
              alt={alt}
              sizes={SLOT_SIZES}
              loading={priority ? "eager" : "lazy"}
              // React 19 accepts lowercase `fetchpriority` and maps it to
              // the DOM attribute; do NOT camelCase this or TS complains.
              fetchPriority={priority ? "high" : "auto"}
              decoding={priority ? "sync" : "async"}
              width={768}
              height={960}
              ref={imgRef}
              onLoad={() => setStatus("loaded")}
              onError={(event) => {
                setStatus("error");
                const el = event.currentTarget;
                reportHeadshotFailure({
                  name,
                  reason: "onError",
                  url: fallback,
                  avifSrcSet,
                  webpSrcSet,
                  currentSrc: el.currentSrc || el.src,
                });
              }}
              // `objectPosition` is applied inline so per-subject overrides
              // win over the shared `object-cover` utility. The 4:5 slot is
              // fixed on every breakpoint, so a single anchor point keeps
              // the face in the same spot on 375px, 768px, 1280px, and the
              // hover-scale transform.
              style={{ objectPosition: resolvedObjectPosition }}
              className={`relative h-full w-full object-cover transition-all duration-700 group-hover:scale-[1.04] ${
                loaded ? "opacity-100" : "opacity-0"
              }`}
            />
          </picture>
        </>
      ) : errored ? (
        // Styled error placeholder. Rendered when every AVIF/WebP/JPG
        // variant failed to decode (offline, 404, corrupt file, CSP block).
        // This branch is intentionally distinct from the "no photo yet"
        // initials tile below so QA and end users can tell a failure apart
        // from a member whose portrait is genuinely not shot yet.
        //
        // The `team-headshot:error` CustomEvent and `console.warn` are
        // still dispatched by `reportHeadshotFailure` in the onError /
        // reconcile paths above — this branch only changes what the user
        // sees on the card.
        <div
          role="img"
          aria-label={`${alt} — photo unavailable`}
          data-headshot-fallback="error"
          className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden bg-[radial-gradient(circle_at_50%_35%,hsl(var(--muted))_0%,hsl(var(--background))_75%)] p-4 text-center"
        >
          {/* Subtle gold ring framing the monogram — matches the /site lg-pill accent. */}
          <span
            aria-hidden
            className="flex h-20 w-20 items-center justify-center rounded-full border border-[var(--gold)]/40 bg-background/60 shadow-[inset_0_0_0_1px_rgba(201,169,97,0.15)]"
          >
            <span className="font-serif text-3xl tracking-[0.08em] text-[var(--gold)]">
              {initialsFor(name)}
            </span>
          </span>
          <span className="max-w-[80%] text-[11px] font-medium uppercase tracking-[0.22em] text-foreground/80">
            {name}
          </span>
          <span
            aria-hidden
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] text-muted-foreground"
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--gold)]/60"
              aria-hidden
            />
            Portrait unavailable
          </span>
        </div>
      ) : (
        // "No photo yet" placeholder (member added, portrait not shot).
        // Same 4:5 slot so the grid never reflows.
        <div
          role="img"
          aria-label={alt}
          data-headshot-fallback="empty"
          className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted to-muted/60 p-4 text-center"
        >
          <span aria-hidden className="font-serif text-6xl tracking-[0.08em] text-[var(--gold)]/80">
            {initialsFor(name)}
          </span>
        </div>
      )}
      {overlayClassName ? (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 bg-gradient-to-t ${overlayClassName} mix-blend-overlay`}
        />
      ) : null}
      {tag ? (
        <span className="lg-pill absolute left-3 top-3 text-[10px] uppercase tracking-[0.24em]">
          {tag}
        </span>
      ) : null}
    </div>
  );
}
