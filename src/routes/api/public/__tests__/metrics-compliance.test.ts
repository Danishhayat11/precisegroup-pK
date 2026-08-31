import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase
vi.mock("@/integrations/supabase/client.server", () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
  });
  return {
    supabaseAdmin: {
      from: mockFrom,
    },
  };
});

// Mock TanStack Router
let registeredHandler: any = null;
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: any) => {
    registeredHandler = config?.server?.handlers?.GET;
    return { path, config };
  },
}));

/**
 * Validates that a string strictly follows the Prometheus text exposition format (v0.0.4).
 */
export function validatePrometheusFormat(text: string) {
  if (!text.endsWith("\n")) {
    return { valid: false, error: "Output must end with a trailing newline" };
  }

  const lines = text.split("\n").slice(0, -1);
  const metrics = new Map<string, { hasHelp: boolean; hasType: boolean; hasValue: boolean }>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    if (line.startsWith("# HELP ")) {
      const parts = line.split(" ");
      if (parts.length < 4)
        return { valid: false, error: `Invalid HELP line at ${i + 1}: ${line}` };
      const name = parts[2];
      const entry = metrics.get(name) || { hasHelp: false, hasType: false, hasValue: false };
      entry.hasHelp = true;
      metrics.set(name, entry);
    } else if (line.startsWith("# TYPE ")) {
      const parts = line.split(" ");
      if (parts.length !== 4)
        return { valid: false, error: `Invalid TYPE line at ${i + 1}: ${line}` };
      const name = parts[2];
      const type = parts[3];
      if (!["gauge", "counter", "summary", "histogram", "untyped"].includes(type)) {
        return { valid: false, error: `Invalid metric type "${type}" at ${i + 1}` };
      }
      const entry = metrics.get(name) || { hasHelp: false, hasType: false, hasValue: false };
      entry.hasType = true;
      metrics.set(name, entry);
    } else if (line.startsWith("#")) {
      continue;
    } else {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2)
        return { valid: false, error: `Invalid metric line at ${i + 1}: ${line}` };
      const fullMetric = parts[0];
      const value = parts[1];
      const baseName = fullMetric.split("{")[0];
      if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(baseName)) {
        return { valid: false, error: `Invalid metric name "${baseName}" at ${i + 1}` };
      }
      if (isNaN(Number(value))) {
        return { valid: false, error: `Invalid numeric value "${value}" at ${i + 1}` };
      }
      const entry = metrics.get(baseName) || { hasHelp: false, hasType: false, hasValue: false };
      entry.hasValue = true;
      metrics.set(baseName, entry);
    }
  }

  for (const [name, status] of metrics.entries()) {
    if (status.hasValue && !status.hasType) {
      return { valid: false, error: `Metric "${name}" is missing # TYPE definition` };
    }
  }
  return { valid: true };
}

describe("Prometheus Format Compliance", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    await import("../metrics");
  });

  it("validates success response format", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
    });

    const response = await registeredHandler({ request: new Request("http://localhost") });
    const text = await response.text();

    const result = validatePrometheusFormat(text);
    expect(result.valid, result.error).toBe(true);
    expect(response.headers.get("Content-Type")).toBe("text/plain; version=0.0.4");
  });

  it("validates failure response format", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, count: null, error: { message: "Fail" } }),
    });

    const response = await registeredHandler({ request: new Request("http://localhost") });
    const text = await response.text();

    const result = validatePrometheusFormat(text);
    expect(result.valid, result.error).toBe(true);
    expect(response.status).toBe(500);
    expect(text).toContain("health_check_status 0");
  });
});
