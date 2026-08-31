/**
 * Reusable page-level SEO metadata for marketing routes.
 *
 * Every marketing route repeats the same boilerplate: title, description,
 * self-referencing canonical, matching og:* + twitter:* pairs, and a
 * summary_large_image card. This helper centralises that so a route only
 * declares what's unique to it (path, title, description, optional image)
 * and receives a `{ meta, links }` pair to spread into `head()`.
 *
 * What it deliberately does NOT own:
 *   - JSON-LD `scripts` — the schema type varies per page (RealEstateAgent,
 *     Article, ItemList, BreadcrumbList), so those stay inline in the route.
 *   - `<link rel="preload">` for LCP assets — asset paths are route-local.
 *   - `robots` — set explicitly on the few routes that need noindex.
 *
 * Canonical + og:url ALWAYS self-reference the route. Passing the wrong
 * path here silently redirects social-share attribution to another URL,
 * which is why we take a `path` (not a full URL) and build the absolute
 * form here against a single BASE constant.
 */

export const SITE_BASE_URL = "https://precisegroup-pk.lovable.app";
export const DEFAULT_OG_IMAGE = `${SITE_BASE_URL}/og-cover.jpg`;
const SITE_NAME = "Precise Realtors & Builders";
const SITE_TWITTER_HANDLE = "@PreciseGroupPK";
const SITE_TWITTER_CREATOR = "@PreciseGroupPK";
const SITE_TWITTER_SITE = "@PreciseGroupPK";

export type PageSeoInput = {
  /** Route path with leading slash, e.g. "/site/services". */
  path: string;
  /** <60 chars for full SERP display. */
  title: string;
  /** 50–160 chars — under 50 looks thin, over 160 truncates. */
  description: string;
  /** Schema-consistent og:type. Defaults to "website"; use "article" for editorial pages. */
  ogType?: "website" | "article";
  /**
   * Absolute URL to a 1200×630 preview image. Defaults to the site cover.
   * Pass a route-specific hero when the page has one (product/portfolio pages).
   */
  image?: string;
  /** Alt text describing the image for crawlers and share previews. */
  imageAlt?: string;
  /** Override og:locale when a route targets a different market. */
  locale?: string;
};

type MetaEntry =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

type LinkEntry = { rel: string; href: string };

/**
 * Returns `{ meta, links }` chunks for the shared page-level metadata.
 * Spread into `head()` and append route-specific extras (schema scripts,
 * preloads, noindex) alongside.
 */
export function pageSeo(input: PageSeoInput): { meta: MetaEntry[]; links: LinkEntry[] } {
  const {
    path,
    title,
    description,
    ogType = "website",
    image = DEFAULT_OG_IMAGE,
    imageAlt = `${SITE_NAME} — luxury real estate in Islamabad`,
    locale = "en_PK",
  } = input;

  // Canonical & og:url must self-reference. Building here (not at call sites)
  // eliminates a class of bug where a route hard-codes a peer's URL by mistake.
  const absoluteUrl = `${SITE_BASE_URL}${path}`;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      // Open Graph — Facebook, LinkedIn, WhatsApp, Slack all read these.
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: ogType },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:locale", content: locale },
      { property: "og:url", content: absoluteUrl },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: imageAlt },
      // Twitter card — separate namespace, must be duplicated.
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: SITE_TWITTER_SITE },
      { name: "twitter:creator", content: SITE_TWITTER_CREATOR },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: imageAlt },
    ],
    // Canonical belongs on the LEAF route only. TanStack Router concatenates
    // `links` (unlike `meta`, which dedupes by name/property), so putting a
    // canonical in __root.tsx would emit two — invalid. Keep it here.
    links: [{ rel: "canonical", href: absoluteUrl }],
  };
}

/**
 * Convenience for BreadcrumbList JSON-LD. Every marketing leaf builds the
 * same shape — position/name/item — so centralise it. Pass ordered crumbs
 * starting from Home; the helper stamps position and prefixes the base URL.
 */
export function breadcrumbList(
  crumbs: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE_BASE_URL}${c.path}`,
    })),
  };
}
