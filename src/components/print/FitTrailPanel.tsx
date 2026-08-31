/**
 * FitTrailPanel — dev-facing log feed for the auto-fit search.
 *
 * Design goals:
 *   • Windowed rendering — no matter how large the trail (10, 10k, 100k
 *     entries), the DOM only ever holds the rows currently in the
 *     viewport plus a small overscan buffer. Scroll geometry is preserved
 *     by a spacer element of `total * ROW_HEIGHT` px.
 *   • Sticky header advertises windowing status so it's always in view.
 *   • Auto-scroll pins to the tail unless the user has scrolled up; a
 *     "Jump to latest" affordance appears while pinning is disabled.
 *   • Rows are React.memo'd + keyed by iteration so appending a step only
 *     mounts one new node — no O(n) re-render of the history.
 *   • Glassmorphism surface, monospace typography, decision-coloured rows.
 *
 * The panel is intentionally presentational: it takes the full log array
 * and derives what to render. Owners keep pushing entries — no queue mgmt.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { FitLogEntry } from "@/lib/fitToOnePage";
import { cn } from "@/lib/utils";

/**
 * Default row height in pixels. Rows are single-line monospace at
 * text-[10.5px] leading-snug, which measures ~16px at the baseline
 * typography. Consumers may pass a `rowHeight` prop to override this,
 * and — when not overridden — the panel auto-measures a hidden probe
 * row and re-measures on font load, theme change, and container resize
 * so virtualization math stays accurate across responsive layouts.
 */
export const FIT_TRAIL_ROW_HEIGHT = 16;
/**
 * Minimum viable row height. Guards against transient 0-height reads
 * (fonts still loading, display:none ancestor) that would otherwise
 * collapse the spacer and break scroll geometry.
 */
const FIT_TRAIL_MIN_ROW_HEIGHT = 8;
/**
 * Extra rows rendered above/below the viewport to hide scroll seams.
 *
 * Sized to absorb fast log bursts: at ~16px/row and a 224px viewport we
 * mount ~14 visible rows; a 16-row buffer on each side means we can
 * append 16 entries between paints before an unbuffered row would flash
 * in at the edge. Increase only if the trail regularly appends >16
 * rows/frame (rare) — bigger buffers cost DOM nodes for no visible gain.
 */
export const FIT_TRAIL_OVERSCAN = 16;

/** Viewport height in px — matches Tailwind's max-h-56 (14rem). */
export const FIT_TRAIL_VIEWPORT_PX = 224;
/** Pixel slack from the bottom that still counts as "pinned to latest". */
const PIN_TO_BOTTOM_SLACK_PX = 24;

type FitTrailPanelProps = {
  log: readonly FitLogEntry[];
  /** Optional override for the viewport height in px (embed variants). */
  viewportPx?: number;
  /**
   * Explicit row height override in px. When omitted, the panel
   * auto-measures a hidden probe row and re-measures whenever the
   * layout could change row metrics (theme toggle, web font load,
   * container resize).
   */
  rowHeight?: number;
  className?: string;
};

function decisionTone(entry: FitLogEntry): string {
  if (entry.impossible) return "text-amber-300";
  if (entry.decision === "done") return "text-emerald-300";
  if (entry.unstable) return "text-fuchsia-300";
  if (entry.reason.includes("clamped")) return "text-sky-300";
  return "text-slate-300";
}

const FitTrailRow = memo(function FitTrailRow({
  entry,
  top,
  rowHeight,
}: {
  entry: FitLogEntry;
  top: number;
  rowHeight: number;
}) {
  return (
    <div
      className={cn(
        // Absolutely positioned inside the total-height spacer so scroll
        // geometry is honest — the browser's scrollbar reflects the full
        // log length, not just the rendered window.
        "absolute left-0 right-0 grid grid-cols-[auto_1fr] gap-x-2 whitespace-pre px-2.5 font-mono text-[10.5px] leading-snug",
        decisionTone(entry),
      )}
      style={{ top, height: rowHeight }}
      data-testid="fit-trail-row"
      data-iteration={entry.iteration}
    >
      <span className="tabular-nums text-slate-500">
        #{String(entry.iteration).padStart(3, " ")}
      </span>
      <span>
        @{entry.currentScale}% → pages={entry.pageCount} · lo={entry.lo} hi={String(entry.hi)}
        {" · "}
        {entry.decision}:{entry.nextScale}%
        <span className="opacity-70">
          {" "}
          ({entry.reason}
          {entry.impossible ? ", impossible" : ""}
          {entry.unstable ? ", unstable" : ""})
        </span>
      </span>
    </div>
  );
});

export function FitTrailPanel({
  log,
  viewportPx = FIT_TRAIL_VIEWPORT_PX,
  rowHeight: rowHeightProp,
  className,
}: FitTrailPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const jumpInputRef = useRef<HTMLInputElement | null>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(viewportPx);
  // Text filter — matches iteration #, decision, reason, and scale.
  const [query, setQuery] = useState("");
  // Controlled value for the "Jump to iteration #N" input.
  const [jumpValue, setJumpValue] = useState("");
  // Transient hint about the last jump attempt (found / missing / empty).
  const [jumpStatus, setJumpStatus] = useState<null | "found" | "missing">(null);
  // `effectiveRowHeight` drives every windowing calculation. When the
  // consumer passes `rowHeight` explicitly we honour it verbatim;
  // otherwise we seed with the default constant and let the probe-row
  // effect below refine it in response to font/theme/container changes.
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number>(
    rowHeightProp ?? FIT_TRAIL_ROW_HEIGHT,
  );
  const effectiveRowHeight = rowHeightProp ?? measuredRowHeight;

  // The visible log is the filtered view. Windowing math operates on
  // this list — the raw `log` is only used for the reset-on-new-run
  // heuristic below and for the jump-to-iteration lookup.
  const visibleLog = useMemo<FitLogEntry[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return log as FitLogEntry[];
    return (log as FitLogEntry[]).filter((entry) => {
      if (String(entry.iteration).includes(q)) return true;
      if (entry.decision.toLowerCase().includes(q)) return true;
      if (entry.reason.toLowerCase().includes(q)) return true;
      if (String(entry.currentScale).includes(q)) return true;
      if (String(entry.nextScale).includes(q)) return true;
      return false;
    });
  }, [log, query]);

  const total = visibleLog.length;
  const rawTotal = log.length;
  const totalHeight = total * effectiveRowHeight;
  const headerHeightRef = useRef(0);

  // Auto-measure the real rendered row height by reading a hidden probe
  // row. This keeps virtualization accurate when the surrounding layout
  // changes row metrics we can't see from JS alone:
  //   • web fonts finish loading after first paint,
  //   • the user toggles theme (dark ↔ light) and CSS custom properties
  //     resolve to different line-heights,
  //   • the container is resized (responsive typography, zoom).
  // Skipped entirely when the consumer pinned a `rowHeight` prop, and
  // when ResizeObserver / document.fonts aren't available (jsdom, SSR).
  useEffect(() => {
    if (rowHeightProp !== undefined) return;
    if (typeof window === "undefined") return;
    if (typeof ResizeObserver === "undefined") return;
    const probe = probeRef.current;
    if (!probe) return;

    const applyMeasurement = () => {
      const h = probe.getBoundingClientRect().height;
      if (!Number.isFinite(h) || h < FIT_TRAIL_MIN_ROW_HEIGHT) return;
      const next = Math.round(h);
      setMeasuredRowHeight((prev) => (prev === next ? prev : next));
    };

    applyMeasurement();

    const ro = new ResizeObserver(applyMeasurement);
    ro.observe(probe);

    // Web fonts land after first paint — re-measure once they resolve.
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    let cancelled = false;
    fonts?.ready
      .then(() => {
        if (!cancelled) applyMeasurement();
      })
      .catch(() => {});

    // Theme toggles flip a class on <html>; leading may change with the
    // font-feature stack. Observe the root class attribute.
    const mo = new MutationObserver(applyMeasurement);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

    return () => {
      cancelled = true;
      ro.disconnect();
      mo.disconnect();
    };
  }, [rowHeightProp]);

  // Count of raw log entries appended while the user was scrolled away
  // from the tail — surfaces as the "New logs available" indicator so
  // auto-scroll never yanks the viewport out from under the reader.
  const [unseenCount, setUnseenCount] = useState(0);

  // Reset scroll position and re-pin when a new run starts. Uses the
  // raw log length so toggling the search filter never masquerades as a
  // shrink. Also feeds the unseen-log counter: any append that lands
  // while the user is scrolled up increments it; a shrink or a re-pin
  // clears it.
  const prevRawLenRef = useRef(rawTotal);
  useEffect(() => {
    const prev = prevRawLenRef.current;
    if (rawTotal < prev) {
      pinnedRef.current = true;
      setPinned(true);
      setScrollTop(0);
      setQuery("");
      setJumpValue("");
      setJumpStatus(null);
      setUnseenCount(0);
    } else if (rawTotal > prev && !pinnedRef.current) {
      const delta = rawTotal - prev;
      setUnseenCount((c) => c + delta);
    }
    prevRawLenRef.current = rawTotal;
  }, [rawTotal]);

  // Whenever the viewport returns to the tail (pinned = true), acknowledge
  // any queued entries — the reader has effectively caught up.
  useEffect(() => {
    if (pinned) setUnseenCount(0);
  }, [pinned]);

  // Compute the visible window from the current scroll offset. Rows
  // above / below the viewport are simply not mounted.
  const { startIndex, endIndex } = useMemo(() => {
    if (total === 0) return { startIndex: 0, endIndex: 0 };
    const visibleRows = Math.ceil(measuredHeight / effectiveRowHeight);
    const start = Math.max(0, Math.floor(scrollTop / effectiveRowHeight) - FIT_TRAIL_OVERSCAN);
    const end = Math.min(total, start + visibleRows + FIT_TRAIL_OVERSCAN * 2);
    return { startIndex: start, endIndex: end };
  }, [scrollTop, measuredHeight, total, effectiveRowHeight]);

  const windowRows = useMemo(
    () => visibleLog.slice(startIndex, endIndex),
    [visibleLog, startIndex, endIndex],
  );
  const hiddenAbove = startIndex;
  const hiddenBelow = Math.max(0, total - endIndex);

  // Track user scroll intent — record scrollTop for windowing and derive
  // pin state from distance to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Measure the actual viewport height once mounted so the row math
    // adapts if a consumer passed className that resizes the scroller.
    if (el.clientHeight && el.clientHeight !== measuredHeight) {
      setMeasuredHeight(el.clientHeight);
    }
    const onScroll = () => {
      setScrollTop(el.scrollTop);
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nowPinned = distanceFromBottom <= PIN_TO_BOTTOM_SLACK_PX;
      if (nowPinned !== pinnedRef.current) {
        pinnedRef.current = nowPinned;
        setPinned(nowPinned);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [measuredHeight]);

  // Auto-scroll to bottom on new entries — but only when pinned. We
  // compute the target from our known geometry rather than reading
  // `el.scrollHeight` so windowing math stays consistent (jsdom-safe too).
  useLayoutEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const contentViewport = Math.max(0, measuredHeight - headerHeightRef.current);
    const desired = Math.max(0, totalHeight - contentViewport);
    el.scrollTop = desired;
    setScrollTop(desired);
  }, [totalHeight, measuredHeight]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    setPinned(true);
    setUnseenCount(0);
    const contentViewport = Math.max(0, measuredHeight - headerHeightRef.current);
    const desired = Math.max(0, totalHeight - contentViewport);
    el.scrollTop = desired;
    setScrollTop(desired);
  };

  /**
   * Jump to a specific iteration number. Locates it in the current
   * (possibly filtered) view, centres it in the viewport, and unpins
   * from the tail so it stays put as new rows arrive. Reports back via
   * `jumpStatus` so the UI can flash a "not found" hint without a modal.
   */
  const jumpToIteration = (iteration: number) => {
    const el = scrollRef.current;
    if (!el) {
      setJumpStatus("missing");
      return;
    }
    const index = visibleLog.findIndex((e) => e.iteration === iteration);
    if (index < 0) {
      setJumpStatus("missing");
      return;
    }
    const contentViewport = Math.max(0, measuredHeight - headerHeightRef.current);
    const rowTop = index * effectiveRowHeight;
    // Centre the target row inside the content viewport where possible.
    const desired = Math.max(
      0,
      Math.min(
        totalHeight - contentViewport,
        rowTop - Math.max(0, (contentViewport - effectiveRowHeight) / 2),
      ),
    );
    pinnedRef.current = false;
    setPinned(false);
    el.scrollTop = desired;
    setScrollTop(desired);
    setJumpStatus("found");
  };

  const handleJumpSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = Number.parseInt(jumpValue, 10);
    if (!Number.isFinite(n)) {
      setJumpStatus("missing");
      return;
    }
    jumpToIteration(n);
  };

  return (
    <div
      className={cn(
        // Glassmorphism surface — dark tint, hairline border, blur.
        "relative mt-1 rounded-lg border border-white/10 bg-slate-950/70 text-slate-200 shadow-inner backdrop-blur-xl",
        "supports-[backdrop-filter]:bg-slate-950/55",
        className,
      )}
      data-testid="fit-trail-panel"
      data-total={total}
      data-window-start={startIndex}
      data-window-end={endIndex}
      data-row-height={effectiveRowHeight}
      data-row-height-source={rowHeightProp !== undefined ? "prop" : "measured"}
    >
      <div
        ref={scrollRef}
        className="max-h-56 overflow-auto rounded-lg"
        style={{ maxHeight: viewportPx }}
        role="log"
        aria-live="off"
        aria-label="Fit search trail"
      >
        {/* Sticky windowing / status header + search toolbar */}
        <div
          ref={(node) => {
            headerHeightRef.current = node?.offsetHeight ?? 0;
          }}
          className={cn(
            "sticky top-0 z-10 flex flex-col gap-1.5 border-b border-white/10 px-2.5 py-1.5",
            "bg-slate-950/85 backdrop-blur-xl",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[10.5px] font-medium">
              <span className="text-slate-300">
                Fit trail{" "}
                <span className="tabular-nums text-slate-500">
                  (
                  {query
                    ? `${total} of ${rawTotal} step${rawTotal === 1 ? "" : "s"}`
                    : `${total} step${total === 1 ? "" : "s"}`}
                  )
                </span>
              </span>
              {total > 0 ? (
                <span
                  data-testid="fit-trail-window-indicator"
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-slate-300 tabular-nums"
                  title={`Rendering ${windowRows.length} of ${total} entries — the rest are windowed out to keep the UI responsive.`}
                >
                  <span aria-hidden>▤</span> Window {startIndex + (windowRows.length > 0 ? 1 : 0)}–
                  {endIndex} / {total}
                </span>
              ) : null}
              {(() => {
                // Live "Showing iterations X–Y" chip: reads the true
                // on-screen slice (excluding overscan) and reports the
                // iteration numbers of the first and last visible rows.
                if (total === 0 || windowRows.length === 0) return null;
                const contentViewport = Math.max(0, measuredHeight - headerHeightRef.current);
                const firstVisibleIdx = Math.min(
                  total - 1,
                  Math.max(startIndex, Math.floor(scrollTop / effectiveRowHeight)),
                );
                const lastVisibleIdx = Math.min(
                  endIndex - 1,
                  Math.max(
                    firstVisibleIdx,
                    Math.floor(
                      (scrollTop + Math.max(contentViewport, effectiveRowHeight) - 1) /
                        effectiveRowHeight,
                    ),
                  ),
                );
                const first = visibleLog[firstVisibleIdx];
                const last = visibleLog[lastVisibleIdx];
                if (!first || !last) return null;
                const label =
                  first.iteration === last.iteration
                    ? `Showing iteration #${first.iteration}`
                    : `Showing iterations #${first.iteration}–#${last.iteration}`;
                return (
                  <span
                    data-testid="fit-trail-visible-iterations"
                    data-first-iteration={first.iteration}
                    data-last-iteration={last.iteration}
                    className="inline-flex items-center gap-1 rounded-full border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] font-medium text-slate-400 tabular-nums"
                    title={`${label} out of ${rawTotal} total. Updates live as you scroll.`}
                    aria-live="polite"
                  >
                    <span aria-hidden>◉</span> #{first.iteration}–#{last.iteration}
                  </span>
                );
              })()}

              {total > 0 && (hiddenAbove > 0 || hiddenBelow > 0) ? (
                <span
                  data-testid="fit-trail-buffer-indicator"
                  data-hidden-above={hiddenAbove}
                  data-hidden-below={hiddenBelow}
                  data-overscan={FIT_TRAIL_OVERSCAN}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9.5px] font-medium text-slate-400 tabular-nums"
                  title={`Buffer keeps ${FIT_TRAIL_OVERSCAN} rows above and below the viewport to smooth over fast log bursts. Currently ${hiddenAbove} rows hidden above · ${hiddenBelow} below.`}
                >
                  <span aria-hidden>⇅</span> Buffer +{hiddenAbove}↑ · +{hiddenBelow}↓
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              {!pinned && unseenCount > 0 ? (
                <button
                  type="button"
                  data-testid="fit-trail-new-logs"
                  data-unseen-count={unseenCount}
                  onClick={jumpToLatest}
                  aria-live="polite"
                  title={`${unseenCount} new log ${unseenCount === 1 ? "entry has" : "entries have"} arrived since you scrolled up. Click to jump to the tail and resume auto-scroll.`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition",
                    "border-emerald-400/40 bg-emerald-400/15 text-emerald-200 shadow-[0_0_0_1px_rgba(52,211,153,0.15)]",
                    "hover:bg-emerald-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40",
                    "animate-pulse",
                  )}
                >
                  <span aria-hidden>●</span>
                  New logs available (+{unseenCount > 999 ? "999+" : unseenCount}) ↓
                </button>
              ) : !pinned ? (
                <button
                  type="button"
                  data-testid="fit-trail-jump-latest"
                  onClick={jumpToLatest}
                  className="rounded-md border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-200 transition hover:bg-sky-400/20"
                >
                  Jump to latest ↓
                </button>
              ) : null}
            </div>
          </div>

          {/* Search + jump toolbar — appears once there's anything to search. */}
          {rawTotal > 0 ? (
            <div className="flex items-center gap-1.5">
              <label className="relative flex-1">
                <span className="sr-only">Filter fit trail entries</span>
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500"
                >
                  ⌕
                </span>
                <input
                  type="search"
                  data-testid="fit-trail-search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    // Filtering shifts the scroll geometry — reset to top
                    // so match #1 lands at the visible edge.
                    setScrollTop(0);
                    const el = scrollRef.current;
                    if (el) el.scrollTop = 0;
                    pinnedRef.current = false;
                    setPinned(false);
                    setJumpStatus(null);
                  }}
                  placeholder="Filter by iter, decision, reason, scale…"
                  className="w-full rounded-md border border-white/10 bg-white/5 py-0.5 pl-5 pr-1.5 text-[10.5px] font-mono text-slate-200 placeholder:text-slate-500 focus:border-sky-400/40 focus:outline-none focus:ring-1 focus:ring-sky-400/30"
                />
              </label>
              <form
                onSubmit={handleJumpSubmit}
                className="flex items-center gap-1"
                data-testid="fit-trail-jump-form"
              >
                <label className="text-[9.5px] uppercase tracking-wide text-slate-500">
                  Jump #
                  <input
                    ref={jumpInputRef}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    data-testid="fit-trail-jump-input"
                    value={jumpValue}
                    onChange={(e) => {
                      setJumpValue(e.target.value);
                      setJumpStatus(null);
                    }}
                    placeholder="123"
                    className="ml-1 w-14 rounded-md border border-white/10 bg-white/5 px-1 py-0.5 text-center text-[10.5px] font-mono tabular-nums text-slate-200 placeholder:text-slate-500 focus:border-sky-400/40 focus:outline-none focus:ring-1 focus:ring-sky-400/30"
                  />
                </label>
                <button
                  type="submit"
                  data-testid="fit-trail-jump-submit"
                  className="rounded-md border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-200 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={jumpValue.trim() === ""}
                >
                  Go →
                </button>
                {jumpStatus === "missing" ? (
                  <span
                    data-testid="fit-trail-jump-status"
                    className="text-[9.5px] font-medium text-amber-300"
                    role="status"
                  >
                    Not found
                  </span>
                ) : jumpStatus === "found" ? (
                  <span
                    data-testid="fit-trail-jump-status"
                    className="text-[9.5px] font-medium text-emerald-300"
                    role="status"
                  >
                    Located
                  </span>
                ) : null}
              </form>
            </div>
          ) : null}
        </div>

        {/* Hidden probe row — measured, never visible or interactive.
            Kept in the same typographic context as real rows so any CSS
            that would affect their height (font, leading, theme vars)
            affects the probe the same way. Skipped when the consumer
            pinned an explicit rowHeight prop. */}
        {rowHeightProp === undefined ? (
          <div
            ref={probeRef}
            aria-hidden="true"
            data-testid="fit-trail-row-probe"
            className="pointer-events-none absolute left-0 right-0 grid grid-cols-[auto_1fr] gap-x-2 whitespace-pre px-2.5 font-mono text-[10.5px] leading-snug opacity-0"
            style={{ top: -9999, visibility: "hidden" }}
          >
            <span className="tabular-nums">#000</span>
            <span>probe</span>
          </div>
        ) : null}

        {/* Full-height spacer — its height reflects the entire log so the
            native scrollbar is proportional to total length. Rendered rows
            are absolutely positioned inside it at their true offsets. */}
        <div
          className="relative"
          style={{ height: totalHeight, minHeight: totalHeight ? undefined : 0 }}
          data-testid="fit-trail-spacer"
          data-hidden-above={hiddenAbove}
          data-hidden-below={hiddenBelow}
        >
          {windowRows.map((entry, i) => (
            <FitTrailRow
              key={entry.iteration}
              entry={entry}
              top={(startIndex + i) * effectiveRowHeight}
              rowHeight={effectiveRowHeight}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
