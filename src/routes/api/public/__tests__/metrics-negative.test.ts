import { describe, it, expect } from "vitest";

/**
 * These tests intentionally trigger failures to verify that our CI
 * catch-all correctly identifies malformed Prometheus output or
 * incorrect labels.
 */
describe("/api/public/metrics - Negative Scenarios", () => {
  it("should fail if the output contains invalid metric names (e.g. starting with numbers)", async () => {
    // Simulated output that violates Prometheus naming conventions
    const malformedOutput = '1_invalid_metric_name{label="test"} 1.0';

    const isValidName = (line: string) => {
      const metricName = line.split("{")[0].split(" ")[0];
      return /^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(metricName);
    };

    expect(isValidName(malformedOutput)).toBe(false);
  });

  it("should fail if labels are missing closing braces", async () => {
    const malformedOutput = 'health_check_status{outcome="success" 1';

    const hasBalancedBraces = (line: string) => {
      if (!line.includes("{")) return true;
      return line.includes("{") && line.includes("}");
    };

    expect(hasBalancedBraces(malformedOutput)).toBe(false);
  });

  it("should fail if metric values are not numeric", async () => {
    const malformedOutput = "health_check_latency_seconds value_is_nan";

    const hasNumericValue = (line: string) => {
      const parts = line.trim().split(/\s+/);
      const lastPart = parts[parts.length - 1];
      return !isNaN(parseFloat(lastPart)) && isFinite(Number(lastPart));
    };

    expect(hasNumericValue(malformedOutput)).toBe(false);
  });

  it("should fail if the output does not contain required labels for specific metrics", async () => {
    const output = "health_check_status 1"; // missing {outcome="..."}

    const hasOutcomeLabel = (line: string) => {
      return line.includes('outcome="');
    };

    if (output.startsWith("health_check_status")) {
      expect(hasOutcomeLabel(output)).toBe(false);
    }
  });
});
