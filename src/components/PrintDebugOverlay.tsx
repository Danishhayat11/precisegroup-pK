/**
 * PrintDebugOverlay — temporary developer aid for the receipt print flow.
 *
 * When toggled on, this component measures the first `.pp-sheet` (or
 * `.pp-receipt` fallback) inside the preview scroller and paints three
 * kinds of debug affordances on top of the preview:
 *
 *   1. A sticky readout in the top-left with:
 *        • measured content width  — max right-edge of any descendant
 *        • available width         — the sheet's content-box width
 *        • overflow                — content − available, in CSS px
 *        • overflow-count          — number of descendants clipped
 *   2. A magenta outline on the sheet's content-box (available width).
 *   3. A red outline + label on every descendant whose bounding rect
 *      extends beyond the sheet's right edge or beyond the sheet's
 *      bottom edge (i.e. anything the print driver will clip).
 *
 * The overlay is preview-only — everything is wrapped in a `@media print`
 * `display: none` rule so it can never leak into the printed sheet.
 *
 * Owned by `PrintPreviewModal`. Hidden by default; the toggle in the
 * toolbar is only shown for receipt documents.
 */
import { useEffect, useRef, useState } from "react";

type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
  tag: string;
  reason: "right" | "bottom" | "both";
};

type Measurement = {
  contentWidth: number;
  availableWidth: number;
  overflowRight: number;
  overflowBottom: number;
  overflowCount: number;
  sheetLeft: number;
  sheetTop: number;
  boxes: Box[];
};

const TOLERANCE_PX = 0.5;

function measureSheet(scroller: HTMLElement): Measurement | null {
  const sheet =
    scroller.querySelector<HTMLElement>(".pp-sheet") ??
    scroller.querySelector<HTMLElement>(".pp-receipt");
  if (!sheet) return null;

  const sRect = sheet.getBoundingClientRect();
  const style = window.getComputedStyle(sheet);
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const padT = parseFloat(style.paddingTop) || 0;
  const padB = parseFloat(style.paddingBottom) || 0;

  const availableWidth = sRect.width - padL - padR;
  const contentLeft = sRect.left + padL;
  const contentRight = sRect.right - padR;
  const contentBottom = sRect.bottom - padB;

  let maxRight = contentLeft;
  const boxes: Box[] = [];
  const descendants = sheet.querySelectorAll<HTMLElement>("*");
  for (const el of descendants) {
    // Skip zero-size / hidden nodes to keep the overlay readable.
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > maxRight) maxRight = r.right;

    const overRight = r.right - contentRight > TOLERANCE_PX;
    const overBottom = r.bottom - contentBottom > TOLERANCE_PX;
    if (!overRight && !overBottom) continue;

    // Ignore ancestors of already-recorded overflows — a wrapping <div>
    // will report the same overflow as its child and just add noise.
    const alreadyChild = boxes.some(
      (b) =>
        r.left >= b.left - 0.5 &&
        r.top >= b.top - 0.5 &&
        r.right <= b.left + b.width + 0.5 &&
        r.bottom <= b.top + b.height + 0.5,
    );
    if (alreadyChild) continue;

    boxes.push({
      left: r.left - sRect.left,
      top: r.top - sRect.top,
      width: r.width,
      height: r.height,
      tag:
        el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(/\s+/)[0]}` : ""),
      reason: overRight && overBottom ? "both" : overRight ? "right" : "bottom",
    });
    if (boxes.length >= 25) break;
  }

  const contentWidth = maxRight - contentLeft;
  return {
    contentWidth,
    availableWidth,
    overflowRight: Math.max(0, contentWidth - availableWidth),
    overflowBottom: boxes.reduce(
      (acc, b) => Math.max(acc, b.top + b.height - (sRect.height - padB - padT)),
      0,
    ),
    overflowCount: boxes.length,
    sheetLeft: sRect.left - scroller.getBoundingClientRect().left + scroller.scrollLeft,
    sheetTop: sRect.top - scroller.getBoundingClientRect().top + scroller.scrollTop,
    boxes,
  };
}

export function PrintDebugOverlay({
  active,
  scrollerRef,
}: {
  active: boolean;
  scrollerRef: React.RefObject<HTMLElement | null>;
}) {
  const [m, setM] = useState<Measurement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setM(null);
      return;
    }
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const recompute = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setM(measureSheet(scroller));
      });
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(scroller);
    const sheet =
      scroller.querySelector<HTMLElement>(".pp-sheet") ??
      scroller.querySelector<HTMLElement>(".pp-receipt");
    if (sheet) ro.observe(sheet);
    scroller.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);

    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [active, scrollerRef]);

  if (!active) return null;

  return (
    <>
      <style>{`
        @media print { .pp-debug-overlay, .pp-debug-readout { display: none !important; } }
        .pp-debug-overlay {
          position: absolute;
          pointer-events: none;
          z-index: 30;
          outline: 2px dashed hsl(300 90% 55%);
          outline-offset: -1px;
        }
        .pp-debug-overlay[data-kind="clip"] {
          outline: 2px solid hsl(0 90% 55%);
          background: hsla(0, 90%, 55%, 0.12);
        }
        .pp-debug-overlay-label {
          position: absolute;
          top: -14px;
          left: 0;
          font: 500 10px/1 system-ui, sans-serif;
          background: hsl(0 90% 55%);
          color: white;
          padding: 2px 4px;
          border-radius: 2px;
          white-space: nowrap;
          pointer-events: none;
        }
        .pp-debug-readout {
          position: sticky;
          top: 8px;
          left: 8px;
          z-index: 40;
          width: fit-content;
          max-width: 260px;
          margin: 0 0 8px 0;
          padding: 8px 10px;
          border-radius: 6px;
          background: hsl(0 0% 10% / 0.92);
          color: hsl(0 0% 98%);
          font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
          box-shadow: 0 4px 12px hsl(0 0% 0% / 0.25);
          font-variant-numeric: tabular-nums;
        }
        .pp-debug-readout b { color: hsl(50 100% 70%); font-weight: 600; }
        .pp-debug-readout .row { display: flex; justify-content: space-between; gap: 12px; }
        .pp-debug-readout .warn { color: hsl(0 100% 75%); }
        .pp-debug-readout .ok { color: hsl(140 70% 70%); }
      `}</style>

      <div
        className="pp-debug-readout"
        role="status"
        aria-live="polite"
        aria-label="Print preview debug measurements"
      >
        <div className="row">
          <span>debug</span>
          <b>print flow</b>
        </div>
        {m ? (
          <>
            <div className="row">
              <span>content</span>
              <span>{m.contentWidth.toFixed(1)} px</span>
            </div>
            <div className="row">
              <span>available</span>
              <span>{m.availableWidth.toFixed(1)} px</span>
            </div>
            <div className="row">
              <span>overflow ↔</span>
              <span className={m.overflowRight > TOLERANCE_PX ? "warn" : "ok"}>
                {m.overflowRight.toFixed(1)} px
              </span>
            </div>
            <div className="row">
              <span>overflow ↕</span>
              <span className={m.overflowBottom > TOLERANCE_PX ? "warn" : "ok"}>
                {m.overflowBottom.toFixed(1)} px
              </span>
            </div>
            <div className="row">
              <span>clipped nodes</span>
              <span className={m.overflowCount > 0 ? "warn" : "ok"}>{m.overflowCount}</span>
            </div>
          </>
        ) : (
          <div className="row">
            <span>waiting for sheet…</span>
          </div>
        )}
      </div>

      {m && (
        <div
          className="pp-debug-overlay"
          data-kind="available"
          style={{
            left: m.sheetLeft,
            top: m.sheetTop,
            width: m.availableWidth,
            height: 4,
          }}
          aria-hidden="true"
        />
      )}
      {m?.boxes.map((b, i) => (
        <div
          key={i}
          className="pp-debug-overlay"
          data-kind="clip"
          style={{
            left: m.sheetLeft + b.left,
            top: m.sheetTop + b.top,
            width: b.width,
            height: b.height,
          }}
          aria-hidden="true"
        >
          <span className="pp-debug-overlay-label">
            {b.tag} · {b.reason === "both" ? "→↓" : b.reason === "right" ? "→" : "↓"}{" "}
            {Math.round(b.width)}×{Math.round(b.height)}
          </span>
        </div>
      ))}
    </>
  );
}
