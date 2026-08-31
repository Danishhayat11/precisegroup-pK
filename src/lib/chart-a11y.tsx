/**
 * Colorblind-safe series encoding.
 *
 * Charts must remain readable when color alone can't be relied on
 * (deuteranopia, protanopia, tritanopia, greyscale print). Every
 * series gets a redundant, non-color signal:
 *   - Lines: distinct strokeDasharray + distinct active-dot marker
 *   - Bars:  distinct SVG fill pattern layered on the token color
 *
 * Palette order matches the navy → mist ramp in styles.css so the
 * color story is preserved for sighted-color users.
 */
import * as React from "react";
import { Symbols } from "recharts";

export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** Solid, long-dash, dot, dash-dot, short-dash — visually distinct at 1.75–2.5px stroke. */
export const SERIES_DASH = ["0", "6 3", "1 3", "8 3 2 3", "3 3"] as const;

/** Recharts Symbols types — each shape reads differently in monochrome. */
export const SERIES_MARKERS = ["circle", "square", "triangle", "diamond", "cross"] as const;

export type SeriesIndex = 0 | 1 | 2 | 3 | 4;

export function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}
export function seriesDash(i: number): string {
  return SERIES_DASH[i % SERIES_DASH.length];
}
export function seriesMarker(i: number): (typeof SERIES_MARKERS)[number] {
  return SERIES_MARKERS[i % SERIES_MARKERS.length];
}

/**
 * Active-dot renderer for <Line activeDot={renderSeriesMarker(i)} />.
 * Uses recharts' built-in Symbols so shapes match legend icons.
 */
export function renderSeriesMarker(i: number, size = 64) {
  const type = seriesMarker(i);
  const color = seriesColor(i);
  return (props: { cx?: number; cy?: number }) => {
    const { cx, cy } = props;
    if (cx == null || cy == null) return <g />;
    return (
      <Symbols
        cx={cx}
        cy={cy}
        type={type}
        size={size}
        fill={color}
        stroke="var(--background)"
        strokeWidth={2}
      />
    );
  };
}

/**
 * SVG <defs> block with one <pattern> per series. Drop inside any chart's
 * root <svg> (recharts renders BarChart/LineChart as a single <svg>, so
 * putting this as the first child of the chart works).
 *
 * Fills are two-layer: the token color as background + a white/foreground
 * texture stroked at low opacity so the pattern reads without shifting hue.
 */
export function ChartPatternDefs() {
  return (
    <defs>
      {/* 0: solid navy */}
      <pattern id="cb-p-0" patternUnits="userSpaceOnUse" width="8" height="8">
        <rect width="8" height="8" fill="var(--chart-1)" />
      </pattern>
      {/* 1: diagonal stripes ↗ */}
      <pattern
        id="cb-p-1"
        patternUnits="userSpaceOnUse"
        width="6"
        height="6"
        patternTransform="rotate(45)"
      >
        <rect width="6" height="6" fill="var(--chart-2)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--background)" strokeWidth="2" />
      </pattern>
      {/* 2: dot grid */}
      <pattern id="cb-p-2" patternUnits="userSpaceOnUse" width="6" height="6">
        <rect width="6" height="6" fill="var(--chart-3)" />
        <circle cx="3" cy="3" r="1.1" fill="var(--background)" />
      </pattern>
      {/* 3: cross-hatch */}
      <pattern id="cb-p-3" patternUnits="userSpaceOnUse" width="8" height="8">
        <rect width="8" height="8" fill="var(--chart-4)" />
        <path d="M0 4 H8 M4 0 V8" stroke="var(--background)" strokeWidth="1" />
      </pattern>
      {/* 4: horizontal stripes */}
      <pattern id="cb-p-4" patternUnits="userSpaceOnUse" width="6" height="6">
        <rect width="6" height="6" fill="var(--chart-5)" />
        <line
          x1="0"
          y1="3"
          x2="6"
          y2="3"
          stroke="var(--foreground)"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
      </pattern>
    </defs>
  );
}

export function seriesPatternFill(i: number): string {
  return `url(#cb-p-${i % 5})`;
}
