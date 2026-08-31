/**
 * PrintLayoutDebugOverlay — temporary developer aid for diagnosing print
 * layout collapses (the class of bugs where `.doc-sheet` or `.doc-body`
 * ends up with zero height because a flex parent starves them).
 *
 * When toggled on, this overlay paints, for every `.pp-sheet` inside the
 * preview scroller:
 *
 *   • a cyan outline on the sheet's border-box (paper edge)
 *   • a lime outline on the sheet's `.doc-body` / `.doc-body-wrap`
 *     content region (or a red outline if it measures 0×0 — the exact
 *     signature of the flex-collapse bug)
 *   • a magenta page-break separator + label between consecutive sheets
 *     ("── Page break · N → N+1 ──")
 *   • a small badge per sheet with page number, computed size in px/mm,
 *     and a warning if `display` isn't `block` during print media
 *
 * All overlay chrome is wrapped in `@media print { display: none }` so it
 * can never leak into the printed output.
 */
import { useEffect, useRef, useState } from "react";

type SheetMeasurement = {
  index: number;
  sheetLeft: number;
  sheetTop: number;
  sheetWidth: number;
  sheetHeight: number;
  bodyLeft: number;
  bodyTop: number;
  bodyWidth: number;
  bodyHeight: number;
  bodyCollapsed: boolean;
  sheetDisplay: string;
  bodyDisplay: string;
};

const PX_PER_MM = 96 / 25.4;

function measureSheets(scroller: HTMLElement): SheetMeasurement[] {
  const sheets = Array.from(scroller.querySelectorAll<HTMLElement>(".pp-sheet"));
  if (sheets.length === 0) return [];
  const scrollerRect = scroller.getBoundingClientRect();
  const originX = -scrollerRect.left + scroller.scrollLeft;
  const originY = -scrollerRect.top + scroller.scrollTop;

  return sheets.map((sheet, index) => {
    const sRect = sheet.getBoundingClientRect();
    const sStyle = window.getComputedStyle(sheet);

    const body =
      sheet.querySelector<HTMLElement>(".doc-body") ??
      sheet.querySelector<HTMLElement>(".doc-body-wrap") ??
      sheet;
    const bRect = body.getBoundingClientRect();
    const bStyle = window.getComputedStyle(body);
    const bodyCollapsed = bRect.height < 1 || bRect.width < 1;

    return {
      index,
      sheetLeft: sRect.left + originX,
      sheetTop: sRect.top + originY,
      sheetWidth: sRect.width,
      sheetHeight: sRect.height,
      bodyLeft: bRect.left + originX,
      bodyTop: bRect.top + originY,
      bodyWidth: bRect.width,
      bodyHeight: bRect.height,
      bodyCollapsed,
      sheetDisplay: sStyle.display,
      bodyDisplay: bStyle.display,
    };
  });
}

export function PrintLayoutDebugOverlay({
  active,
  scrollerRef,
}: {
  active: boolean;
  scrollerRef: React.RefObject<HTMLElement | null>;
}) {
  const [sheets, setSheets] = useState<SheetMeasurement[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setSheets([]);
      return;
    }
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const recompute = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setSheets(measureSheets(scroller));
      });
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(scroller);
    const mo = new MutationObserver(recompute);
    mo.observe(scroller, { childList: true, subtree: true });
    scroller.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    // Also poll gently while the print flow re-mounts (fonts, layout).
    const tick = window.setInterval(recompute, 500);

    return () => {
      ro.disconnect();
      mo.disconnect();
      scroller.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
      window.clearInterval(tick);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [active, scrollerRef]);

  if (!active) return null;

  const collapsedCount = sheets.filter((s) => s.bodyCollapsed).length;

  return (
    <>
      <style>{`
        @media print {
          .pp-layout-debug,
          .pp-layout-debug-summary { display: none !important; }
        }
        .pp-layout-debug {
          position: absolute;
          pointer-events: none;
          z-index: 35;
        }
        .pp-layout-debug[data-kind="sheet"] {
          outline: 2px solid hsl(190 90% 55%);
          outline-offset: -1px;
          box-shadow: 0 0 0 1px hsl(190 90% 55% / 0.25) inset;
        }
        .pp-layout-debug[data-kind="body"] {
          outline: 2px dashed hsl(120 70% 50%);
          outline-offset: -1px;
        }
        .pp-layout-debug[data-kind="body"][data-collapsed="true"] {
          outline: 3px solid hsl(0 90% 55%);
          background: hsl(0 90% 55% / 0.18);
        }
        .pp-layout-debug[data-kind="pagebreak"] {
          border-top: 2px dashed hsl(300 90% 60%);
          height: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .pp-layout-debug-label {
          position: absolute;
          font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
          padding: 2px 5px;
          border-radius: 3px;
          white-space: nowrap;
          background: hsl(0 0% 10% / 0.9);
          color: hsl(0 0% 98%);
          box-shadow: 0 2px 6px hsl(0 0% 0% / 0.3);
        }
        .pp-layout-debug-label[data-kind="sheet"]  { background: hsl(190 90% 40%); }
        .pp-layout-debug-label[data-kind="body"]   { background: hsl(120 70% 35%); }
        .pp-layout-debug-label[data-kind="collapse"] { background: hsl(0 90% 45%); }
        .pp-layout-debug-label[data-kind="pagebreak"] {
          position: relative;
          background: hsl(300 90% 45%);
          transform: translateY(-50%);
        }
        .pp-layout-debug-summary {
          position: sticky;
          top: 8px;
          right: 8px;
          margin-left: auto;
          z-index: 41;
          width: fit-content;
          max-width: 280px;
          padding: 8px 10px;
          border-radius: 6px;
          background: hsl(0 0% 10% / 0.92);
          color: hsl(0 0% 98%);
          font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
          box-shadow: 0 4px 12px hsl(0 0% 0% / 0.25);
          font-variant-numeric: tabular-nums;
        }
        .pp-layout-debug-summary .warn { color: hsl(0 100% 78%); font-weight: 600; }
        .pp-layout-debug-summary .ok   { color: hsl(140 70% 72%); }
        .pp-layout-debug-summary .row  { display: flex; justify-content: space-between; gap: 12px; }
      `}</style>

      <div
        className="pp-layout-debug-summary"
        role="status"
        aria-live="polite"
        aria-label="Print layout debug summary"
      >
        <div className="row">
          <span>layout debug</span>
          <span>
            {sheets.length} sheet{sheets.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="row">
          <span>collapsed bodies</span>
          <span className={collapsedCount > 0 ? "warn" : "ok"}>{collapsedCount}</span>
        </div>
        {sheets.length === 0 && (
          <div className="row">
            <span>waiting for sheets…</span>
          </div>
        )}
      </div>

      {sheets.map((s) => {
        const wMm = (s.sheetWidth / PX_PER_MM).toFixed(0);
        const hMm = (s.sheetHeight / PX_PER_MM).toFixed(0);
        return (
          <div key={`sheet-${s.index}`}>
            <div
              className="pp-layout-debug"
              data-kind="sheet"
              style={{
                left: s.sheetLeft,
                top: s.sheetTop,
                width: s.sheetWidth,
                height: s.sheetHeight,
              }}
              aria-hidden="true"
            />
            <div
              className="pp-layout-debug-label"
              data-kind="sheet"
              style={{
                left: s.sheetLeft + 6,
                top: s.sheetTop + 6,
                zIndex: 42,
                position: "absolute",
              }}
              aria-hidden="true"
            >
              p{s.index + 1} · {Math.round(s.sheetWidth)}×{Math.round(s.sheetHeight)}px · {wMm}×
              {hMm}mm · display:{s.sheetDisplay}
            </div>

            <div
              className="pp-layout-debug"
              data-kind="body"
              data-collapsed={s.bodyCollapsed ? "true" : "false"}
              style={{
                left: s.bodyLeft,
                top: s.bodyTop,
                width: Math.max(s.bodyWidth, 4),
                height: Math.max(s.bodyHeight, 4),
              }}
              aria-hidden="true"
            />
            <div
              className="pp-layout-debug-label"
              data-kind={s.bodyCollapsed ? "collapse" : "body"}
              style={{
                left: s.bodyLeft + 6,
                top: s.bodyTop + 6,
                zIndex: 42,
                position: "absolute",
              }}
              aria-hidden="true"
            >
              body {Math.round(s.bodyWidth)}×{Math.round(s.bodyHeight)}
              {s.bodyCollapsed ? " · COLLAPSED" : ""} · display:{s.bodyDisplay}
            </div>
          </div>
        );
      })}

      {sheets.slice(0, -1).map((s, i) => {
        const next = sheets[i + 1];
        const midTop = (s.sheetTop + s.sheetHeight + next.sheetTop) / 2;
        const left = Math.min(s.sheetLeft, next.sheetLeft);
        const right = Math.max(s.sheetLeft + s.sheetWidth, next.sheetLeft + next.sheetWidth);
        return (
          <div
            key={`break-${i}`}
            className="pp-layout-debug"
            data-kind="pagebreak"
            style={{
              left,
              top: midTop,
              width: right - left,
            }}
            aria-hidden="true"
          >
            <span className="pp-layout-debug-label" data-kind="pagebreak">
              ── Page break · {s.index + 1} → {next.index + 1} ──
            </span>
          </div>
        );
      })}
    </>
  );
}
