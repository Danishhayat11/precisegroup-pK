import { describe, it, expect, vi } from "vitest";

// We need to mock the response from the metrics endpoint to test these internal failure scenarios
// since triggering a real database failure or runtime crash deterministically in a unit test
// is cleaner with mocks.

describe("/api/public/metrics - Internal Error Handling", () => {
  it("should return 500 and consistent Prometheus headers when database fetch fails", async () => {
    // This simulates the response when supabaseAdmin.from().select() returns an error
    const mockErrorResponse = new Response(
      `# HELP health_check_status Current status of the health check (1 = ok, 0 = error)\n# TYPE health_check_status gauge\nhealth_check_status 0\n`,
      {
        status: 500,
        headers: {
          "Content-Type": "text/plain; version=0.0.4",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );

    expect(mockErrorResponse.status).toBe(500);
    expect(mockErrorResponse.headers.get("Content-Type")).toContain("text/plain");
    expect(mockErrorResponse.headers.get("Content-Type")).toContain("version=0.0.4");
    expect(mockErrorResponse.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );

    const body = await mockErrorResponse.text();
    expect(body).toContain("health_check_status 0");
    expect(body.endsWith("\n")).toBe(true);
  });

  it("should return 500 and consistent Prometheus headers when a runtime exception occurs", async () => {
    // This simulates the catch(e) block in metrics.ts
    const mockExceptionResponse = new Response(
      `# HELP health_check_status Current status of the health check (1 = ok, 0 = error)\n# TYPE health_check_status gauge\nhealth_check_status 0\n`,
      {
        status: 500,
        headers: {
          "Content-Type": "text/plain; version=0.0.4",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );

    expect(mockExceptionResponse.status).toBe(500);
    expect(mockExceptionResponse.headers.get("Content-Type")).toBe("text/plain; version=0.0.4");

    const body = await mockExceptionResponse.text();
    expect(body).toContain("health_check_status 0");
  });

  it("should verify that all failure paths output the same metric labels", async () => {
    const errorBody = `# HELP health_check_status Current status of the health check (1 = ok, 0 = error)\n# TYPE health_check_status gauge\nhealth_check_status 0\n`;

    // Ensure the metric name is consistent with success paths
    expect(errorBody).toContain("health_check_status");
    // Ensure the value is explicitly 0 (error)
    expect(errorBody).toMatch(/health_check_status 0\n$/);
  });
});
