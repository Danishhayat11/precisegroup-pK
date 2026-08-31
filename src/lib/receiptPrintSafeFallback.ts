/**
 * Print-safe fallback for the dual-copy PaymentReceipt.
 *
 * Some devices (long client names + long amount-in-words + large project
 * titles, or aggressive user margins) push the receipt off the A4 safe
 * area horizontally, or the two copies together spill onto a second
 * page. When that happens the raster ends up either clipped on the right
 * or split into an ugly "half receipt on page 2".
 *
 * This module runs a geometry check on the *cloned* print root immediately
 * before `window.print()` and, if needed, swaps in a simplified
 * single-copy layout by adding the `pp-receipt--simplified` class and
 * injecting a scoped stylesheet that:
 *
 *   • hides one of the two copies + the tear line (single copy only)
 *   • drops the tagline, disclaimer, extra address line, secondary NTN
 *     line, and italic amount-in-words
 *   • compacts padding / font-sizes
 *
 * Purely presentational — no data change, no receipt reflow of the
 * on-screen preview. Only the print clone is affected.
 *
 * `evaluateReceiptFit()` is a pure function extracted for unit tests so
 * the threshold logic can be locked without a real DOM.
 */

export type ReceiptFitMetrics = {
  /** Widest child scrollWidth inside the receipt clone (px). */
  contentWidthPx: number;
  /** Available width the receipt is allowed to occupy (px). */
  availableWidthPx: number;
  /** Total receipt scroll height (px). */
  contentHeightPx: number;
  /** Available printable/content height in px. */
  pageHeightPx: number;
  /** Number of `.pp-copy` blocks in the clone. */
  copyCount: number;
};

export type ReceiptFitDecision = {
  needsFallback: boolean;
  overflowX: boolean;
  overflowY: boolean;
  estimatedPageCount: number;
  reasons: string[];
};

/** Tolerate one CSS pixel of sub-pixel rounding. */
const HORIZONTAL_TOLERANCE_PX = 1.5;
/**
 * Two full copies + tear line normally sit inside one page. Anything
 * meaningfully taller than the page — plus a small fudge for
 * anti-aliasing between the two copy blocks — needs the simplified
 * layout to stay on a single sheet.
 */
const VERTICAL_TOLERANCE_PX = 4;
/** Cap: refuse to spill to a third physical page under any conditions. */
const MAX_ALLOWED_PAGES = 1;

export function evaluateReceiptFit(m: ReceiptFitMetrics): ReceiptFitDecision {
  const reasons: string[] = [];
  const overflowX =
    m.contentWidthPx - m.availableWidthPx > HORIZONTAL_TOLERANCE_PX && m.availableWidthPx > 0;
  if (overflowX) {
    reasons.push(
      `horizontal overflow: content ${Math.round(m.contentWidthPx)}px > ` +
        `${Math.round(m.availableWidthPx)}px available`,
    );
  }

  const estimatedPageCount =
    m.pageHeightPx > 0
      ? Math.max(1, Math.ceil((m.contentHeightPx - VERTICAL_TOLERANCE_PX) / m.pageHeightPx))
      : 1;
  const overflowY = estimatedPageCount > MAX_ALLOWED_PAGES;
  if (overflowY) {
    reasons.push(
      `vertical overflow: ~${estimatedPageCount} pages ` +
        `(${Math.round(m.contentHeightPx)}px content / ${Math.round(m.pageHeightPx)}px page)`,
    );
  }

  return {
    needsFallback: overflowX || overflowY,
    overflowX,
    overflowY,
    estimatedPageCount,
    reasons,
  };
}

/** CSS injected once per print flow. Scoped to `.pp-receipt--simplified`. */
export const SIMPLIFIED_RECEIPT_CSS = `
  .pp-receipt.pp-receipt--simplified {
    font-size: 8.5pt !important;
    line-height: 1.35 !important;
  }
  .pp-receipt.pp-receipt--simplified .pp-tear-line,
  .pp-receipt.pp-receipt--simplified .pp-copy + .pp-tear-line + .pp-copy,
  .pp-receipt.pp-receipt--simplified .pp-simplified-hide {
    display: none !important;
  }
  .pp-receipt.pp-receipt--simplified .pp-copy {
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  .pp-receipt.pp-receipt--simplified .pp-copy > * {
    margin-top: 1.25mm !important;
  }
`;

/* ------------------------------------------------------------------------
 * Automatic A4 scale adjustment
 * ------------------------------------------------------------------------
 * Before we resort to the destructive simplified fallback (dropping a copy,
 * hiding disclaimers, shrinking type), we try a purely visual fit: measure
 * the cloned receipt and, when it overflows the printable width, apply a
 * uniform CSS `transform: scale()` sized to bring it exactly inside the
 * page. Because `scale` is applied around `top left` and the receipt
 * width is compensated via `width: calc(100% / scale)`, layout is
 * preserved and the browser rasteriser still ends up with a receipt that
 * fits on one page.
 *
 * We only scale DOWN, never up (scale is clamped to [MIN_AUTO_SCALE, 1]).
 * If content is so wide it would require a scale below `MIN_AUTO_SCALE`
 * (~15% reduction) we abandon auto-scale and let the simplified fallback
 * take over — at that point the layout is genuinely broken, not just
 * marginally over.
 * ------------------------------------------------------------------------ */

/** Never shrink below this — beyond it the receipt becomes unreadable. */
export const MIN_AUTO_SCALE = 0.85;
/** Tiny cushion so sub-pixel rounding never re-introduces overflow. */
const AUTO_SCALE_SAFETY = 0.995;

export type AutoScaleDecision = {
  /** Multiplicative scale to apply (1 means no scaling needed). */
  scale: number;
  /** True when scaling was applied. */
  applied: boolean;
  /** True when overflow was detected but the required scale was below MIN. */
  belowMin: boolean;
  reason: string;
};

export function computeAutoScale(input: {
  contentWidthPx: number;
  availableWidthPx: number;
}): AutoScaleDecision {
  const { contentWidthPx, availableWidthPx } = input;
  if (availableWidthPx <= 0 || contentWidthPx <= 0) {
    return { scale: 1, applied: false, belowMin: false, reason: "invalid-metrics" };
  }
  if (contentWidthPx - availableWidthPx <= HORIZONTAL_TOLERANCE_PX) {
    return { scale: 1, applied: false, belowMin: false, reason: "fits" };
  }
  const raw = (availableWidthPx / contentWidthPx) * AUTO_SCALE_SAFETY;
  const clamped = Math.max(MIN_AUTO_SCALE, Math.min(1, raw));
  if (raw < MIN_AUTO_SCALE) {
    return {
      scale: clamped,
      applied: false,
      belowMin: true,
      reason: `required scale ${raw.toFixed(3)} < MIN_AUTO_SCALE ${MIN_AUTO_SCALE}`,
    };
  }
  return {
    scale: clamped,
    applied: true,
    belowMin: false,
    reason: `scaled to ${clamped.toFixed(3)}`,
  };
}

const AUTO_SCALE_STYLE_ID = "pp-receipt-autoscale-style";

function applyAutoScale(receipt: HTMLElement, scale: number, d: Document): void {
  // Prefer a CSS custom property so print CSS can override if needed,
  // and use `transform-origin: top left` so the shrunk receipt hugs the
  // page's top-left corner (no drift toward the center).
  const compensatedWidth = `${(100 / scale).toFixed(4)}%`;
  receipt.style.setProperty("--pp-auto-scale", scale.toFixed(4));
  receipt.style.transformOrigin = "top left";
  receipt.style.transform = `scale(${scale.toFixed(4)})`;
  receipt.style.width = compensatedWidth;
  receipt.style.maxWidth = compensatedWidth;

  if (!d.getElementById(AUTO_SCALE_STYLE_ID)) {
    const style = d.createElement("style");
    style.id = AUTO_SCALE_STYLE_ID;
    style.textContent = `
      /* Auto-scaled receipt: the transform shrinks the paint box; we also
         relax any hard \`overflow: hidden\` on ancestors so the scaled
         layout is not clipped mid-shrink. */
      .pp-receipt[style*="--pp-auto-scale"] { overflow: visible !important; }
    `;
    d.head.appendChild(style);
  }
}

/**
 * Measure the cloned receipt against the A4 safe area and, if needed,
 * (1) apply automatic scale adjustment, and only if that would drop
 * below the readable-minimum threshold, (2) apply the simplified
 * fallback class + stylesheet. Returns the fit decision so callers can
 * log it.
 *
 * Called from `preparePrintSinglePage` after the clone is mounted and
 * assets are ready, but before `window.print()` fires.
 */
export function ensureReceiptFitsOrFallback(opts: {
  clone: HTMLElement;
  /** Physical page width in mm (post-margins is fine here — we compare against
   *  the clone's own layout width, so caller passes the final printable box). */
  pageW: number;
  /** Physical page height in mm. */
  pageH: number;
  /** Style tag id used to inject the fallback CSS. Defaults to a stable id. */
  styleId?: string;
  /** Document to attach the fallback style tag into (defaults to global). */
  doc?: Document;
}): (ReceiptFitDecision & { autoScale?: AutoScaleDecision }) | null {
  const { clone, pageW, pageH, styleId = "pp-receipt-fallback-style", doc } = opts;
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d || !clone) return null;

  const receipt = clone.querySelector<HTMLElement>(".pp-receipt");
  if (!receipt) return null;

  const pxPerMm = 96 / 25.4;
  const pageHeightPx = pageH * pxPerMm;
  const pageWidthPx = pageW * pxPerMm;
  const docBody = receipt.closest<HTMLElement>(".doc-body");
  const docSheet = receipt.closest<HTMLElement>(".doc-sheet");

  const minPositive = (...values: Array<number | undefined | null>) => {
    const positives = values.filter((v): v is number => typeof v === "number" && v > 0);
    return positives.length ? Math.min(...positives) : 0;
  };

  const availableWidthPx =
    minPositive(docBody?.clientWidth, receipt.clientWidth, docSheet?.clientWidth, pageWidthPx) ||
    pageWidthPx;
  const availableHeightPx =
    minPositive(docBody?.clientHeight, docSheet?.clientHeight, pageHeightPx) || pageHeightPx;
  const contentWidthPx = receipt.scrollWidth;
  const contentHeightPx = receipt.scrollHeight;
  const copyCount = receipt.querySelectorAll<HTMLElement>(".pp-copy").length;

  // Step 1: try auto-scale first — cheap, non-destructive, preserves layout.
  const autoScale = computeAutoScale({ contentWidthPx, availableWidthPx });
  if (autoScale.applied) {
    applyAutoScale(receipt, autoScale.scale, d);
  }

  // Re-measure horizontal fit after auto-scale (height is unaffected by
  // scale for the estimatedPageCount math because the browser paginates
  // the transformed box; we still want a truthy overflowY signal when the
  // *unscaled* content would need >1 page).
  const decision = evaluateReceiptFit({
    contentWidthPx: autoScale.applied
      ? Math.min(contentWidthPx * autoScale.scale, availableWidthPx)
      : contentWidthPx,
    availableWidthPx,
    contentHeightPx: autoScale.applied ? contentHeightPx * autoScale.scale : contentHeightPx,
    pageHeightPx: availableHeightPx,
    copyCount,
  });

  if (!decision.needsFallback) return { ...decision, autoScale };

  // Step 2: simplified fallback — used when auto-scale couldn't recover
  // the layout on its own (either below MIN_AUTO_SCALE or vertical spill).
  receipt.classList.add("pp-receipt--simplified");
  if (!d.getElementById(styleId)) {
    const style = d.createElement("style");
    style.id = styleId;
    style.textContent = SIMPLIFIED_RECEIPT_CSS;
    d.head.appendChild(style);
  }

  return { ...decision, autoScale };
}
