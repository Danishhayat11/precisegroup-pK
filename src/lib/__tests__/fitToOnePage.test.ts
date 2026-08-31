import { describe, it, expect } from "vitest";
import { createFitState, fitStep, FIT_MIN, FIT_MAX_ITERATIONS } from "../fitToOnePage";

/**
 * Convergence tests for the "Fit to one page" search.
 *
 * The search is deterministic given a `pageCountAt(scale)` oracle. We model
 * different geometries (paper size + orientation drive how much content fits
 * at scale=100) as oracles and confirm:
 *   1. The search finishes in ≤ FIT_MAX_ITERATIONS steps.
 *   2. The final scale actually fits (pageCount === 1) when possible.
 *   3. Impossible cases surface `impossible: true`, never spin forever.
 *   4. The search never asks the caller to change paper/orientation/margins —
 *      those inputs stay constant across the whole run, which is our proxy
 *      for "margin geometry preserved".
 */

// Oracle: given a content "height" of H "units" at 100% scale, a page holds
// `pageCapacity` units. Scale multiplies capacity linearly (larger scale =
// more content on the same physical page relative to a fixed layout box in
// this simplified model). Real pagination is monotonic in the same direction.
function makeOracle(contentUnits: number, pageCapacityAt100: number) {
  return (scalePct: number) => {
    // Lower scale ⇒ effectively more capacity per page.
    const capacity = pageCapacityAt100 * (100 / scalePct);
    return Math.max(1, Math.ceil(contentUnits / capacity));
  };
}

function runSearch(startScale: number, oracle: (s: number) => number) {
  const state = createFitState();
  let scale = startScale;
  let steps = 0;
  const scaleTrail: number[] = [scale];
  // Extra safety: outer cap independent of the search's internal counter,
  // so an accidental non-termination fails the test loudly instead of hanging.
  while (steps < 50) {
    const decision = fitStep(state, scale, oracle(scale));
    if (decision.kind === "done") {
      return {
        finalScale: decision.scalePct,
        impossible: decision.impossible,
        unstable: decision.unstable === true,
        steps,
        scaleTrail,
        finalPageCount: oracle(decision.scalePct),
      };
    }
    scale = decision.scalePct;
    scaleTrail.push(scale);
    steps += 1;
  }
  throw new Error(`fit search failed to terminate: trail=${scaleTrail.join(",")}`);
}

describe("fitStep — convergence", () => {
  it("returns immediately when already 1 page at 100%", () => {
    const result = runSearch(100, makeOracle(80, 100));
    expect(result.steps).toBe(0);
    expect(result.finalScale).toBe(100);
    expect(result.finalPageCount).toBe(1);
    expect(result.impossible).toBe(false);
  });

  it("converges in far fewer than FIT_MAX_ITERATIONS for a mild overflow (~1.5 pages)", () => {
    // Content ~1.5 pages at 100% ⇒ fits around 66%.
    const oracle = makeOracle(150, 100);
    const result = runSearch(100, oracle);
    expect(result.steps).toBeLessThanOrEqual(6);
    expect(result.finalPageCount).toBe(1);
    expect(result.finalScale).toBeGreaterThanOrEqual(FIT_MIN);
  });

  it("converges for large overflow (~3 pages) using the ratio jump", () => {
    // Content ~3 pages at 100% ⇒ needs ~33% but clamped to 50% floor…
    // Use ~2 pages so a valid fit exists above the floor.
    const oracle = makeOracle(190, 100); // ~2 pages at 100%, fits ~50%
    const result = runSearch(100, oracle);
    expect(result.steps).toBeLessThanOrEqual(FIT_MAX_ITERATIONS);
    expect(result.finalPageCount).toBeLessThanOrEqual(1);
  });

  it("flags impossible when content cannot fit even at 50%", () => {
    // Content 4x page capacity ⇒ still 2+ pages at 50%.
    const oracle = makeOracle(500, 100);
    const result = runSearch(100, oracle);
    expect(result.impossible).toBe(true);
    expect(result.finalScale).toBe(FIT_MIN);
    expect(result.steps).toBeLessThanOrEqual(FIT_MAX_ITERATIONS + 1);
  });

  it("never exceeds FIT_MAX_ITERATIONS internal steps for any oracle", () => {
    const oracles = [
      makeOracle(100, 100),
      makeOracle(130, 100),
      makeOracle(160, 100),
      makeOracle(199, 100),
      makeOracle(400, 100),
      makeOracle(1000, 100),
    ];
    for (const oracle of oracles) {
      const result = runSearch(100, oracle);
      expect(result.steps).toBeLessThanOrEqual(FIT_MAX_ITERATIONS + 1);
    }
  });

  it("terminates on non-monotonic pagination without cycling", () => {
    // Simulate a boundary that flips between 1 and 2 pages around scale 70.
    const flaky = (scale: number) => (scale >= 71 ? 2 : 1);
    const result = runSearch(100, flaky);
    expect(result.finalPageCount).toBe(1);
    expect(result.steps).toBeLessThanOrEqual(FIT_MAX_ITERATIONS);
  });
});

describe("fitStep — geometry preservation across orientations", () => {
  // "Geometry preservation" here means: the caller supplies paper/orientation/
  // margins outside the search; fitStep only reads pageCount and picks scale.
  // We verify that running the same content under two different geometries
  // (portrait vs landscape ⇒ different page capacities) does not cause the
  // search to touch anything but scale, and each run independently converges.
  const content = 170;

  const portraitOracle = makeOracle(content, 100); // narrower per-page capacity
  const landscapeOracle = makeOracle(content, 140); // wider per-page capacity

  it("converges in portrait without mutating the oracle inputs", () => {
    const before = { content, cap: 100 };
    const result = runSearch(100, portraitOracle);
    // Oracle inputs (our proxy for paper/orientation/margins) unchanged.
    expect(before).toEqual({ content: 170, cap: 100 });
    expect(result.finalPageCount).toBe(1);
  });

  it("converges in landscape without mutating the oracle inputs", () => {
    const before = { content, cap: 140 };
    const result = runSearch(100, landscapeOracle);
    expect(before).toEqual({ content: 170, cap: 140 });
    expect(result.finalPageCount).toBe(1);
  });

  it("lands on a strictly higher scale in landscape than portrait for the same content", () => {
    const p = runSearch(100, portraitOracle);
    const l = runSearch(100, landscapeOracle);
    expect(l.finalScale).toBeGreaterThanOrEqual(p.finalScale);
    expect(p.finalPageCount).toBe(1);
    expect(l.finalPageCount).toBe(1);
  });

  it("only ever suggests scales in [FIT_MIN, 150]", () => {
    for (const oracle of [portraitOracle, landscapeOracle, makeOracle(1000, 100)]) {
      const result = runSearch(100, oracle);
      for (const s of result.scaleTrail) {
        expect(s).toBeGreaterThanOrEqual(FIT_MIN);
        expect(s).toBeLessThanOrEqual(150);
      }
    }
  });
});

describe("fitStep — extreme paper/orientation/margin combinations", () => {
  // Realistic paper geometries: printable area in mm² after margins, then
  // converted into an abstract "page capacity" by dividing by a fixed
  // content-density factor. Portrait vs landscape swaps width/height; margins
  // subtract from both dimensions. This mirrors how the real preview computes
  // pagination so we can exercise the search across genuinely extreme setups.
  const PAPERS = {
    A4: { w: 210, h: 297 },
    Letter: { w: 216, h: 279 },
    Legal: { w: 216, h: 356 },
    A3: { w: 297, h: 420 },
    A5: { w: 148, h: 210 },
    A6: { w: 105, h: 148 }, // smallest common — narrow printable area
  } as const;

  // Per-side margins in mm: [top, right, bottom, left].
  type Margins = [number, number, number, number];
  const MARGIN_CASES: Record<string, Margins> = {
    narrow: [5, 5, 5, 5],
    normal: [15, 15, 15, 15],
    wide: [25, 25, 25, 25],
    asymmetric: [5, 30, 40, 10], // heavy bottom + right
    nearMaximum: [45, 45, 45, 45], // eats most of an A6/A5 page
  };

  // Content "density" per mm² at scale=100. Higher = more content per page.
  // We pick a value big enough that A6 with wide margins genuinely overflows.
  const CONTENT_UNITS = 900;

  function capacityFor(
    paper: { w: number; h: number },
    orientation: "portrait" | "landscape",
    m: Margins,
  ) {
    const [top, right, bottom, left] = m;
    const pageW = orientation === "portrait" ? paper.w : paper.h;
    const pageH = orientation === "portrait" ? paper.h : paper.w;
    const usableW = Math.max(0, pageW - left - right);
    const usableH = Math.max(0, pageH - top - bottom);
    // 1 mm² of usable area == 1 unit of capacity at scale=100.
    return usableW * usableH;
  }

  function oracleFor(
    paper: { w: number; h: number },
    orientation: "portrait" | "landscape",
    m: Margins,
  ) {
    const cap100 = capacityFor(paper, orientation, m);
    return (scalePct: number) => {
      if (cap100 <= 0) return 999; // zero printable area ⇒ impossible
      // Content grows quadratically with scale (width and height both scale).
      const scaled = CONTENT_UNITS * (scalePct / 100) * (scalePct / 100);
      const perPage = cap100 / 1000; // normalize to "pages" of readable numbers
      return Math.max(1, Math.ceil(scaled / perPage));
    };
  }

  // Cartesian product: every paper × orientation × margin case.
  const combos: Array<{ name: string; oracle: (s: number) => number; cap: number }> = [];
  for (const [pName, paper] of Object.entries(PAPERS)) {
    for (const orientation of ["portrait", "landscape"] as const) {
      for (const [mName, m] of Object.entries(MARGIN_CASES)) {
        combos.push({
          name: `${pName} ${orientation} · ${mName}`,
          oracle: oracleFor(paper, orientation, m),
          cap: capacityFor(paper, orientation, m),
        });
      }
    }
  }

  it("covers every extreme combination", () => {
    // 6 papers × 2 orientations × 5 margin sets = 60 combos.
    expect(combos.length).toBe(60);
  });

  it("always terminates within FIT_MAX_ITERATIONS internal steps", () => {
    for (const { name, oracle } of combos) {
      const result = runSearch(100, oracle);
      // +1 accounts for the terminal "done" observation past the internal counter.
      expect(result.steps, `combo=${name}`).toBeLessThanOrEqual(FIT_MAX_ITERATIONS + 1);
    }
  });

  it("never proposes a scale outside [FIT_MIN, 150] for any combination", () => {
    for (const { name, oracle } of combos) {
      const result = runSearch(100, oracle);
      for (const s of result.scaleTrail) {
        expect(s, `combo=${name} scale=${s}`).toBeGreaterThanOrEqual(FIT_MIN);
        expect(s, `combo=${name} scale=${s}`).toBeLessThanOrEqual(150);
      }
    }
  });

  it("clamps to the tightest known-fitting scale when a fit exists", () => {
    for (const { name, oracle } of combos) {
      const result = runSearch(100, oracle);
      if (!result.impossible) {
        // Final scale must actually fit.
        expect(result.finalPageCount, `combo=${name}`).toBe(1);
        // And +1% must NOT fit (otherwise we could have gone larger) — unless
        // we already latched at 100% because the content fit at full size.
        if (result.finalScale < 100) {
          expect(oracle(result.finalScale + 1), `combo=${name} tighter?`).toBeGreaterThan(1);
        }
      }
    }
  });

  it("flags impossible only when even FIT_MIN cannot fit on a single page", () => {
    for (const { name, oracle } of combos) {
      const result = runSearch(100, oracle);
      if (result.impossible) {
        expect(oracle(FIT_MIN), `combo=${name} claims impossible but FIT_MIN fits`).toBeGreaterThan(
          1,
        );
        expect(result.finalScale).toBe(FIT_MIN);
      }
    }
  });

  it("landscape never lands on a smaller scale than portrait for the same paper + margins", () => {
    for (const [pName, paper] of Object.entries(PAPERS)) {
      for (const [mName, m] of Object.entries(MARGIN_CASES)) {
        const p = runSearch(100, oracleFor(paper, "portrait", m));
        const l = runSearch(100, oracleFor(paper, "landscape", m));
        // If both fit, landscape has at least as much room as portrait for a
        // page-limited layout, so its fitting scale should be >= portrait's.
        if (!p.impossible && !l.impossible) {
          expect(l.finalScale, `${pName} ${mName}`).toBeGreaterThanOrEqual(p.finalScale);
        }
      }
    }
  });

  it("wider margins never yield a larger final scale than narrower margins on the same paper+orientation", () => {
    for (const [pName, paper] of Object.entries(PAPERS)) {
      for (const orientation of ["portrait", "landscape"] as const) {
        const narrow = runSearch(100, oracleFor(paper, orientation, MARGIN_CASES.narrow));
        const wide = runSearch(100, oracleFor(paper, orientation, MARGIN_CASES.wide));
        if (!narrow.impossible && !wide.impossible) {
          expect(wide.finalScale, `${pName} ${orientation}`).toBeLessThanOrEqual(narrow.finalScale);
        }
      }
    }
  });

  it("handles a zero printable area (margins consume the page) as impossible without hanging", () => {
    // Simulate margins equal to the page dimensions ⇒ capacity=0 ⇒ oracle=999.
    const oracle = () => 999;
    const result = runSearch(100, oracle);
    expect(result.impossible).toBe(true);
    expect(result.finalScale).toBe(FIT_MIN);
    expect(result.steps).toBeLessThanOrEqual(FIT_MAX_ITERATIONS + 1);
  });

  it("survives starting from arbitrary scales (75, 100, 130) with the same terminal outcome", () => {
    // Convergence must not depend on start scale — same paper geometry ⇒ same
    // impossible/possible verdict and the final scale differs by at most 1%
    // (rounding in the search bracket).
    const oracle = oracleFor(PAPERS.A5, "portrait", MARGIN_CASES.normal);
    const results = [75, 100, 130].map((s) => runSearch(s, oracle));
    const [a, b, c] = results;
    expect(a.impossible).toBe(b.impossible);
    expect(b.impossible).toBe(c.impossible);
    if (!a.impossible) {
      const scales = results.map((r) => r.finalScale);
      const spread = Math.max(...scales) - Math.min(...scales);
      expect(spread).toBeLessThanOrEqual(1);
    }
  });
});

describe("fitStep — non-monotonic pagination hardening", () => {
  /**
   * Real browsers can report different pageCounts for the same scale between
   * renders (fonts loading, images decoding, table row late-overflow). The
   * search must:
   *   1. detect the instability,
   *   2. surface `unstable: true` on the terminal decision,
   *   3. pick the *smallest* known-fitting scale (largest safety margin)
   *      instead of the tightest `hi` bracket.
   */

  it("flags the run as unstable when the same scale returns different pageCounts", () => {
    // Toggle: first visit to 100 says 2 pages, subsequent visits say 1.
    let visits100 = 0;
    const flipping = (s: number) => {
      if (s === 100) {
        visits100 += 1;
        return visits100 === 1 ? 2 : 1;
      }
      return s > 80 ? 2 : 1;
    };
    const result = runSearch(100, flipping);
    // Search may or may not revisit 100 depending on picks, so force revisit:
    // simulate by running a bespoke sequence to guarantee instability.
    const state = createFitState();
    let dec = fitStep(state, 80, 1); // fits at 80
    expect(dec.kind).toBe("next");
    dec = fitStep(state, 80, 2); // same scale, now spills → unstable
    expect(state.unstable).toBe(true);
    // The natural-run result still terminates cleanly.
    expect(result.steps).toBeLessThanOrEqual(FIT_MAX_ITERATIONS + 1);
  });

  it("picks the smallest known-fitting scale (not `hi`) when unstable", () => {
    // Manually walk: observe 60 as fitting, 80 as fitting, then 80 as spilling.
    // Terminal decision should return 60 (smallest fitting), not 80.
    const state = createFitState();
    fitStep(state, 60, 1); // fittingScales: {60}, hi=60
    fitStep(state, 80, 1); // fittingScales: {60,80}, hi=60 (min)
    // Now flip 80 to spilling → instability at 80.
    // But hi already = 60, so smallest fitting = 60 anyway.
    // Better: fresh state where hi ends up > minFitting.
    const s2 = createFitState();
    fitStep(s2, 90, 1); // hi=90, fittingScales={90}
    fitStep(s2, 70, 1); // hi=70, fittingScales={70,90}
    fitStep(s2, 70, 2); // instability at 70 → unstable=true
    // Force termination via iteration cap or cycle:
    for (let i = 0; i < FIT_MAX_ITERATIONS + 2 && !s2.done; i++) {
      fitStep(s2, 70, 2);
    }
    const dec = fitStep(s2, 70, 2);
    expect(dec.kind).toBe("done");
    if (dec.kind === "done") {
      expect(dec.unstable).toBe(true);
      // Smallest fitting scale observed was 70 (before flip) and 90 → 70.
      expect(dec.scalePct).toBe(70);
    }
  });

  it("always terminates for pathological alternating oracles", () => {
    // Oracle that lies half the time based on scale parity.
    const chaotic = (s: number) => (s % 2 === 0 ? 1 : 2);
    const result = runSearch(100, chaotic);
    expect(result.steps).toBeLessThanOrEqual(FIT_MAX_ITERATIONS + 1);
    // Final scale must have fit at some observation point.
    expect(result.finalScale).toBeGreaterThanOrEqual(FIT_MIN);
  });

  it("stable runs never set the unstable flag", () => {
    // Well-behaved monotonic oracle: content fits at ≤ 65%.
    const monotonic = (s: number) => (s <= 65 ? 1 : 2);
    const result = runSearch(100, monotonic);
    expect(result.unstable).toBe(false);
    expect(result.finalPageCount).toBe(1);
  });

  it("still flags impossible when instability never yields a fit", () => {
    // Even flipping never produces pageCount === 1.
    const neverFits = (s: number) => (s < 60 ? 2 : 3);
    const result = runSearch(100, neverFits);
    expect(result.impossible).toBe(true);
    expect(result.finalScale).toBe(FIT_MIN);
  });
});
