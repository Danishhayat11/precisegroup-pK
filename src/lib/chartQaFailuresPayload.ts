// Pure builder for the "chart-qa-failures.json" sidecar and the failure JSON
// block embedded in the QA PDF. Extracted so it can be unit-tested independent
// of jsPDF, the DOM, and the chart-preview route.
//
// Contract: when `includeEnvBlock` is false, the returned object MUST NOT
// contain an `environment` key at all — not `null`, not `undefined`, not an
// empty object. Callers rely on `"environment" in payload === false`.

export interface ChartQaEnvironment {
  userAgent?: string;
  devicePixelRatio?: number;
  viewport?: { width: number; height: number };
  buildMode?: string;
  libraryVersions?: Record<string, string>;
  [key: string]: unknown;
}

export interface BuildFailuresPayloadInput {
  generatedAt: string;
  viewport: string;
  enabledChartTypes: string[];
  appTheme: "dark" | "light";
  includeEnvBlock: boolean;
  /** Called only when includeEnvBlock is true. */
  collectEnvironment: () => ChartQaEnvironment;
  expectedSeriesOrder: string[];
  fullSweep: unknown;
  failures: unknown;
}

export interface FailuresPayload {
  generatedAt: string;
  viewport: string;
  enabledChartTypes: string[];
  appTheme: "dark" | "light";
  environmentIncluded: boolean;
  expectedSeriesOrder: string[];
  fullSweep: unknown;
  failures: unknown;
  environment?: ChartQaEnvironment;
}

export function buildFailuresPayload(input: BuildFailuresPayloadInput): FailuresPayload {
  const payload: FailuresPayload = {
    generatedAt: input.generatedAt,
    viewport: input.viewport,
    enabledChartTypes: input.enabledChartTypes,
    appTheme: input.appTheme,
    environmentIncluded: input.includeEnvBlock,
    expectedSeriesOrder: input.expectedSeriesOrder,
    fullSweep: input.fullSweep,
    failures: input.failures,
  };
  if (input.includeEnvBlock) {
    payload.environment = input.collectEnvironment();
  } else {
    // Hard guard: never allow environment to leak in as null/undefined either.
    delete (payload as { environment?: unknown }).environment;
  }
  return payload;
}
