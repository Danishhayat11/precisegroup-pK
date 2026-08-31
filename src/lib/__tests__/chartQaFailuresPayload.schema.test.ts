import { describe, it, expect } from "vitest";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { buildFailuresPayload } from "../chartQaFailuresPayload";

const schema = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../docs/schemas/chart-qa-failures.schema.json"),
    "utf8",
  ),
);

const ajv = new Ajv({ allErrors: true, strict: false });
// ajv-formats bundles a nested Ajv copy in its own node_modules that
// exposes a structurally-identical but nominally-distinct Ajv class.
// The cast bridges the two type identities so this test compiles under
// both hoisted and nested-install layouts.
addFormats(ajv as unknown as Parameters<typeof addFormats>[0]);
const validate = ajv.compile(schema);

const commonInput = {
  generatedAt: "2026-07-04T00:00:00.000Z",
  viewport: "1280px",
  enabledChartTypes: ["bar", "line"],
  appTheme: "light" as const,
  collectEnvironment: () => ({
    userAgent: "vitest",
    devicePixelRatio: 1,
    viewport: { width: 1280, height: 1800 },
    buildMode: "test",
    libraryVersions: { recharts: "test" },
  }),
  expectedSeriesOrder: ["Revenue", "Cost"],
  fullSweep: { steps: [] },
  failures: [],
};

describe("chart-qa-failures.schema.json", () => {
  it("accepts a builder payload with environment omitted", () => {
    const doc = buildFailuresPayload({ ...commonInput, includeEnvBlock: false });
    const ok = validate(doc);
    expect(validate.errors).toBeNull();
    expect(ok).toBe(true);
  });

  it("accepts a builder payload with environment included", () => {
    const doc = buildFailuresPayload({ ...commonInput, includeEnvBlock: true });
    const ok = validate(doc);
    expect(validate.errors).toBeNull();
    expect(ok).toBe(true);
  });

  it("rejects a payload that leaks environment when environmentIncluded=false", () => {
    const bad = {
      ...buildFailuresPayload({ ...commonInput, includeEnvBlock: false }),
      environment: {}, // simulated regression
    };
    expect(validate(bad)).toBe(false);
  });

  it("rejects a payload missing environment when environmentIncluded=true", () => {
    const doc = buildFailuresPayload({
      ...commonInput,
      includeEnvBlock: true,
    }) as unknown as Record<string, unknown>;
    delete doc.environment;
    expect(validate(doc)).toBe(false);
  });
});
