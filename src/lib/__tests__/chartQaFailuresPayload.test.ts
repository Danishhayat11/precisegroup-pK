import { describe, it, expect, vi } from "vitest";
import { buildFailuresPayload, type BuildFailuresPayloadInput } from "../chartQaFailuresPayload";

const baseInput = (
  overrides: Partial<BuildFailuresPayloadInput> = {},
): BuildFailuresPayloadInput => ({
  generatedAt: "2026-07-04T00:00:00.000Z",
  viewport: "1280px",
  enabledChartTypes: ["bar", "line"],
  appTheme: "light",
  includeEnvBlock: false,
  collectEnvironment: () => ({
    userAgent: "vitest",
    devicePixelRatio: 1,
    buildMode: "test",
    libraryVersions: { recharts: "test" },
  }),
  expectedSeriesOrder: ["Revenue", "Cost"],
  fullSweep: { steps: [] },
  failures: [],
  ...overrides,
});

describe("buildFailuresPayload — environment omission", () => {
  it("hard-omits `environment` when includeEnvBlock=false", () => {
    const payload = buildFailuresPayload(baseInput({ includeEnvBlock: false }));

    // The key must not exist at all — not null, not undefined.
    expect("environment" in payload).toBe(false);
    expect(Object.keys(payload)).not.toContain("environment");
    expect(Object.prototype.hasOwnProperty.call(payload, "environment")).toBe(false);
    expect(payload.environmentIncluded).toBe(false);

    // Round-trip through JSON to catch serialization leaks.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/"environment"\s*:/);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect("environment" in parsed).toBe(false);
  });

  it("does NOT invoke the environment collector when includeEnvBlock=false", () => {
    const collectEnvironment = vi.fn(() => ({ userAgent: "should-not-run" }));
    buildFailuresPayload(baseInput({ includeEnvBlock: false, collectEnvironment }));
    expect(collectEnvironment).not.toHaveBeenCalled();
  });

  it("includes `environment` when includeEnvBlock=true", () => {
    const payload = buildFailuresPayload(baseInput({ includeEnvBlock: true }));
    expect("environment" in payload).toBe(true);
    expect(payload.environmentIncluded).toBe(true);
    expect(payload.environment).toMatchObject({ userAgent: "vitest" });
  });

  it("ignores injected null/undefined environment overrides when disabled", () => {
    // Simulate a hostile collector that returns junk; when disabled it must
    // never be called at all, and the key must still be absent.
    const collectEnvironment = vi.fn(
      () => null as unknown as ReturnType<BuildFailuresPayloadInput["collectEnvironment"]>,
    );
    const payload = buildFailuresPayload(baseInput({ includeEnvBlock: false, collectEnvironment }));
    expect("environment" in payload).toBe(false);
    expect(collectEnvironment).not.toHaveBeenCalled();
  });

  it("second call with includeEnvBlock=false after a call with true still omits the key", () => {
    // Guards against any accidental shared mutable state in the builder.
    const first = buildFailuresPayload(baseInput({ includeEnvBlock: true }));
    const second = buildFailuresPayload(baseInput({ includeEnvBlock: false }));
    expect("environment" in first).toBe(true);
    expect("environment" in second).toBe(false);
  });
});
