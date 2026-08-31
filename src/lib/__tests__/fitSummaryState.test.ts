import { describe, it, expect } from "vitest";
import {
  deriveFitDisplay,
  geometryKey,
  sameGeometry,
  describeGeometry,
  type CompletedFitResult,
  type FitGeometry,
} from "@/lib/fitSummaryState";

const A4P: FitGeometry = { paper: "A4", orientation: "portrait", margins: "12.7mm" };
const A4L: FitGeometry = { paper: "A4", orientation: "landscape", margins: "12.7mm" };
const A4P_TIGHT: FitGeometry = { paper: "A4", orientation: "portrait", margins: "6mm" };

function completed(over: Partial<CompletedFitResult> = {}): CompletedFitResult {
  return {
    scale: 85,
    steps: 4,
    minScale: 50,
    maxScale: 90,
    unstable: false,
    impossible: false,
    geometry: A4P,
    ...over,
  };
}

describe("fitSummaryState — pure helpers", () => {
  it("geometryKey encodes paper/orientation/margins", () => {
    expect(geometryKey(A4P)).toBe("A4|portrait|12.7mm");
    expect(geometryKey(A4L)).toBe("A4|landscape|12.7mm");
    expect(geometryKey(A4P_TIGHT)).toBe("A4|portrait|6mm");
  });

  it("sameGeometry compares by structural key", () => {
    expect(sameGeometry(A4P, { ...A4P })).toBe(true);
    expect(sameGeometry(A4P, A4L)).toBe(false);
    expect(sameGeometry(A4P, A4P_TIGHT)).toBe(false);
  });

  it("describeGeometry renders a readable echo", () => {
    expect(describeGeometry(A4P)).toBe("A4 portrait, margins 12.7mm");
  });
});

describe("deriveFitDisplay", () => {
  it("returns off when fit toggle is disabled", () => {
    expect(deriveFitDisplay({ fitOnePage: false, fitResult: null, currentGeometry: A4P })).toEqual({
      status: "off",
    });
    // Even with a stored result, off wins so the panel disappears entirely.
    expect(
      deriveFitDisplay({ fitOnePage: false, fitResult: completed(), currentGeometry: A4P }),
    ).toEqual({ status: "off" });
  });

  it("returns recomputing with the *current* geometry when no result yet", () => {
    const d = deriveFitDisplay({ fitOnePage: true, fitResult: null, currentGeometry: A4L });
    expect(d.status).toBe("recomputing");
    if (d.status === "recomputing") expect(d.geometry).toEqual(A4L);
  });

  it("returns recomputing on orientation switch until the result catches up", () => {
    const stale = completed({ geometry: A4P });
    const d = deriveFitDisplay({ fitOnePage: true, fitResult: stale, currentGeometry: A4L });
    expect(d.status).toBe("recomputing");
    if (d.status === "recomputing") expect(d.geometry).toEqual(A4L);
  });

  it("returns recomputing on margin preset change", () => {
    const stale = completed({ geometry: A4P });
    const d = deriveFitDisplay({ fitOnePage: true, fitResult: stale, currentGeometry: A4P_TIGHT });
    expect(d.status).toBe("recomputing");
    if (d.status === "recomputing") expect(d.geometry.margins).toBe("6mm");
  });

  it("returns success once the fresh result matches the current geometry", () => {
    const fresh = completed({ geometry: A4L, scale: 78, maxScale: 82 });
    const d = deriveFitDisplay({ fitOnePage: true, fitResult: fresh, currentGeometry: A4L });
    expect(d.status).toBe("success");
    if (d.status === "success") {
      expect(d.result.scale).toBe(78);
      expect(d.result.maxScale).toBe(82);
    }
  });

  it("returns impossible when the fresh result flags no fit", () => {
    const fresh = completed({ geometry: A4P_TIGHT, impossible: true, scale: 50, maxScale: null });
    const d = deriveFitDisplay({ fitOnePage: true, fitResult: fresh, currentGeometry: A4P_TIGHT });
    expect(d.status).toBe("impossible");
    if (d.status === "impossible") {
      expect(d.result.scale).toBe(50);
      expect(d.result.maxScale).toBeNull();
    }
  });
});
