import { describe, it, expect } from "vitest";
import { resolveSegmentLabel, safeDecodeSegment } from "@/components/Breadcrumbs";

describe("safeDecodeSegment", () => {
  it("decodes valid percent-encoding", () => {
    expect(safeDecodeSegment("caf%C3%A9")).toBe("café");
    expect(safeDecodeSegment("hello%20world")).toBe("hello world");
  });

  it("returns empty string for non-string / empty input", () => {
    expect(safeDecodeSegment(undefined)).toBe("");
    expect(safeDecodeSegment(null)).toBe("");
    expect(safeDecodeSegment(42)).toBe("");
    expect(safeDecodeSegment("")).toBe("");
  });

  it("never throws on malformed escapes", () => {
    expect(() => safeDecodeSegment("%E0%A4")).not.toThrow();
    expect(() => safeDecodeSegment("%")).not.toThrow();
    expect(() => safeDecodeSegment("%ZZ")).not.toThrow();
    expect(() => safeDecodeSegment("100%")).not.toThrow();
  });

  it("piecewise-decodes partially-valid strings", () => {
    // Valid %C3%A9 → é; trailing lone % should be stripped.
    expect(safeDecodeSegment("caf%C3%A9%")).toBe("café");
    // Bad %ZZ chunk keeps its literal characters; valid piece decodes.
    expect(safeDecodeSegment("caf%C3%A9%ZZ")).toBe("caféZZ");
  });

  it("strips control chars and stray % artifacts", () => {
    expect(safeDecodeSegment("hi%00there")).toBe("hithere");
    expect(safeDecodeSegment("50%off")).toBe("50off");
  });
});

describe("resolveSegmentLabel — fallback chain", () => {
  it("1) uses curated LABELS map for known routes", () => {
    expect(resolveSegmentLabel("bookings")).toBe("Bookings");
    expect(resolveSegmentLabel("reconciliation-diff")).toBe("Reconciliation Diff");
    expect(resolveSegmentLabel("my-requests")).toBe("My Requests");
  });

  it("1) matches curated label after successful URL decoding", () => {
    // "my%2Drequests" decodes to "my-requests"
    expect(resolveSegmentLabel("my%2Drequests")).toBe("My Requests");
  });

  it("2) collapses UUID-shaped ids to a short #hash", () => {
    const label = resolveSegmentLabel("550e8400-e29b-41d4-a716-446655440000");
    expect(label).toMatch(/^#[0-9a-f]{6}$/i);
    expect(label).toBe("#550e84");
  });

  it("2) collapses long hex ids to a short #hash", () => {
    expect(resolveSegmentLabel("abcdef0123456789")).toBe("#abcdef");
  });

  it("2) prefixes numeric ids with #", () => {
    expect(resolveSegmentLabel("42")).toBe("#42");
    expect(resolveSegmentLabel("1")).toBe("#1");
  });

  it("3) humanizes unknown slugs (title-case, separators → spaces)", () => {
    expect(resolveSegmentLabel("quarterly-summary")).toBe("Quarterly Summary");
    expect(resolveSegmentLabel("some_other_page")).toBe("Some Other Page");
    expect(resolveSegmentLabel("mixed-a_b+c")).toBe("Mixed A B C");
  });

  it("3) humanizes URL-encoded unknown slugs", () => {
    // "annual%20report" → "annual report" → "Annual Report"
    expect(resolveSegmentLabel("annual%20report")).toBe("Annual Report");
    // Accented text survives round-trip
    expect(resolveSegmentLabel("caf%C3%A9-menu")).toBe("Café Menu");
  });

  it("1) treats empty segment as Dashboard (root LABELS entry)", () => {
    expect(resolveSegmentLabel("")).toBe("Dashboard");
  });

  it("4) returns 'Page' for separator-only / whitespace-only segments", () => {
    expect(resolveSegmentLabel("   ")).toBe("Page");
    expect(resolveSegmentLabel("---")).toBe("Page");
    expect(resolveSegmentLabel("___")).toBe("Page");
  });

  it("4) returns 'Page' when malformed input decodes to empty", () => {
    expect(resolveSegmentLabel("%")).toBe("Page");
    expect(resolveSegmentLabel("%%%")).toBe("Page");
  });

  it("never throws on malformed percent-encoding", () => {
    expect(() => resolveSegmentLabel("%E0%A4")).not.toThrow();
    expect(() => resolveSegmentLabel("bad%")).not.toThrow();
    expect(() => resolveSegmentLabel("%C0%C0")).not.toThrow();
    // Every call must return a non-empty string
    for (const seg of ["%E0%A4", "bad%", "%C0%C0", "%%%"]) {
      expect(resolveSegmentLabel(seg).length).toBeGreaterThan(0);
    }
  });
});
