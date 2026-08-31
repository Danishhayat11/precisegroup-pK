/**
 * Regression tests for the aria-current URL matcher.
 *
 * Screen readers rely on a single crumb carrying `aria-current="page"` and
 * every ancestor carrying `aria-current="location"`. Both attributes are
 * derived from `isCurrentPath`, so any drift in the normalizer immediately
 * corrupts what SRs announce. These tests lock the normalization contract
 * against the exact edge cases users hit in real URLs:
 *
 *   • trailing slashes (link with `/bookings/`, bookmark with `/bookings`)
 *   • query strings from filters/pagination (`/bookings?filter=open`)
 *   • hash fragments (`/bookings#row-42`)
 *   • repeated internal slashes (proxy or bad concat: `/a//b`)
 *   • non-string input (defensive against router shims)
 */
import { describe, it, expect } from "vitest";
import { normalizePath, isCurrentPath } from "@/components/Breadcrumbs";

describe("normalizePath", () => {
  it("returns '/' for empty/whitespace/non-string input", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("   ")).toBe("/");
    expect(normalizePath(undefined)).toBe("/");
    expect(normalizePath(null)).toBe("/");
    expect(normalizePath(42)).toBe("/");
  });

  it("strips trailing slashes but preserves root", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/bookings")).toBe("/bookings");
    expect(normalizePath("/bookings/")).toBe("/bookings");
    expect(normalizePath("/bookings//")).toBe("/bookings");
  });

  it("drops query strings and fragments", () => {
    expect(normalizePath("/bookings?filter=open")).toBe("/bookings");
    expect(normalizePath("/bookings#row-42")).toBe("/bookings");
    expect(normalizePath("/bookings/?a=1#b")).toBe("/bookings");
  });

  it("collapses repeated internal slashes", () => {
    expect(normalizePath("/a//b/")).toBe("/a/b");
    expect(normalizePath("//a///b//c")).toBe("/a/b/c");
  });

  it("does NOT decode encoded slashes inside a segment", () => {
    // %2F is an encoded slash — routers treat it as opaque data, so
    // /files/a%2Fb is ONE segment "a/b", not two. Normalization must
    // leave that alone; touching it would let /files/a%2Fb match
    // /files/a/b for aria-current, which is wrong.
    expect(normalizePath("/files/a%2Fb")).toBe("/files/a%2Fb");
  });
});

describe("isCurrentPath", () => {
  it("treats trailing-slash variants as the same crumb", () => {
    expect(isCurrentPath("/bookings", "/bookings/")).toBe(true);
    expect(isCurrentPath("/bookings/", "/bookings")).toBe(true);
    expect(isCurrentPath("/", "")).toBe(true);
  });

  it("ignores query strings and hash fragments", () => {
    expect(isCurrentPath("/bookings", "/bookings?filter=open")).toBe(true);
    expect(isCurrentPath("/bookings", "/bookings#row-42")).toBe(true);
    expect(isCurrentPath("/bookings", "/bookings/?a=1#b")).toBe(true);
  });

  it("does NOT treat an ancestor as the current page", () => {
    // The whole point of aria-current="page" vs "location" — an ancestor
    // crumb must never be flagged current, or SRs announce two "current
    // page" landmarks and users lose their place in the trail.
    expect(isCurrentPath("/bookings", "/bookings/42")).toBe(false);
    expect(isCurrentPath("/", "/bookings")).toBe(false);
  });

  it("does NOT match a sibling that shares a prefix", () => {
    expect(isCurrentPath("/book", "/bookings")).toBe(false);
    expect(isCurrentPath("/bookings", "/bookings-archive")).toBe(false);
  });

  it("is symmetric and handles non-string input on either side", () => {
    expect(isCurrentPath(undefined, "/")).toBe(true);
    expect(isCurrentPath("/", undefined)).toBe(true);
    expect(isCurrentPath(null, "")).toBe(true);
  });
});
