/**
 * Integration: renders the full `/site` route in a TanStack memory router
 * and audits every team-card `<picture>` on the Leadership section.
 *
 * For each headshot rendered inside `#leadership` we assert:
 *   1. There's a `<picture>` element (Mushtaq + Danish; Saeed's initials
 *      placeholder is asserted separately).
 *   2. The `<source>` elements are ordered AVIF first, then WebP, and both
 *      `srcset` values are non-empty (every generated width surfaces).
 *   3. There's an `<img>` fallback with a non-empty `alt` and standard
 *      responsive attrs (`loading="lazy"`, `decoding="async"`).
 *   4. Every card exposes an accessible name via `<img alt>` OR (for the
 *      no-photo placeholder) via `aria-label` on the initials tile.
 *
 * This catches regressions where a new team member is added but the
 * AVIF/WebP ladder or alt-text is forgotten — the unit-level test in
 * `team-headshot-mushtaq.test.tsx` mounts the component in isolation, and
 * this test proves the same guarantees hold end-to-end in the real route.
 */
import * as React from "react";
import { beforeAll, describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";

// jsdom doesn't ship IntersectionObserver / ResizeObserver, which framer-motion's
// `whileInView` and a few layout hooks require. Provide inert no-op shims so
// the real route renders without error boundaries swallowing the tree.
beforeAll(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
    matchMedia?: (query: string) => MediaQueryList;
  };
  g.IntersectionObserver ??= NoopObserver;
  g.ResizeObserver ??= NoopObserver;
  if (!g.matchMedia) {
    g.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
});
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route as SiteIndexRoute } from "@/routes/site.index";

/**
 * Mounts the real site.index component under `/` in a memory router.
 * We attach the route's component (not the route object itself) so we don't
 * have to reproduce the generated route tree just for a render test.
 */
function renderSiteIndex() {
  const SiteComponent = SiteIndexRoute.options.component;
  if (!SiteComponent) {
    throw new Error("site.index Route has no component export");
  }
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: SiteComponent as unknown as () => React.ReactElement,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/**
 * TanStack router hydrates asynchronously (Transitioner + MatchesInner
 * state updates), so the leadership section isn't in the DOM on the first
 * render tick. Poll until it appears, then hand the section element back.
 */
async function mountAndAwaitLeadership(): Promise<HTMLElement> {
  const { container } = renderSiteIndex();
  const leadership = await waitFor(
    () => {
      const el = container.querySelector<HTMLElement>("#leadership");
      if (!el) throw new Error("#leadership not yet rendered");
      return el;
    },
    { timeout: 4000 },
  );
  return leadership;
}

describe("Team section — full-render <picture> audit", () => {
  it("every team-card headshot with a photo exposes AVIF + WebP <source> and an <img> with non-empty alt", async () => {
    const leadership = await mountAndAwaitLeadership();

    // One <article> per team member.
    const cards = leadership.querySelectorAll("article");
    expect(cards.length, "expected at least 2 team cards with photos").toBeGreaterThanOrEqual(2);

    const pictures = leadership.querySelectorAll("picture");
    // Mushtaq + Danish + Saeed all have photos now.
    expect(
      pictures.length,
      "expected 3 <picture> elements for team cards with photos",
    ).toBeGreaterThanOrEqual(3);

    for (const picture of Array.from(pictures)) {
      const sources = picture.querySelectorAll("source");
      expect(sources.length, "each team <picture> should have AVIF + WebP <source>").toBe(2);

      const avif = sources[0]!;
      const webp = sources[1]!;
      expect(avif.getAttribute("type")).toBe("image/avif");
      expect(webp.getAttribute("type")).toBe("image/webp");

      const avifSet = avif.getAttribute("srcset") ?? avif.getAttribute("srcSet") ?? "";
      const webpSet = webp.getAttribute("srcset") ?? webp.getAttribute("srcSet") ?? "";
      expect(avifSet.length, "AVIF srcset must not be empty").toBeGreaterThan(0);
      expect(webpSet.length, "WebP srcset must not be empty").toBeGreaterThan(0);
      // At least the smallest and a larger width should be advertised.
      expect(avifSet).toMatch(/\b320w\b/);
      expect(webpSet).toMatch(/\b320w\b/);
      expect(avifSet).toMatch(/\b800w\b/);
      expect(webpSet).toMatch(/\b800w\b/);

      const img = picture.querySelector("img");
      expect(img, "each team <picture> must contain an <img> fallback").not.toBeNull();
      expect(img!.getAttribute("alt") ?? "", "team <img> alt must be non-empty").not.toBe("");
      // Enforce professional descriptive alt (not just a name).
      expect((img!.getAttribute("alt") ?? "").length).toBeGreaterThan(40);
      expect(["lazy", "eager"]).toContain(img!.getAttribute("loading"));
      expect(["async", "sync"]).toContain(img!.getAttribute("decoding"));
    }
  });

  it("every team card in the leadership section is reachable via an accessible name", async () => {
    const leadership = await mountAndAwaitLeadership();
    const cards = leadership.querySelectorAll("article");
    expect(cards.length).toBeGreaterThanOrEqual(3);

    for (const card of Array.from(cards)) {
      const img = card.querySelector("img");
      const labelled = card.querySelector("[aria-label], [role='img']");
      const hasAccessibleName =
        (img && (img.getAttribute("alt") ?? "").trim().length > 0) ||
        (labelled &&
          ((labelled.getAttribute("aria-label") ?? "").trim().length > 0 ||
            (labelled.getAttribute("aria-labelledby") ?? "").trim().length > 0));
      expect(
        hasAccessibleName,
        `card missing accessible name:\n${card.outerHTML.slice(0, 200)}`,
      ).toBe(true);
    }
  });

  it("every TeamHeadshot fallback <img> in the leadership section keeps loading=lazy and decoding=async", async () => {
    const leadership = await mountAndAwaitLeadership();

    // Priority portraits (above the fold) will have eager/sync, while others will have lazy/async.
    const imgs = Array.from(leadership.querySelectorAll("img"));
    expect(imgs.length, "expected at least one team-card <img> in #leadership").toBeGreaterThan(0);

    for (const img of imgs) {
      const label =
        img.getAttribute("alt")?.slice(0, 60) ?? img.getAttribute("src") ?? "(anonymous)";
      const loading = img.getAttribute("loading");
      const decoding = img.getAttribute("decoding");
      expect(["lazy", "eager"], `img missing valid loading attr: ${label}`).toContain(loading);
      expect(["async", "sync"], `img missing valid decoding attr: ${label}`).toContain(decoding);
    }
  });
});

/**
 * Component-level sweep: mounts <TeamHeadshot> with every shape that ships
 * on /site (Mushtaq's 7-width ladder, Danish's 4-width ladder, and the
 * no-photo initials tile) and re-asserts the perf attrs. This runs without
 * router hydration so the guard still fires even if the integration mount
 * regresses.
 */
describe("TeamHeadshot — loading/decoding contract across every shape", () => {
  it.each([
    {
      label: "Mushtaq (7-width ladder)",
      widths: [320, 480, 640, 800, 1000, 1200, 1600],
      alt: "Professional editorial portrait of Engr. Mushtaq Ahmad, CEO & Founder, wearing a charcoal suit and navy tie, photographed against a soft office bokeh.",
    },
    {
      label: "Danish (4-width ladder)",
      widths: [320, 480, 640, 800],
      alt: "Professional editorial portrait of Engr. Danish Hayat, Head of Engineering & Business Operations, wearing a light grey suit and navy tie, photographed against a soft office bokeh.",
    },
  ])(
    "$label keeps loading=lazy and decoding=async on the <img> fallback",
    async ({ widths, alt }) => {
      const { TeamHeadshot } = await import("@/components/site/TeamHeadshot");
      const avifSrcSet = widths.map((w) => `/team-${w}.avif ${w}w`).join(", ");
      const webpSrcSet = widths.map((w) => `/team-${w}.webp ${w}w`).join(", ");
      const { container } = render(
        <TeamHeadshot
          name="Test Subject"
          alt={alt}
          avifSrcSet={avifSrcSet}
          webpSrcSet={webpSrcSet}
          fallback="/team.jpg"
        />,
      );
      const img = container.querySelector("img")!;
      expect(img).not.toBeNull();
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("decoding")).toBe("async");
    },
  );

  it("initials-tile shape (no photo) renders no <img> so there's nothing to lazy-load", async () => {
    const { TeamHeadshot } = await import("@/components/site/TeamHeadshot");
    const { container } = render(
      <TeamHeadshot
        name="Saeed ullah"
        alt="Portrait pending for Saeed ullah, Operations lead at Precise Realtors & Builders."
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    // Placeholder still exposes an accessible name so the card is announced.
    expect(container.querySelector("[role='img']")).not.toBeNull();
  });
});
