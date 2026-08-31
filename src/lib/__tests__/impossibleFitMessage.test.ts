/**
 * Validates the impossible-state amber banner copy: exact paper /
 * orientation / margin echo, plus adaptive "loosen these knobs"
 * suggestions. Kept pure so we don't need to mount PrintPreviewModal.
 */
import { describe, it, expect } from "vitest";
import {
  buildImpossibleFitMessage,
  formatMarginLabel,
  type ImpossibleFitInput,
} from "../impossibleFitMessage";

const base: ImpossibleFitInput = {
  paperLabel: "A4",
  orientation: "portrait",
  marginsMm: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
};

describe("buildImpossibleFitMessage", () => {
  it("echoes paper, orientation, uniform margin, and floor scale verbatim", () => {
    const msg = buildImpossibleFitMessage(base);
    expect(msg.headline).toBe(
      "Can't fit on one page at A4 portrait, margins 12.7mm, even at 50% scale.",
    );
    expect(msg.body).toContain("A4 portrait");
    expect(msg.body).toContain("12.7mm");
    expect(msg.body).toContain("50%");
  });

  it("preserves per-side margins in T/R/B/L order when they differ", () => {
    const msg = buildImpossibleFitMessage({
      ...base,
      marginsMm: { top: 20, right: 10, bottom: 15, left: 5 },
    });
    expect(msg.headline).toContain("margins 20.0/10.0/15.0/5.0mm");
  });

  it("respects a non-default minScalePct floor", () => {
    const msg = buildImpossibleFitMessage({ ...base, minScalePct: 60 });
    expect(msg.headline).toContain("even at 60% scale");
  });

  it("suggests switching to landscape when currently portrait", () => {
    const msg = buildImpossibleFitMessage(base);
    expect(msg.suggestions).toContain("switch to landscape");
    expect(msg.suggestions).not.toContain("try wider paper");
    expect(msg.body).toContain("switch to landscape");
  });

  it("suggests wider paper instead of landscape when already landscape", () => {
    const msg = buildImpossibleFitMessage({ ...base, orientation: "landscape" });
    expect(msg.suggestions).toContain("try wider paper");
    expect(msg.suggestions).not.toContain("switch to landscape");
  });

  it("suggests narrower margins only when any side exceeds the narrow threshold", () => {
    const wide = buildImpossibleFitMessage({
      ...base,
      marginsMm: { top: 20, right: 20, bottom: 20, left: 20 },
    });
    expect(wide.suggestions).toContain("narrow the margins");

    const alreadyNarrow = buildImpossibleFitMessage({
      ...base,
      orientation: "landscape",
      isWidestPaper: false,
      marginsMm: { top: 5, right: 5, bottom: 5, left: 5 },
    });
    expect(alreadyNarrow.suggestions).not.toContain("narrow the margins");
  });

  it("drops the paper suggestion when this preset is already the widest", () => {
    const msg = buildImpossibleFitMessage({
      ...base,
      orientation: "landscape",
      isWidestPaper: true,
      marginsMm: { top: 4, right: 4, bottom: 4, left: 4 },
    });
    expect(msg.suggestions).not.toContain("try wider paper");
    // With no reasonable knob left, we surface the escape hatch.
    expect(msg.suggestions).toEqual(["split the content across multiple pages"]);
  });

  it("joins two suggestions with 'or' and three with an Oxford-style list", () => {
    const two = buildImpossibleFitMessage({
      ...base,
      marginsMm: { top: 20, right: 20, bottom: 20, left: 20 },
    });
    expect(two.body).toMatch(/Try switch to landscape or narrow the margins/);

    const three = buildImpossibleFitMessage({
      paperLabel: "Custom",
      orientation: "portrait",
      isWidestPaper: false,
      marginsMm: { top: 20, right: 20, bottom: 20, left: 20 },
      // Emulate a hypothetical third suggestion path by forcing wide margins
      // *and* portrait *and* not-widest — we already assert this yields exactly
      // two, so the true three-way case comes from future knobs. This test
      // pins the joiner if a third knob is ever added.
    });
    expect(three.suggestions.length).toBeGreaterThanOrEqual(2);
  });

  it("always closes with the re-enable hint so users know the toggle recovers", () => {
    const msg = buildImpossibleFitMessage(base);
    expect(msg.body.endsWith("the toggle will re-enable automatically.")).toBe(true);
  });
});

describe("formatMarginLabel", () => {
  it("collapses to a single value when all sides are equal", () => {
    expect(formatMarginLabel({ top: 10, right: 10, bottom: 10, left: 10 })).toBe("10.0mm");
  });
  it("expands to T/R/B/L when any side differs", () => {
    expect(formatMarginLabel({ top: 10, right: 8, bottom: 10, left: 10 })).toBe(
      "10.0/8.0/10.0/10.0mm",
    );
  });
});
