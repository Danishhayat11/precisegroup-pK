/**
 * Lightweight token-class regression for <Breadcrumbs />.
 *
 * The chevron separators and the overflow dropdown rows must stay on the
 * design-system theme tokens so light/dark parity holds. A previous refactor
 * silently swapped `text-muted-foreground/60` for a hex value and broke the
 * dark theme; this test locks the class names in the source so any future
 * drift fails CI without needing to mount the router.
 *
 * Static source-scan on purpose — mounting <Breadcrumbs /> requires a full
 * TanStack Router context, which is overkill for a class-name contract.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../Breadcrumbs.tsx"), "utf8");

/** Count non-overlapping occurrences of a substring in the source. */
function count(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

describe("Breadcrumbs — theme token class names", () => {
  it("nav uses muted-foreground token for the trail baseline", () => {
    expect(source).toMatch(/text-muted-foreground(?![-/\w])/);
  });

  it("every ChevronRight separator uses the muted-foreground/60 token", () => {
    // Two chevrons exist in source: the between-crumbs separator (expanded
    // state) AND the separator that precedes the overflow trigger
    // (collapsed state). Both must share the exact token class so the
    // divider color stays identical in light and dark themes.
    const chevronMatches = source.match(/<ChevronRight\b[\s\S]*?\/>/g) ?? [];
    expect(chevronMatches.length).toBe(2);
    for (const chevron of chevronMatches) {
      expect(chevron).toContain("text-muted-foreground/60");
      expect(chevron).toContain("h-3.5 w-3.5");
      expect(chevron).toContain('aria-hidden="true"');
    }
  });

  it("crumb + overflow-trigger hover uses the accent token pair", () => {
    // shadcn semantic pairing: `bg-accent` must always ship with
    // `text-accent-foreground` so the hovered label stays legible against
    // --accent in BOTH themes. Applies to: Home link, ancestor crumb link,
    // AND the overflow `<MoreHorizontal>` trigger.
    const hoverPair = "hover:bg-accent hover:text-accent-foreground";
    expect(count(source, hoverPair)).toBeGreaterThanOrEqual(3);
  });

  it("collapsed dropdown rows use the accent highlight token pair", () => {
    // Radix sets data-[highlighted] on the keyboard-focused menu item; the
    // row must use the same accent token pair as the hover surface so the
    // ↑/↓ highlight color matches the pointer-hover color in both themes.
    expect(source).toContain("data-[highlighted]:bg-accent");
    expect(source).toContain("data-[highlighted]:text-accent-foreground");
  });

  it("focus ring uses the theme --ring token, not a hard-coded color", () => {
    // Locks in the shared focusRing string. `ring-ring` + `ring-offset-background`
    // are what keep the keyboard focus indicator legible in dark mode.
    expect(source).toContain("focus-visible:ring-ring");
    expect(source).toContain("focus-visible:ring-offset-background");
  });

  it("current-page crumb uses the foreground token (not raw white/black)", () => {
    expect(source).toMatch(/text-foreground(?![-/\w])/);
    // Guard against accidental raw color utilities in JSX className strings.
    // Comments/docstrings are stripped first so illustrative examples like
    // `#abc123` in a docblock don't trip the check.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(codeOnly).not.toMatch(/className=[^>]*#[0-9a-fA-F]{3,8}\b/);
    expect(codeOnly).not.toMatch(/\btext-(white|black)\b/);
  });
});
