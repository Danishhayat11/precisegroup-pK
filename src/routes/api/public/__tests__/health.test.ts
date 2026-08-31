import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/healthAlert.server", () => ({
  sendHealthAlert: vi.fn().mockResolvedValue(undefined),
}));

// We mock the Supabase client and file-system imports that would fail in a unit test environment
vi.mock("@/integrations/supabase/client.server", () => {
  const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockSelect = vi.fn().mockReturnValue({
    data: [{ section_key: "test", is_enabled: true }],
    error: null,
    count: 1,
  });

  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    limit: vi.fn().mockReturnThis(),
  });

  return {
    supabaseAdmin: {
      rpc: vi.fn().mockResolvedValue({ error: null }),
      from: mockFrom,
    },
  };
});

// We need to mock the handler registration because TanStack Start's Route object is complex
let registeredHandler: any = null;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: any) => {
    registeredHandler = config?.server?.handlers?.GET;
    return { path, config };
  },
}));

describe("Health Check API Handler", () => {
  let mockSupabase: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Re-import to ensure we get a fresh handler registration
    await import("../health");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    mockSupabase = supabaseAdmin;
  });

  const getHandler = () => registeredHandler;

  it("returns 200 and metrics on successful read", async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        data: [{ section_key: "test", is_enabled: true }],
        error: null,
        count: 1,
      }),
      insert: vi.fn(),
    });

    const handler = getHandler();
    expect(handler).toBeDefined();

    const request = new Request("http://localhost/api/public/health");
    const response = await handler({ request });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.traceId).toBeDefined();
    expect(body.metrics.row_count).toBe(1);
  });

  it("triggers schema refresh when requested with valid API key", async () => {
    process.env.CRON_SECRET = "test-secret";
    mockSupabase.rpc.mockResolvedValue({ error: null });
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({ data: [], error: null, count: 0 }),
      insert: vi.fn(),
    });

    const handler = getHandler();
    const request = new Request("http://localhost/api/public/health?refresh=true", {
      headers: { "x-api-key": "test-secret" },
    });

    const response = await handler({ request });
    const body = await response.json();

    expect(mockSupabase.rpc).toHaveBeenCalledWith("reload_schema_cache");
    expect(body.refreshed).toBe(true);
  });

  it("verifies non-empty row_count on successful table_read with refresh", async () => {
    process.env.CRON_SECRET = "test-secret";
    mockSupabase.rpc.mockResolvedValue({ error: null });
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        data: [{ section_key: "hero", is_enabled: true }],
        error: null,
        count: 1,
      }),
      insert: vi.fn(),
    });

    const handler = getHandler();
    const request = new Request("http://localhost/api/public/health?refresh=true", {
      headers: { "x-api-key": "test-secret" },
    });

    const response = await handler({ request });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.read_success).toBe(true);
    expect(body.metrics.row_count).toBeGreaterThan(0);
    expect(body.data_sample).toHaveLength(1);
  });

  it("rejects schema refresh without proper authorization (missing key)", async () => {
    process.env.CRON_SECRET = "test-secret";
    const handler = getHandler();
    const request = new Request("http://localhost/api/public/health?refresh=true");

    const response = await handler({ request });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.phase).toBe("schema_refresh");
    expect(body.error).toBe("Unauthorized: Missing or invalid API key");
  });

  it("returns 500 on schema_refresh failure", async () => {
    process.env.CRON_SECRET = "test-secret";
    mockSupabase.rpc.mockResolvedValue({ error: { message: "RPC Failed", code: "P0001" } });
    mockSupabase.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    const handler = getHandler();
    const request = new Request("http://localhost/api/public/health?refresh=true", {
      headers: { "x-api-key": "test-secret" },
    });

    const response = await handler({ request });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.phase).toBe("schema_refresh");
    expect(body.error).toBe("RPC Failed");

    const { sendHealthAlert } = await import("@/lib/healthAlert.server");
    expect(sendHealthAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "schema_refresh",
        message: expect.any(String),
      }),
    );
  });

  it("returns 500 on table_read failure", async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        data: null,
        error: { message: "Relation not found", code: "PGRST100" },
        count: null,
      }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    const handler = getHandler();
    const request = new Request("http://localhost/api/public/health");
    const response = await handler({ request });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.phase).toBe("table_read");
    expect(body.error).toBe("Relation not found");

    const { sendHealthAlert } = await import("@/lib/healthAlert.server");
    expect(sendHealthAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "table_read",
        message: expect.any(String),
      }),
    );
  });

  it("returns 500 on runtime exception", async () => {
    mockSupabase.from.mockImplementation(() => {
      throw new Error("Unexpected crash");
    });

    const handler = getHandler();
    const request = new Request("http://localhost/api/public/health");
    const response = await handler({ request });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.phase).toBe("runtime");
    expect(body.error).toBe("Unexpected crash");
  });

  it("handles schema cache refresh timeouts or long durations", async () => {
    process.env.CRON_SECRET = "test-secret";

    // Simulate a slow RPC call
    mockSupabase.rpc.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms simulated delay
      return { error: null };
    });

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        data: [{ section_key: "test", is_enabled: true }],
        error: null,
        count: 1,
      }),
      insert: vi.fn(),
    });

    const handler = getHandler();
    const request = new Request("http://localhost/api/public/health?refresh=true", {
      headers: { "x-api-key": "test-secret" },
    });

    const response = await handler({ request });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.metrics.refresh_duration_ms).toBeGreaterThanOrEqual(100);
    expect(body.refreshed).toBe(true);
  });
});
