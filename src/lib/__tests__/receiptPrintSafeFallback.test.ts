import { describe, it, expect } from "vitest";
import {
  evaluateReceiptFit,
  ensureReceiptFitsOrFallback,
  SIMPLIFIED_RECEIPT_CSS,
  computeAutoScale,
  MIN_AUTO_SCALE,
} from "@/lib/receiptPrintSafeFallback";

const PAGE_H_PX = (297 * 96) / 25.4; // A4 portrait, ~1122.5px
const PAGE_W_PX = (210 * 96) / 25.4; // ~793.7px

describe("evaluateReceiptFit", () => {
  it("passes when content fits on one page", () => {
    const d = evaluateReceiptFit({
      contentWidthPx: 780,
      availableWidthPx: 794,
      contentHeightPx: 1000,
      pageHeightPx: PAGE_H_PX,
      copyCount: 2,
    });
    expect(d.needsFallback).toBe(false);
    expect(d.overflowX).toBe(false);
    expect(d.overflowY).toBe(false);
    expect(d.estimatedPageCount).toBe(1);
  });

  it("flags horizontal overflow past the tolerance", () => {
    const d = evaluateReceiptFit({
      contentWidthPx: 810,
      availableWidthPx: 794,
      contentHeightPx: 1000,
      pageHeightPx: PAGE_H_PX,
      copyCount: 2,
    });
    expect(d.needsFallback).toBe(true);
    expect(d.overflowX).toBe(true);
    expect(d.reasons.some((r) => r.startsWith("horizontal overflow"))).toBe(true);
  });

  it("ignores sub-pixel rounding within tolerance", () => {
    const d = evaluateReceiptFit({
      contentWidthPx: 795,
      availableWidthPx: 794,
      contentHeightPx: 1000,
      pageHeightPx: PAGE_H_PX,
      copyCount: 2,
    });
    expect(d.overflowX).toBe(false);
    expect(d.needsFallback).toBe(false);
  });

  it("flags vertical overflow when content needs a second page", () => {
    const d = evaluateReceiptFit({
      contentWidthPx: 700,
      availableWidthPx: 794,
      contentHeightPx: PAGE_H_PX * 1.5,
      pageHeightPx: PAGE_H_PX,
      copyCount: 2,
    });
    expect(d.overflowY).toBe(true);
    expect(d.estimatedPageCount).toBeGreaterThanOrEqual(2);
    expect(d.needsFallback).toBe(true);
  });
});

describe("ensureReceiptFitsOrFallback", () => {
  function mount(html: string): { host: HTMLElement; clone: HTMLElement } {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return { host, clone: host };
  }

  afterEachCleanup();

  it("returns null when there is no .pp-receipt in the clone", () => {
    const { clone } = mount(`<div class="doc-sheet"><p>Not a receipt</p></div>`);
    const decision = ensureReceiptFitsOrFallback({ clone, pageW: 210, pageH: 297 });
    expect(decision).toBeNull();
  });

  it("does not add the simplified class when receipt fits", () => {
    const { clone } = mount(`
      <div class="doc-sheet">
        <div class="pp-receipt" style="width:700px">
          <div class="pp-copy">A</div>
          <div class="pp-tear-line"></div>
          <div class="pp-copy">B</div>
        </div>
      </div>
    `);
    // jsdom returns 0 for layout — evaluateReceiptFit treats availableWidthPx=0
    // as "unknown" so overflowX is false. We spy on the receipt to
    // synthesise a healthy layout.
    const receipt = clone.querySelector<HTMLElement>(".pp-receipt")!;
    Object.defineProperty(receipt, "clientWidth", { value: 780, configurable: true });
    Object.defineProperty(receipt, "scrollWidth", { value: 780, configurable: true });
    Object.defineProperty(receipt, "scrollHeight", { value: 900, configurable: true });

    const decision = ensureReceiptFitsOrFallback({ clone, pageW: 210, pageH: 297 });
    expect(decision?.needsFallback).toBe(false);
    expect(receipt.classList.contains("pp-receipt--simplified")).toBe(false);
  });

  it("adds simplified class + injects stylesheet when overflowing", () => {
    const { clone } = mount(`
      <div class="doc-sheet">
        <div class="pp-receipt">
          <div class="pp-copy">A</div>
          <div class="pp-tear-line"></div>
          <div class="pp-copy">B</div>
        </div>
      </div>
    `);
    const receipt = clone.querySelector<HTMLElement>(".pp-receipt")!;
    Object.defineProperty(receipt, "clientWidth", { value: 780, configurable: true });
    Object.defineProperty(receipt, "scrollWidth", { value: 900, configurable: true });
    Object.defineProperty(receipt, "scrollHeight", { value: 3000, configurable: true });

    const decision = ensureReceiptFitsOrFallback({ clone, pageW: 210, pageH: 297 });
    expect(decision?.needsFallback).toBe(true);
    expect(receipt.classList.contains("pp-receipt--simplified")).toBe(true);
    const style = document.getElementById("pp-receipt-fallback-style");
    expect(style?.textContent).toBe(SIMPLIFIED_RECEIPT_CSS);
  });

  describe("computeAutoScale", () => {
    it("returns scale=1 when content fits", () => {
      const r = computeAutoScale({ contentWidthPx: 780, availableWidthPx: 794 });
      expect(r.applied).toBe(false);
      expect(r.scale).toBe(1);
      expect(r.reason).toBe("fits");
    });

    it("shrinks to fit when mildly overflowing", () => {
      const r = computeAutoScale({ contentWidthPx: 850, availableWidthPx: 794 });
      expect(r.applied).toBe(true);
      expect(r.belowMin).toBe(false);
      expect(r.scale).toBeGreaterThanOrEqual(MIN_AUTO_SCALE);
      expect(r.scale).toBeLessThan(1);
      // Post-scale width must not exceed the available width.
      expect(850 * r.scale).toBeLessThanOrEqual(794 + 0.5);
    });

    it("refuses to scale below MIN_AUTO_SCALE and flags belowMin", () => {
      const r = computeAutoScale({ contentWidthPx: 1200, availableWidthPx: 794 });
      expect(r.applied).toBe(false);
      expect(r.belowMin).toBe(true);
      expect(r.scale).toBe(MIN_AUTO_SCALE);
    });

    it("handles invalid metrics safely", () => {
      const r = computeAutoScale({ contentWidthPx: 0, availableWidthPx: 794 });
      expect(r.applied).toBe(false);
      expect(r.reason).toBe("invalid-metrics");
    });
  });
});

function afterEachCleanup() {
  // Local helper — vitest globals are available via test env config.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.afterEach === "function") {
    g.afterEach(() => {
      document.body.innerHTML = "";
      document.getElementById("pp-receipt-fallback-style")?.remove();
    });
  }
}
