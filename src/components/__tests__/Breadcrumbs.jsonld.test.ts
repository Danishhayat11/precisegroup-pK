import { describe, it, expect } from "vitest";
import { buildBreadcrumbJsonLd } from "@/components/Breadcrumbs";

/**
 * Locks the BreadcrumbList JSON-LD contract:
 *   1. Order matches the visible crumb order (Dashboard → ...ancestors → current).
 *   2. `position` is a 1-based, gapless sequence over the FULL trail — the
 *      overflow ellipsis is a UI concern; SEO must see every segment.
 *   3. Names match `resolveSegmentLabel` for both curated and fallback cases,
 *      so what Google indexes == what users see (modulo truncation).
 *   4. `item` URLs are absolute when `origin` is provided, relative otherwise
 *      (SSR-safe: window is undefined during prerender).
 */

const ORIGIN = "https://example.com";

describe("buildBreadcrumbJsonLd — root", () => {
  it("emits only Dashboard for '/'", () => {
    const ld = buildBreadcrumbJsonLd("/", ORIGIN);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Dashboard",
        item: `${ORIGIN}/`,
      },
    ]);
  });

  it("treats empty pathname and '/' identically", () => {
    expect(buildBreadcrumbJsonLd("", ORIGIN)).toEqual(buildBreadcrumbJsonLd("/", ORIGIN));
  });
});

describe("buildBreadcrumbJsonLd — nested paths, order + positions", () => {
  it("emits one ListItem per segment in visible order (curated labels)", () => {
    const ld = buildBreadcrumbJsonLd("/bookings/payments", ORIGIN);
    expect(ld.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Dashboard", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Bookings", item: `${ORIGIN}/bookings` },
      { "@type": "ListItem", position: 3, name: "Payments", item: `${ORIGIN}/bookings/payments` },
    ]);
  });

  it("position indices are 1-based and gapless for deep paths", () => {
    const ld = buildBreadcrumbJsonLd("/a/b/c/d/e/f/g", ORIGIN);
    const positions = ld.itemListElement.map((e) => e.position);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // Dashboard + 7 segs
  });

  it("includes ALL segments even when the UI would collapse into an overflow menu (>4 crumbs)", () => {
    // Threshold in the component is MAX_VISIBLE = 4; UI shows Home + first +
    // last two + ellipsis. JSON-LD must still enumerate every ancestor so
    // search engines see the complete hierarchy.
    const ld = buildBreadcrumbJsonLd("/admin/reports/audit/edit", ORIGIN);
    const names = ld.itemListElement.map((e) => e.name);
    expect(names).toEqual(["Dashboard", "Admin", "Reports", "Audit Log", "Edit"]);
    expect(ld.itemListElement).toHaveLength(5);
    // Sanity: hrefs are cumulative, one segment per position.
    expect(ld.itemListElement.map((e) => e.item)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/admin`,
      `${ORIGIN}/admin/reports`,
      `${ORIGIN}/admin/reports/audit`,
      `${ORIGIN}/admin/reports/audit/edit`,
    ]);
  });
});

describe("buildBreadcrumbJsonLd — fallback-labeled segments", () => {
  it("hex ids collapse to `#xxxxxx` in the ListItem name", () => {
    const ld = buildBreadcrumbJsonLd("/bookings/abcdef0123456789", ORIGIN);
    expect(ld.itemListElement).toHaveLength(3);
    expect(ld.itemListElement[2]).toEqual({
      "@type": "ListItem",
      position: 3,
      name: "#abcdef",
      item: `${ORIGIN}/bookings/abcdef0123456789`,
    });
  });

  it("numeric ids become `#<n>`", () => {
    const ld = buildBreadcrumbJsonLd("/bookings/42", ORIGIN);
    expect(ld.itemListElement[2].name).toBe("#42");
  });

  it("humanizes unknown slugs (hyphen → space, title-case)", () => {
    const ld = buildBreadcrumbJsonLd("/bookings/quarterly-review", ORIGIN);
    expect(ld.itemListElement[2].name).toBe("Quarterly Review");
  });

  it("uses safeDecode for percent-encoded segments", () => {
    const ld = buildBreadcrumbJsonLd("/projects/caf%C3%A9-remodel", ORIGIN);
    expect(ld.itemListElement[2].name).toBe("Café Remodel");
  });

  it("never emits a blank name (falls back to 'Page')", () => {
    // A segment that decodes to only control chars → resolveSegmentLabel → "Page"
    const ld = buildBreadcrumbJsonLd("/bookings/%00%01", ORIGIN);
    expect(ld.itemListElement[2].name).toBe("Page");
  });
});

describe("buildBreadcrumbJsonLd — URL normalization", () => {
  it("strips query + hash before segmenting", () => {
    const ld = buildBreadcrumbJsonLd("/bookings/42?tab=x#section", ORIGIN);
    const names = ld.itemListElement.map((e) => e.name);
    expect(names).toEqual(["Dashboard", "Bookings", "#42"]);
  });

  it("collapses trailing slashes so /bookings/ == /bookings", () => {
    expect(buildBreadcrumbJsonLd("/bookings/", ORIGIN)).toEqual(
      buildBreadcrumbJsonLd("/bookings", ORIGIN),
    );
  });

  it("uses relative URLs when origin is omitted (SSR-safe)", () => {
    const ld = buildBreadcrumbJsonLd("/bookings/42");
    expect(ld.itemListElement.map((e) => e.item)).toEqual(["/", "/bookings", "/bookings/42"]);
  });
});
