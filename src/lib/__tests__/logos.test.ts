/**
 * Verifies (a) the Logo dropdown source data is brand-grouped and (b) the
 * Auto-mode resolver returns the expected default for each document type.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  LOGO_OPTIONS,
  LOGO_PICKER_ITEMS,
  AUTO_LOGO_ID,
  AUTO_DOC_CATALOG,
  AUTO_STYLE_DEFAULTS,
  resolveLogoOption,
  resolveAutoLogoId,
} from "@/lib/logos";
import { getDocStyle } from "@/lib/letterhead";

beforeEach(() => {
  // Ensure user-set overrides don't bleed across tests; we test pure defaults.
  localStorage.clear();
});

describe("LOGO_OPTIONS — brand grouping", () => {
  it("tags every concrete option with a brand group", () => {
    for (const o of LOGO_OPTIONS) {
      expect(o.group, `missing group on ${o.id}`).toBeTruthy();
      expect(typeof o.group).toBe("string");
    }
  });

  it("exposes the expected brand groups", () => {
    const groups = new Set(LOGO_OPTIONS.map((o) => o.group));
    expect(groups).toEqual(
      new Set(["Manal Heights", "Manal Arcade", "Manal Associate", "Precise Realtors & Builders"]),
    );
  });

  it("keeps each group's options contiguous so <optgroup>s render cleanly", () => {
    // First and last index per group must form a contiguous range.
    const seen = new Map<string, { first: number; last: number }>();
    LOGO_OPTIONS.forEach((o, i) => {
      const g = o.group!;
      const entry = seen.get(g);
      if (!entry) seen.set(g, { first: i, last: i });
      else entry.last = i;
    });
    const ranges = Array.from(seen.values()).sort((a, b) => a.first - b.first);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].first).toBe(ranges[i - 1].last + 1);
    }
  });
});

describe("LOGO_PICKER_ITEMS — dropdown source", () => {
  it("places Auto first, followed by every concrete option", () => {
    expect(LOGO_PICKER_ITEMS[0].id).toBe(AUTO_LOGO_ID);
    expect(LOGO_PICKER_ITEMS.length).toBe(LOGO_OPTIONS.length + 1);
    // Order of concrete items matches LOGO_OPTIONS so grouping by `.group`
    // produces contiguous <optgroup> sections in DocumentView.
    const concrete = LOGO_PICKER_ITEMS.slice(1).map((o) => o.id);
    expect(concrete).toEqual(LOGO_OPTIONS.map((o) => o.id));
  });
});

describe("Auto defaults per document type", () => {
  it("Style A notice types resolve to the Style-A default", () => {
    const styleADefault = AUTO_STYLE_DEFAULTS.A;
    const styleA = AUTO_DOC_CATALOG.filter((d) => d.style === "A");
    expect(styleA.length).toBeGreaterThan(0);
    for (const spec of styleA) {
      expect(getDocStyle(spec.id)).toBe("A");
      const resolved = resolveAutoLogoId({ docType: spec.id, style: "A" });
      expect(resolved, `wrong auto for ${spec.id}`).toBe(styleADefault);
      expect(resolveLogoOption(AUTO_LOGO_ID, { docType: spec.id, style: "A" }).id).toBe(
        styleADefault,
      );
    }
  });

  it("Style B transactional types resolve to the Style-B default", () => {
    const styleBDefault = AUTO_STYLE_DEFAULTS.B;
    const styleB = AUTO_DOC_CATALOG.filter((d) => d.style === "B");
    expect(styleB.length).toBeGreaterThan(0);
    for (const spec of styleB) {
      expect(getDocStyle(spec.id)).toBe("B");
      const resolved = resolveAutoLogoId({ docType: spec.id, style: "B" });
      expect(resolved, `wrong auto for ${spec.id}`).toBe(styleBDefault);
      expect(resolveLogoOption(AUTO_LOGO_ID, { docType: spec.id, style: "B" }).id).toBe(
        styleBDefault,
      );
    }
  });

  it("default ids point at real logo options", () => {
    expect(LOGO_OPTIONS.some((o) => o.id === AUTO_STYLE_DEFAULTS.A)).toBe(true);
    expect(LOGO_OPTIONS.some((o) => o.id === AUTO_STYLE_DEFAULTS.B)).toBe(true);
  });

  it("per-document override beats the style default", () => {
    // Pick any concrete option that isn't already the Style-B default.
    const override = LOGO_OPTIONS.find((o) => o.id !== AUTO_STYLE_DEFAULTS.B)!.id;
    localStorage.setItem("doc-auto-logo-map-v1", JSON.stringify({ receipt: override }));
    expect(resolveAutoLogoId({ docType: "receipt", style: "B" })).toBe(override);
    // Other doc types are untouched.
    expect(resolveAutoLogoId({ docType: "allotment", style: "B" })).toBe(AUTO_STYLE_DEFAULTS.B);
  });

  it("per-style override beats the hard-coded default but loses to per-doc", () => {
    const styleOverride = LOGO_OPTIONS.find((o) => o.id !== AUTO_STYLE_DEFAULTS.A)!.id;
    const docOverride = LOGO_OPTIONS.find(
      (o) => o.id !== AUTO_STYLE_DEFAULTS.A && o.id !== styleOverride,
    )!.id;
    localStorage.setItem("doc-auto-logo-style-v1", JSON.stringify({ A: styleOverride }));
    expect(resolveAutoLogoId({ docType: "legal-notice", style: "A" })).toBe(styleOverride);

    localStorage.setItem("doc-auto-logo-map-v1", JSON.stringify({ "legal-notice": docOverride }));
    expect(resolveAutoLogoId({ docType: "legal-notice", style: "A" })).toBe(docOverride);
    // A different Style-A doc still uses the style-level override.
    expect(resolveAutoLogoId({ docType: "demand-notice", style: "A" })).toBe(styleOverride);
  });
});
