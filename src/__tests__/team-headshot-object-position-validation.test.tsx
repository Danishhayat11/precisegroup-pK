/**
 * Unit tests — <TeamHeadshot> objectPosition runtime validator.
 *
 * Guards the behavior in `src/components/site/TeamHeadshot.tsx`:
 *   • Missing prop → warns "missing objectPosition" and falls back to
 *     "center 30%".
 *   • Malformed prop (bad keyword, unsupported unit, >2 tokens, empty,
 *     whitespace-only) → warns "invalid objectPosition=..." and falls
 *     back to "center 30%".
 *   • Valid prop → no warn, value applied verbatim to `<img style>`.
 *
 * Keeps the warning surface honest so a future refactor can't silently
 * regress the validator (e.g. widen the regex or drop the fallback).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHeadshot, type ObjectPosition } from "@/components/site/TeamHeadshot";

const DEFAULT = "center 30%";

function pictureProps() {
  return {
    name: "Test Subject",
    alt: "Test subject portrait",
    avifSrcSet: "/a-320.avif 320w, /a-640.avif 640w",
    webpSrcSet: "/w-320.webp 320w, /w-640.webp 640w",
    fallback: "/f-640.jpg",
  };
}

function renderedImg(): HTMLImageElement {
  return screen.getByAltText("Test subject portrait") as HTMLImageElement;
}

describe("TeamHeadshot — objectPosition validation", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("warns and falls back when objectPosition is undefined", () => {
    render(<TeamHeadshot {...pictureProps()} />);

    expect(renderedImg().style.objectPosition).toBe(DEFAULT);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("[TeamHeadshot]");
    expect(msg).toContain("missing objectPosition");
    expect(msg).toContain(`"Test Subject"`);
    expect(msg).toContain(DEFAULT);
  });

  const invalidValues: Array<[string, string]> = [
    ["typo keyword", "centre 30%"],
    ["unsupported unit vh", "center 30vh"],
    ["unsupported unit vw", "50vw 20%"],
    ["calc() expression", "calc(50% + 10px) 30%"],
    ["three tokens", "center 30% 40%"],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["bogus keyword", "middle 30%"],
    ["trailing junk", "center 30%!"],
  ];

  it.each(invalidValues)("warns and falls back for invalid value (%s: %s)", (_label, value) => {
    render(
      // These strings are intentionally invalid and would fail the
      // strict `ObjectPosition` compile-time guard — cast so we can
      // exercise the runtime validator that catches values slipping in
      // via `any` / user input at the seam.
      <TeamHeadshot {...pictureProps()} objectPosition={value as unknown as ObjectPosition} />,
    );

    expect(renderedImg().style.objectPosition).toBe(DEFAULT);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("[TeamHeadshot]");
    expect(msg).toContain(`invalid objectPosition="${value}"`);
    expect(msg).toContain(`"Test Subject"`);
    expect(msg).toContain(DEFAULT);
  });

  // Typed as the strict compile-time union — this doubles as a static
  // assertion that every literal in the list is accepted by TS. If a
  // future edit introduces an invalid grammar (e.g. adds `"30vh"`) the
  // typecheck fails here before the test even runs.
  const validValues: readonly ObjectPosition[] = [
    "center 30%",
    "center 22%",
    "center",
    "top",
    "left center",
    "50% 25%",
    "10px 20px",
    "1.5rem 2em",
    "-10% 40%",
  ];

  it.each(validValues)("accepts valid value verbatim without warning (%s)", (value) => {
    render(<TeamHeadshot {...pictureProps()} objectPosition={value} />);

    expect(renderedImg().style.objectPosition).toBe(value);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
