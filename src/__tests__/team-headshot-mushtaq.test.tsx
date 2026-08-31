/**
 * Regression: Mushtaq's team-card <picture> and alt-text contract.
 *
 * Two layers, one file:
 *
 *  1. **DOM render** — mount <TeamHeadshot> with Mushtaq-shaped inputs and
 *     verify the emitted markup: a <picture> wrapping an AVIF <source>, a
 *     WebP <source>, and a JPG <img> fallback with a non-empty `alt`. This
 *     locks the AVIF → WebP → JPG negotiation order and the img fallback
 *     that browsers without <picture> support fall back to.
 *
 *  2. **Source audit** — statically scan `src/routes/site.index.tsx` to
 *     confirm every `<TeamHeadshot ... />` on the marketing page carries an
 *     `alt=` prop, and that Mushtaq's data entry has all four responsive
 *     props wired (avifSrcSet, webpSrcSet, fallback, lqip). Catches
 *     regressions where a new team card is added or Mushtaq's props drift
 *     without opening a screenshot.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { TeamHeadshot } from "@/components/site/TeamHeadshot";

// Representative Mushtaq-shaped srcSets. Widths mirror the responsive ladder
// generated in `src/assets/site/` (320/480/640/800/1000/1200/1600).
const MUSHTAQ_WIDTHS = [320, 480, 640, 800, 1000, 1200, 1600];
const avifSrcSet = MUSHTAQ_WIDTHS.map((w) => `/team-mushtaq-${w}.avif ${w}w`).join(", ");
const webpSrcSet = MUSHTAQ_WIDTHS.map((w) => `/team-mushtaq-${w}.webp ${w}w`).join(", ");
const fallback = "/team-mushtaq.jpg";
const ALT =
  "Professional editorial portrait of Engr. Mushtaq Ahmad, CEO & Founder of Precise Realtors & Builders, wearing a charcoal suit, white shirt, and dark navy tie, photographed against a soft, blurred office background.";

describe("TeamHeadshot — Mushtaq <picture> regression", () => {
  it("renders AVIF + WebP <source> and JPG <img> fallback with alt", () => {
    const { container, getByAltText } = render(
      <TeamHeadshot
        name="Engr. Mushtaq Ahmad"
        alt={ALT}
        avifSrcSet={avifSrcSet}
        webpSrcSet={webpSrcSet}
        fallback={fallback}
        tag="Engineering leadership"
      />,
    );

    const picture = container.querySelector("picture");
    expect(picture, "expected a <picture> element for Mushtaq").not.toBeNull();

    const sources = picture!.querySelectorAll("source");
    expect(sources.length).toBe(2);

    // AVIF must come first — browsers pick the first supported <source>.
    const avif = sources[0]!;
    expect(avif.getAttribute("type")).toBe("image/avif");
    expect(avif.getAttribute("srcset") ?? avif.getAttribute("srcSet")).toBe(avifSrcSet);

    const webp = sources[1]!;
    expect(webp.getAttribute("type")).toBe("image/webp");
    expect(webp.getAttribute("srcset") ?? webp.getAttribute("srcSet")).toBe(webpSrcSet);

    // Every AVIF/WebP width has a matching entry.
    for (const w of MUSHTAQ_WIDTHS) {
      expect(avif.getAttribute("srcset")).toContain(`${w}w`);
      expect(webp.getAttribute("srcset")).toContain(`${w}w`);
    }

    const img = picture!.querySelector("img");
    expect(img, "expected a JPG <img> fallback inside <picture>").not.toBeNull();
    expect(img!.getAttribute("src")).toBe(fallback);
    expect(img!.getAttribute("alt")).toBe(ALT);
    expect(img!.getAttribute("width")).toBe("768");
    expect(img!.getAttribute("height")).toBe("960");
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("decoding")).toBe("async");

    // `sizes` must match the 3-col leadership grid contract on both the
    // <source> negotiation and the <img> so responsive behavior stays in
    // sync across every breakpoint (mobile full-width → tablet 50vw →
    // desktop 400px slot).
    const EXPECTED_SIZES = "(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw";
    expect(avif.getAttribute("sizes")).toBe(EXPECTED_SIZES);
    expect(webp.getAttribute("sizes")).toBe(EXPECTED_SIZES);
    expect(img!.getAttribute("sizes")).toBe(EXPECTED_SIZES);

    // Accessible-name lookup mirrors what screen readers announce.
    expect(getByAltText(ALT)).toBe(img);
  });

  it("throws in dev when alt is empty (accessibility guard-rail)", () => {
    // Suppress React's expected error log so the suite output stays clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <TeamHeadshot
          name="Engr. Mushtaq Ahmad"
          alt=""
          avifSrcSet={avifSrcSet}
          webpSrcSet={webpSrcSet}
          fallback={fallback}
        />,
      ),
    ).toThrow(/alt is required/i);
    spy.mockRestore();
  });
});

// Danish's responsive ladder is narrower than Mushtaq's (no retina 1000w+).
const DANISH_WIDTHS = [320, 480, 640, 800];
const danishAvifSrcSet = DANISH_WIDTHS.map((w) => `/team-danish-${w}.avif ${w}w`).join(", ");
const danishWebpSrcSet = DANISH_WIDTHS.map((w) => `/team-danish-${w}.webp ${w}w`).join(", ");
const DANISH_FALLBACK = "/team-danish.jpg";
const DANISH_ALT =
  "Professional editorial portrait of Engr. Danish Hayat, Head of Engineering & Business Operations at Precise Realtors & Builders, wearing a light grey suit, white shirt, and navy tie, photographed against a soft, blurred office background.";

describe("TeamHeadshot — Danish <picture> regression", () => {
  it("renders AVIF + WebP <source> and JPG <img> fallback with alt", () => {
    const { container, getByAltText } = render(
      <TeamHeadshot
        name="Engr. Danish Hayat"
        alt={DANISH_ALT}
        avifSrcSet={danishAvifSrcSet}
        webpSrcSet={danishWebpSrcSet}
        fallback={DANISH_FALLBACK}
        tag="Engineering leadership"
      />,
    );

    const picture = container.querySelector("picture");
    expect(picture, "expected a <picture> element for Danish").not.toBeNull();

    const sources = picture!.querySelectorAll("source");
    expect(sources.length).toBe(2);

    const avif = sources[0]!;
    expect(avif.getAttribute("type")).toBe("image/avif");
    expect(avif.getAttribute("srcset") ?? avif.getAttribute("srcSet")).toBe(danishAvifSrcSet);

    const webp = sources[1]!;
    expect(webp.getAttribute("type")).toBe("image/webp");
    expect(webp.getAttribute("srcset") ?? webp.getAttribute("srcSet")).toBe(danishWebpSrcSet);

    for (const w of DANISH_WIDTHS) {
      expect(avif.getAttribute("srcset")).toContain(`${w}w`);
      expect(webp.getAttribute("srcset")).toContain(`${w}w`);
    }

    const img = picture!.querySelector("img");
    expect(img, "expected a JPG <img> fallback inside <picture>").not.toBeNull();
    expect(img!.getAttribute("src")).toBe(DANISH_FALLBACK);
    expect(img!.getAttribute("alt")).toBe(DANISH_ALT);
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("decoding")).toBe("async");

    const EXPECTED_SIZES = "(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw";
    expect(avif.getAttribute("sizes")).toBe(EXPECTED_SIZES);
    expect(webp.getAttribute("sizes")).toBe(EXPECTED_SIZES);
    expect(img!.getAttribute("sizes")).toBe(EXPECTED_SIZES);

    expect(getByAltText(DANISH_ALT)).toBe(img);
  });
});

describe("Team cards — Danish source audit on /site", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "routes", "site.index.tsx"), "utf8");

  it("Danish's data entry wires avif, webp, jpg fallback, lqip, and non-empty alt", () => {
    const match = source.match(/name:\s*"Engr\.\s*Danish Hayat"[\s\S]*?alt:\s*"[^"]+"/);
    expect(match, "could not locate Danish entry in site.index.tsx").not.toBeNull();
    const entry = match![0];

    expect(entry).toMatch(/avifSrcSet:\s*teamDanishAvifSrcSet/);
    expect(entry).toMatch(/webpSrcSet:\s*teamDanishWebpSrcSet/);
    expect(entry).toMatch(/fallback:\s*teamDanish\b/);
    expect(entry).toMatch(/lqip:\s*teamLqip\.danish/);
    expect(entry).toMatch(/alt:\s*"[^"]{40,}"/);
  });
});

describe("Team cards — alt-text audit on /site", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "routes", "site.index.tsx"), "utf8");

  it("every <TeamHeadshot> usage in site.index.tsx carries an alt prop", () => {
    // Match every JSX opening tag through its close `/>` so we can inspect
    // the props on each individual usage. Non-greedy, dot-all.
    const usages = source.match(/<TeamHeadshot[\s\S]*?\/>/g) ?? [];
    expect(usages.length, "expected at least one <TeamHeadshot> usage").toBeGreaterThan(0);

    for (const usage of usages) {
      // alt may be `alt="..."` or `alt={m.alt}` — either is acceptable here;
      // the render-layer test above proves the value flows through to <img>.
      expect(usage, `missing alt prop:\n${usage}`).toMatch(/\balt\s*=\s*(?:"[^"]+"|\{[^}]+\})/);
    }
  });

  it("Mushtaq's data entry wires avif, webp, jpg fallback, and lqip", () => {
    // Grab Mushtaq's object literal from `name:` through the terminating
    // `accent: "..."` line — anchoring on both ends avoids the non-greedy
    // matcher stopping at an unrelated `},` that appears earlier in JSX.
    const match = source.match(/name:\s*"Engr\.\s*Mushtaq Ahmad"[\s\S]*?accent:\s*"[^"]*"/);

    expect(match, "could not locate Mushtaq entry in site.index.tsx").not.toBeNull();
    const entry = match![0];

    expect(entry).toMatch(/avifSrcSet:\s*teamMushtaqAvifSrcSet/);
    expect(entry).toMatch(/webpSrcSet:\s*teamMushtaqWebpSrcSet/);
    expect(entry).toMatch(/fallback:\s*teamMushtaq\b/);
    expect(entry).toMatch(/lqip:\s*teamLqip\.mushtaq/);
    // Alt must be a non-empty string literal on this entry (not a variable).
    expect(entry).toMatch(/alt:\s*"[^"]{40,}"/);
  });
});
