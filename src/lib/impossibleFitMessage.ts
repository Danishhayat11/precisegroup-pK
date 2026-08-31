/**
 * Copy + suggestion builder for the fit-to-one-page "impossible" amber banner.
 *
 * The message shown when the search terminates without ever observing a
 * single-page render. Kept as a pure helper so we can unit-test the exact
 * wording (paper, orientation, margin values) and the adaptive suggestions
 * without mounting the full PrintPreviewModal.
 *
 * Suggestion rules — only recommend knobs that would actually loosen the
 * layout for the current inputs:
 *   • orientation === "portrait"   → suggest "switch to landscape"
 *   • orientation === "landscape"  → suggest "wider paper" (landscape already spent)
 *   • max margin > NARROW_MARGIN_MM → suggest "narrower margins"
 *   • paper is already the widest preset → drop the paper suggestion
 */

export type ImpossibleMarginsMm = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ImpossibleFitInput = {
  paperLabel: string;
  /** True when this paper is already the widest preset (no wider option). */
  isWidestPaper?: boolean;
  orientation: "portrait" | "landscape";
  marginsMm: ImpossibleMarginsMm;
  /** Reported floor of the search (defaults to 50%). */
  minScalePct?: number;
};

export type ImpossibleFitMessage = {
  headline: string;
  suggestions: string[];
  /** Full sentence used as the banner body. */
  body: string;
};

const NARROW_MARGIN_MM = 8;

export function formatMarginLabel(m: ImpossibleMarginsMm): string {
  const { top, right, bottom, left } = m;
  const uniform = top === right && right === bottom && bottom === left;
  if (uniform) return `${top.toFixed(1)}mm`;
  return `${top.toFixed(1)}/${right.toFixed(1)}/${bottom.toFixed(1)}/${left.toFixed(1)}mm`;
}

export function buildImpossibleFitMessage(input: ImpossibleFitInput): ImpossibleFitMessage {
  const { paperLabel, isWidestPaper = false, orientation, marginsMm, minScalePct = 50 } = input;

  const marginLabel = formatMarginLabel(marginsMm);
  const headline =
    `Can't fit on one page at ${paperLabel} ${orientation}, ` +
    `margins ${marginLabel}, even at ${minScalePct}% scale.`;

  const suggestions: string[] = [];
  if (orientation === "portrait") {
    suggestions.push("switch to landscape");
  } else if (!isWidestPaper) {
    suggestions.push("try wider paper");
  }
  const maxMargin = Math.max(marginsMm.top, marginsMm.right, marginsMm.bottom, marginsMm.left);
  if (maxMargin > NARROW_MARGIN_MM) {
    suggestions.push("narrow the margins");
  }
  // Safety net — if every knob is already at its loosest, surface the escape
  // hatch so the user isn't stuck reading a dead-end warning.
  if (suggestions.length === 0) {
    suggestions.push("split the content across multiple pages");
  }

  const suggestionSentence =
    suggestions.length === 1
      ? `Try ${suggestions[0]}`
      : suggestions.length === 2
        ? `Try ${suggestions[0]} or ${suggestions[1]}`
        : `Try ${suggestions.slice(0, -1).join(", ")}, or ${suggestions[suggestions.length - 1]}`;

  const body = `${headline} ${suggestionSentence} — the toggle will re-enable automatically.`;
  return { headline, suggestions, body };
}
