import { describe, it, expect, vi, beforeEach } from "vitest";

// We mock the Supabase client and file-system imports
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

// We need to mock the handler registration
let registeredHandler: any = null;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: any) => {
    registeredHandler = config?.server?.handlers?.GET;
    return { path, config };
  },
}));

describe("Metrics API Handler", () => {
  let mockSupabase: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Re-import to ensure we get a fresh handler registration
    await import("../metrics");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    mockSupabase = supabaseAdmin;
  });

  const getHandler = () => registeredHandler;

  it("returns 200 and valid Prometheus metrics on success", async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        data: [{ section_key: "hero" }, { section_key: "leadership" }],
        error: null,
        count: 2,
      }),
    });

    const handler = getHandler();
    expect(handler).toBeDefined();

    const request = new Request("http://localhost/api/public/metrics");
    const response = await handler({ request });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(response.headers.get("Content-Type")).toContain("version=0.0.4");
    expect(response.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );

    // Verify Prometheus format requirements
    const lines = text.split("\n").filter((line: string) => line.trim() !== "");

    // Strict Header Checks
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(response.headers.get("Content-Type")).toContain("version=0.0.4");
    expect(response.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );

    // Every HELP line must have a corresponding TYPE line and metric value
    expect(text).toMatch(/^# HELP health_check_status/m);
    expect(text).toMatch(/^# TYPE health_check_status gauge/m);
    expect(text).toMatch(/^health_check_status 1$/m);

    expect(text).toMatch(/^# HELP health_check_row_count/m);
    expect(text).toMatch(/^# TYPE health_check_row_count gauge/m);
    expect(text).toMatch(/^health_check_row_count 2$/m);

    // Verify valid metric naming (letters, numbers, underscores)
    lines.forEach((line: string) => {
      if (!line.startsWith("#")) {
        const parts = line.split(" ");
        const metricName = parts[0];
        expect(metricName).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
        const value = parts[1];
        expect(Number(value)).not.toBeNaN();
      }
    });

    // Verify trailing newline as per spec
    expect(text.endsWith("\n")).toBe(true);
  });

  it("returns 500 and status 0 on database error", async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        data: null,
        error: { message: "Database error", code: "PGRST100" },
        count: null,
      }),
    });

    const handler = getHandler();
    const request = new Request("http://localhost/api/public/metrics");
    const response = await handler({ request });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("text/plain; version=0.0.4");
    expect(response.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    expect(text).toContain("health_check_status 0");

    // Ensure it doesn't leak row counts on error
    expect(text).not.toContain("health_check_row_count");
  });

  it("returns 500 and status 0 on unexpected exception", async () => {
    mockSupabase.from.mockImplementation(() => {
      throw new Error("Crash");
    });

    const handler = getHandler();
    const request = new Request("http://localhost/api/public/metrics");
    const response = await handler({ request });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("text/plain; version=0.0.4");
    expect(response.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    expect(text).toContain("health_check_status 0");
  });
});
