import { ChevronRight, Home, MoreHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useLocation } from "@/lib/router-compat";
import { Link as TanstackLink } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Global keyboard shortcut that focuses the Home crumb. Documented in the UI
 * via `aria-keyshortcuts` + a visible `<kbd>` chip and a `title` tooltip so
 * every input mode (screen reader, mouse hover, sighted keyboard user) can
 * discover it.
 *
 * Chosen combo: Alt+Shift+H.
 *   • Alt+H alone types `˙` on macOS and clashes with menu mnemonics on Win.
 *   • Alt+Home is the browser "go to homepage" shortcut — off-limits.
 *   • Alt+Shift+H is unassigned in every major browser and OS default.
 *
 * We render the label as `⌥⇧H` on macOS and `Alt+Shift+H` elsewhere so the
 * kbd chip matches the actual key legend on the user's keyboard.
 */
const HOME_SHORTCUT_ARIA = "Alt+Shift+H";
function homeShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Alt+Shift+H";
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  return isMac ? "⌥⇧H" : "Alt+Shift+H";
}

/**
 * Top-bar breadcrumb trail derived from the current pathname.
 * Segment labels come from LABELS; unknown/dynamic segments (ids, slugs)
 * are humanized. The last crumb renders as the current page (non-link).
 */
const LABELS: Record<string, string> = {
  "": "Dashboard",
  bookings: "Bookings",
  payments: "Payments",
  ledger: "Installment Ledger",
  adjustments: "Adjustments",
  documents: "Documents",
  reports: "Reports",
  health: "Data Health",
  "reconciliation-diff": "Reconciliation Diff",
  debugger: "Code Debugger",
  settings: "Settings",
  clients: "Clients",
  projects: "Projects",
  units: "Units",
  users: "Users",
  audit: "Audit Log",
  "audit-log": "Audit Log",
  "my-requests": "My Requests",
  "admin-hub": "Admin Hub",
  "import-center": "Import Center",
  "logic-notes": "Logic Notes",
  "data-health": "Data Health",
  "payment-edit-history": "Payment Edit History",
  "plan-restructure-history": "Plan Restructure History",
  new: "New",
  edit: "Edit",
};

/**
 * Safely decode a URI-encoded path segment.
 *
 * `decodeURIComponent` throws `URIError` on malformed escapes like `%E0%A4`,
 * a lone `%`, or `%ZZ`. Any such throw inside a top-bar breadcrumb would
 * crash the entire chrome, so we defend in layers:
 *   1. Guard non-string input (defensive — pathname split should never
 *      hand us anything else, but router shims can).
 *   2. Try a full `decodeURIComponent`.
 *   3. On failure, decode escape-by-escape and drop bad ones, so a segment
 *      like `caf%E9%ZZ` still yields `café` instead of the raw string.
 *   4. Strip control chars / stray `%` that would look ugly in a crumb.
 */
export function safeDecodeSegment(segment: unknown): string {
  if (typeof segment !== "string" || segment.length === 0) return "";
  let out: string;
  try {
    out = decodeURIComponent(segment);
  } catch {
    // Piecewise decode: split on valid-looking `%xx` groups and try each.
    out = segment.replace(/(%[0-9A-Fa-f]{2})+|%|[^%]+/g, (chunk) => {
      if (chunk === "%") return "";
      if (chunk.startsWith("%")) {
        try {
          return decodeURIComponent(chunk);
        } catch {
          return "";
        }
      }
      return chunk;
    });
  }
  // Strip control chars and any residual stray `%` from failed groups.
  return out.replace(/[\u0000-\u001F\u007F]+/g, "").replace(/%(?![0-9A-Fa-f]{2})/g, "");
}

export function resolveSegmentLabel(segment: string): string {
  try {
    const decoded = safeDecodeSegment(segment);

    // 1. Curated label map (also try the raw segment as a fallback key).
    if (decoded && LABELS[decoded]) return LABELS[decoded];
    if (LABELS[segment]) return LABELS[segment];

    if (!decoded) return "Page";

    // 2. ID-shape heuristics
    if (/^[0-9a-f]{8}-[0-9a-f-]{8,}$/i.test(decoded) || /^[0-9a-f]{16,}$/i.test(decoded)) {
      return `#${decoded.replace(/-/g, "").slice(0, 6)}`;
    }
    if (/^\d+$/.test(decoded)) return `#${decoded}`;

    // 3. Humanize: split on separators, title-case words
    const humanized = decoded
      .replace(/[-_+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // 4. Never render a blank crumb
    return humanized || "Page";
  } catch {
    // Absolute last-resort safety net — resolveSegmentLabel must never throw.
    return "Page";
  }
}

/**
 * Pure builder for the BreadcrumbList JSON-LD payload. Extracted so the
 * position/order contract can be unit-tested without mounting the component.
 *
 * Contract:
 *   • Position 1 is always "Dashboard" at `/`.
 *   • Positions 2..N mirror URL segments in visible order, one per segment
 *     — even ones hidden behind the overflow ellipsis. Per Google's
 *     BreadcrumbList guidance, the JSON-LD reflects the FULL logical trail;
 *     UI truncation is a rendering concern, not a SEO one.
 *   • Names come from `resolveSegmentLabel`, so fallback-labeled segments
 *     (`#abc123`, humanized slugs) appear in JSON-LD exactly as they render.
 *   • `item` URLs are absolute when `origin` is provided, relative otherwise
 *     (SSR-safe: window is undefined during prerender).
 */
export function buildBreadcrumbJsonLd(pathname: string, origin = "") {
  const safePath =
    typeof pathname === "string" ? pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") : "";
  const parts = safePath.split("/").filter(Boolean);
  const crumbs = parts.map((seg, i) => ({
    name: resolveSegmentLabel(seg),
    href: "/" + parts.slice(0, i + 1).join("/"),
  }));
  const items = [
    { name: "Dashboard", item: `${origin}/` },
    ...crumbs.map((c) => ({ name: c.name, item: `${origin}${c.href}` })),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: entry.name,
      item: entry.item,
    })),
  };
}

/**
 * Normalize a pathname for equality comparison.
 *
 * Screens readers announce `aria-current` on the crumb that matches the
 * current URL, so the check has to survive the ways a router (or a user's
 * URL bar, or a shared link) can decorate the same page:
 *
 *   • `/bookings`, `/bookings/`, `/bookings//` — trailing slashes
 *   • `/bookings?filter=open`                  — query string
 *   • `/bookings#section`                      — fragment
 *   • `` / `null` / `undefined` / non-string   — defensive shims
 *
 * All of those refer to the same crumb; a naïve `===` would announce the
 * wrong current item to assistive tech. We also drop leading whitespace
 * and collapse repeated internal slashes so `/a//b/` matches `/a/b`.
 */
export function normalizePath(input: unknown): string {
  if (typeof input !== "string") return "/";
  const trimmed = input.trim();
  if (trimmed === "") return "/";
  // Drop query + hash before touching slashes so `?a=/`/`#/` don't confuse us.
  const withoutQueryHash = trimmed.split("?")[0].split("#")[0];
  // Collapse repeated slashes and strip trailing slashes, but keep the root "/".
  const collapsed = withoutQueryHash.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return collapsed === "" ? "/" : collapsed;
}

/**
 * Are two pathnames the same crumb? Normalizes both sides so trailing
 * slashes, query strings, and hash fragments cannot make `aria-current`
 * drift out of sync with the URL the user is actually on.
 */
export function isCurrentPath(candidate: unknown, current: unknown): boolean {
  return normalizePath(candidate) === normalizePath(current);
}

export function Breadcrumbs({ className }: { className?: string }) {
  const { pathname } = useLocation();
  // Shared normalized form — powers segment derivation AND every
  // aria-current comparison below. Because a single helper owns both
  // sides of the comparison, `/bookings/`, `/bookings?x=1`, and
  // `/bookings` all announce the exact same current crumb.
  const normalizedCurrent = normalizePath(pathname);
  // `safePath` retains the historical shape (root → "") that the segment
  // split expects; helper compares still route through normalizePath.
  const safePath = normalizedCurrent === "/" ? "" : normalizedCurrent;
  const parts = safePath.split("/").filter(Boolean);

  // `/` is the true current page → root crumb owns aria-current.
  // Deeper routes → the crumb whose href matches the current URL owns
  // aria-current="page"; every ancestor link (including the Home root)
  // gets aria-current="location" per WAI-ARIA breadcrumb guidance.
  const isHome = isCurrentPath("/", normalizedCurrent);

  const crumbs = parts.map((seg, i) => {
    const href = "/" + parts.slice(0, i + 1).join("/");
    // Compare against the normalized current URL, not the array index —
    // otherwise a route that ends in a redundant `/` or carries a query
    // string could announce a stale current crumb.
    const isCurrent = isCurrentPath(href, normalizedCurrent);
    return {
      label: resolveSegmentLabel(seg),
      href,
      isLast: i === parts.length - 1,
      isCurrent,
      ariaCurrent: isCurrent ? ("page" as const) : ("location" as const),
    };
  });

  // Shared focus-visible ring — uses theme `--ring` so it stays legible in
  // both light and dark. `outline-none` only fires on focus-visible (keyboard),
  // so mouse clicks stay clean while Tab focus is always visible.
  const focusRing =
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:relative focus-visible:z-10";

  // Collapse very long trails: keep first + last two, hide the middle
  // behind an ellipsis dropdown. Threshold picked so a 4-crumb trail
  // still renders in full.
  const MAX_VISIBLE = 4;
  let visible = crumbs;
  let collapsed: typeof crumbs = [];
  if (crumbs.length > MAX_VISIBLE) {
    visible = [crumbs[0], ...crumbs.slice(-2)];
    collapsed = crumbs.slice(1, -2);
  }

  // BreadcrumbList JSON-LD — helps search engines represent the crumb trail
  // in SERPs. Delegates to the exported pure builder so the SEO output is
  // provably identical to what our unit tests lock down.
  // Absolute URLs are recommended; we prefix with the current origin at
  // render time (SSR-safe fallback to relative paths when window is absent).
  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(pathname ?? "", origin);

  // ── Home shortcut (Alt+Shift+H) ──────────────────────────────────────
  // Global listener that moves keyboard focus to the Home crumb. Deliberately
  // additive: it never intercepts Tab, arrow keys, or plain letter presses,
  // so standard breadcrumb navigation is unchanged. Suppressed inside text
  // inputs / contenteditable so the shortcut never hijacks typing.
  const homeRef = useRef<HTMLAnchorElement | HTMLSpanElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      // `e.key` for Alt+Shift+H can be "H", "h", or an OS-composed dead key
      // ("Ó" on macOS). `e.code` is layout-stable → prefer it.
      if (e.code !== "KeyH") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.matches("input, textarea, select, [role='textbox'], [role='combobox']") ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      // The Home crumb is a `<span>` on `/` (non-focusable by default) and a
      // link elsewhere; `tabIndex={-1}` on the span makes programmatic focus
      // work WITHOUT adding a redundant Tab stop.
      homeRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const shortcutLabel = homeShortcutLabel();
  const shortcutTitle = `Go to Dashboard (${shortcutLabel})`;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        // Design-system tokens only:
        // - text-xs   → fluid 12→13px (`--text-xs`)
        // - text-muted-foreground → theme token, adapts light/dark
        // - leading-none → sits cleanly in the 64px top bar
        // - tracking-normal → enterprise-neutral letter-spacing
        "min-w-0 text-xs leading-none tracking-normal text-muted-foreground",
        className,
      )}
    >
      <script
        type="application/ld+json"
        // Safe: values are internal labels/paths, JSON.stringify escapes them.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {/*
        Horizontal scroll on narrow viewports; scrollbar hidden for a clean
        top bar. Focus-ring clipping notes:

        • `overflow-x: auto` on a flex row makes the browser coerce
          `overflow-y` from `visible` to `auto` too (CSS overflow spec).
          A focus ring with `ring-2 ring-offset-2` extends ~4px beyond the
          child's border-box on all sides, so the top and bottom of the
          ring would be clipped without vertical breathing room. `py-1`
          reserves that space so the ring paints fully inside the
          scroll container.
        • When arrow-key focus (or a shortcut like Alt+Shift+H) lands on
          an item that's currently scrolled off-screen, the browser calls
          `scrollIntoView` and aligns the item flush with the scroll
          edge — which clips the ring on the leading/trailing edge.
          `scroll-px-2` on the container + `scroll-mx-1` on each `<li>`
          (below) reserve inline space so the ring stays visible after
          scroll snapping, matching the ring-offset width.
      */}
      <ol className="flex min-w-0 items-center gap-2 overflow-x-auto px-1 py-1 scroll-px-2 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <li className="flex shrink-0 items-center scroll-mx-1">
          {isHome ? (
            <span
              ref={homeRef as React.RefObject<HTMLSpanElement>}
              aria-current="page"
              // `aria-keyshortcuts` documents the shortcut to screen readers
              // per WAI-ARIA. `tabIndex={-1}` lets the shortcut focus this
              // span WITHOUT adding a redundant Tab stop for keyboard users.
              aria-keyshortcuts={HOME_SHORTCUT_ARIA}
              tabIndex={-1}
              title={shortcutTitle}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-2 py-1 font-semibold text-foreground",
                focusRing,
              )}
            >
              <Home className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Dashboard</span>
              <kbd
                aria-hidden="true"
                className="hidden lg:inline-flex ml-1 items-center rounded-lg border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
              >
                {shortcutLabel}
              </kbd>
            </span>
          ) : (
            // TanstackLink hard-wires aria-current="page" onto ANY active
            // link (prefix match) and that internal spread wins over
            // `activeProps`. We only render this Home link when we're
            // deeper than `/`, so `activeOptions={{ exact: true }}` keeps
            // it forever inactive — that lets us own the aria-current
            // attribute and correctly label the ancestor as "location".
            <TanstackLink
              ref={homeRef as React.RefObject<HTMLAnchorElement>}
              to="/dashboard"
              activeOptions={{ exact: true }}
              aria-label={shortcutTitle}
              aria-current="location"
              aria-keyshortcuts={HOME_SHORTCUT_ARIA}
              title={shortcutTitle}
              className={cn(
                // Accent hover pair: `bg-accent` must pair with
                // `text-accent-foreground` (shadcn semantic convention) so the
                // hovered label stays legible against `--accent` in BOTH themes.
                "inline-flex items-center gap-1.5 rounded-xl px-2 py-1 min-h-[44px] min-w-[44px] justify-center lg:min-h-0 lg:min-w-0 hover:bg-accent hover:text-accent-foreground transition-all duration-200",
                focusRing,
              )}
            >
              <Home className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Dashboard</span>
              <kbd
                aria-hidden="true"
                className="hidden lg:inline-flex ml-1 items-center rounded-lg border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
              >
                {shortcutLabel}
              </kbd>
            </TanstackLink>
          )}
        </li>
        {visible.map((c, idx) => {
          const showEllipsisAfter = collapsed.length > 0 && idx === 0;
          return (
            <li key={c.href} className="flex min-w-0 shrink-0 items-center gap-2 scroll-mx-1">
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                aria-hidden="true"
                role="presentation"
              />
              {c.isCurrent ? (
                <span
                  aria-current="page"
                  className="max-w-[40vw] truncate font-semibold tracking-tight text-foreground sm:max-w-[24rem]"
                  title={c.label}
                >
                  {c.label}
                </span>
              ) : (
                // See note above the Home link: `exact` keeps ancestor
                // crumbs inactive so we can own aria-current="location".
                <TanstackLink
                  to={c.href}
                  activeOptions={{ exact: true }}
                  aria-label={`Go to ${c.label}`}
                  aria-current="location"
                  className={cn(
                    // Same accent-hover pairing as the Home link — see comment there.
                    "max-w-[32vw] truncate rounded-xl px-2 py-1 hover:bg-accent hover:text-accent-foreground transition-all duration-200 sm:max-w-[18rem]",
                    focusRing,
                  )}
                  title={c.label}
                >
                  {c.label}
                </TanstackLink>
              )}
              {showEllipsisAfter && (
                <>
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                    role="presentation"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      // Radix already applies `aria-haspopup="menu"` and toggles
                      // `aria-expanded` on open/close — the label just needs to
                      // convey PURPOSE + COUNT so screen readers announce
                      // "Show 3 hidden breadcrumbs, menu pop-up, collapsed".
                      aria-label={`Show ${collapsed.length} hidden breadcrumb${collapsed.length === 1 ? "" : "s"}`}
                      className={cn(
                        // Same accent-hover pairing as the crumb links so the
                        // ellipsis icon stays legible against `--accent`.
                        "inline-flex items-center rounded-md px-1.5 py-1 hover:bg-accent hover:text-accent-foreground transition-colors",
                        focusRing,
                      )}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="min-w-[12rem] text-sm"
                      // Named menu → SRs announce "Hidden breadcrumb ancestors,
                      // menu" instead of an unnamed group.
                      aria-label="Hidden breadcrumb ancestors"
                    >
                      {collapsed.map((h, i) => {
                        // Match against the normalized current URL so a
                        // trailing slash or `?query` cannot desynchronize
                        // the announcement. Ancestor items are otherwise
                        // "location" per WAI-ARIA breadcrumb guidance.
                        const isCurrentUrl = isCurrentPath(h.href, normalizedCurrent);
                        return (
                          <DropdownMenuItem
                            key={h.href}
                            asChild
                            // Radix moves highlight with ↑/↓ and sets
                            // data-[highlighted] on the active item; we also
                            // draw the theme ring so keyboard focus stays
                            // visible in both light and dark.
                            className={cn(
                              "cursor-pointer data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                              "aria-[current=page]:font-semibold aria-[current=location]:text-foreground",
                              focusRing,
                            )}
                          >
                            <TanstackLink
                              to={h.href}
                              activeOptions={{ exact: true }}
                              aria-current={isCurrentUrl ? "page" : "location"}
                              // Position metadata so SRs announce "2 of 3"
                              // as the user arrows through the collapsed list.
                              aria-posinset={i + 1}
                              aria-setsize={collapsed.length}
                              className="truncate w-full"
                              title={h.label}
                            >
                              {h.label}
                            </TanstackLink>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
