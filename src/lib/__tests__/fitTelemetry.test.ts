import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordFitRun,
  getFitTelemetry,
  clearFitTelemetry,
  dumpFitTelemetry,
  buildLatestFitTrailReport,
  downloadLatestFitTrail,
} from "../fitTelemetry";
import type { FitLogEntry } from "../fitToOnePage";

const entry = (over: Partial<FitLogEntry> = {}): FitLogEntry => ({
  iteration: 0,
  currentScale: 100,
  pageCount: 2,
  lo: 49,
  hi: "inf",
  fittingScales: [],
  unstable: false,
  decision: "next",
  nextScale: 80,
  reason: "ratio-jump",
  ...over,
});

describe("fitTelemetry", () => {
  beforeEach(() => clearFitTelemetry());

  it("captures convergence reason and clamp signal from log entries", () => {
    const rec = recordFitRun({
      source: "preview",
      finalScale: 82,
      steps: 4,
      impossible: false,
      unstable: false,
      log: [
        entry({ iteration: 0, reason: "ratio-jump" }),
        entry({ iteration: 1, reason: "bisect-down+clamped", nextScale: 50 }),
        entry({ iteration: 2, decision: "done", reason: "converged", nextScale: 82 }),
      ],
      context: { paper: "A4", orientation: "portrait" },
    });

    expect(rec.convergence).toBe("converged");
    expect(rec.clamped).toBe(true);
    expect(rec.clampReasons).toEqual(["bisect-down+clamped"]);
    expect(rec.context).toMatchObject({ paper: "A4" });
    expect(getFitTelemetry()).toHaveLength(1);
  });

  it("caps the ring buffer at 50 records", () => {
    for (let i = 0; i < 55; i++) {
      recordFitRun({
        source: "tester",
        finalScale: 100,
        steps: 1,
        impossible: false,
        unstable: false,
        log: [entry({ iteration: i })],
      });
    }
    const all = getFitTelemetry();
    expect(all).toHaveLength(50);
    // Oldest kept entry should be iteration 5 (0..4 evicted).
    expect(all[0].head?.iteration).toBe(5);
  });

  it("marks impossible runs and surfaces them in the dump", () => {
    recordFitRun({
      source: "tester",
      finalScale: 50,
      steps: 12,
      impossible: true,
      unstable: false,
      log: [entry({ decision: "done", reason: "iteration-cap", nextScale: 50 })],
    });
    const dump = dumpFitTelemetry();
    expect(dump).toContain("iteration-cap");
    expect(dump).toContain('"impossible": true');
  });

  describe("buildLatestFitTrailReport", () => {
    it("returns null when no run has been recorded", () => {
      expect(buildLatestFitTrailReport()).toBeNull();
    });

    it("packages the latest run with full log and stable filename", () => {
      recordFitRun({
        source: "preview",
        finalScale: 90,
        steps: 3,
        impossible: false,
        unstable: false,
        log: [
          entry({ iteration: 0, reason: "grow" }),
          entry({ iteration: 1, reason: "bisect-down" }),
          entry({ iteration: 2, decision: "done", reason: "converged", nextScale: 90 }),
        ],
        context: { paper: "A4", orientation: "portrait" },
      });

      const report = buildLatestFitTrailReport();
      expect(report).not.toBeNull();
      expect(report!.payload.kind).toBe("lovable.fit-trail");
      expect(report!.payload.version).toBe(1);
      expect(report!.payload.log).toHaveLength(3);
      expect(report!.payload.record.finalScale).toBe(90);
      expect(report!.filename).toMatch(/^fit-trail-preview-.+\.json$/);
      // JSON string must parse and echo the payload structure.
      const parsed = JSON.parse(report!.json);
      expect(parsed.record.convergence).toBe("converged");
      expect(parsed.log[0].reason).toBe("grow");
    });

    it("clearFitTelemetry drops the latest full trail", () => {
      recordFitRun({
        source: "tester",
        finalScale: 100,
        steps: 1,
        impossible: false,
        unstable: false,
        log: [entry()],
      });
      expect(buildLatestFitTrailReport()).not.toBeNull();
      clearFitTelemetry();
      expect(buildLatestFitTrailReport()).toBeNull();
    });
  });

  describe("downloadLatestFitTrail", () => {
    it("returns false when there is nothing to export", () => {
      expect(downloadLatestFitTrail()).toBe(false);
    });

    it("creates an object URL and triggers a download click", () => {
      recordFitRun({
        source: "preview",
        finalScale: 88,
        steps: 2,
        impossible: false,
        unstable: false,
        log: [entry({ decision: "done", reason: "converged", nextScale: 88 })],
      });

      const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
      const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      const ok = downloadLatestFitTrail();
      expect(ok).toBe(true);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);

      createSpy.mockRestore();
      revokeSpy.mockRestore();
      clickSpy.mockRestore();
    });
  });
});
