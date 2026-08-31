import { describe, it, expect } from "vitest";
import {
  isGatewayErrorRow,
  buildGatewayErrorPayload,
  type GatewayPayloadRow,
} from "../aiDiagnosticsGatewayPayload";

const base = (over: Partial<GatewayPayloadRow> = {}): GatewayPayloadRow => ({
  tool_name: "search",
  round: 1,
  gateway_status: 200,
  gateway_model: "openai/gpt-5",
  retry_strategy: "primary",
  error_message: null,
  tool_args: { q: "hi" },
  tool_result: { ok: true },
  success: true,
  ...over,
});

describe("isGatewayErrorRow", () => {
  it("flags rows with HTTP >= 400", () => {
    expect(isGatewayErrorRow(base({ gateway_status: 500 }))).toBe(true);
    expect(isGatewayErrorRow(base({ gateway_status: 429 }))).toBe(true);
    expect(isGatewayErrorRow(base({ gateway_status: 400 }))).toBe(true);
  });

  it("does NOT flag rows with 2xx / 3xx gateway status", () => {
    expect(isGatewayErrorRow(base({ gateway_status: 200 }))).toBe(false);
    expect(isGatewayErrorRow(base({ gateway_status: 302 }))).toBe(false);
  });

  it("flags failed rows that carry an error_message even without a gateway_status", () => {
    expect(
      isGatewayErrorRow(base({ success: false, error_message: "boom", gateway_status: null })),
    ).toBe(true);
  });

  it("does NOT flag failed rows with no error_message (e.g. in-flight abort)", () => {
    expect(
      isGatewayErrorRow(base({ success: false, error_message: null, gateway_status: null })),
    ).toBe(false);
  });

  it("does NOT flag success=true rows even if error_message is populated", () => {
    expect(
      isGatewayErrorRow(base({ success: true, error_message: "warn", gateway_status: 200 })),
    ).toBe(false);
  });

  it("treats null gateway_status alone as non-error", () => {
    expect(isGatewayErrorRow(base({ gateway_status: null }))).toBe(false);
  });
});

describe("buildGatewayErrorPayload", () => {
  it("returns null for non-gateway rows regardless of format", () => {
    const r = base(); // success 200 → not an error
    expect(buildGatewayErrorPayload(r)).toBeNull();
    expect(buildGatewayErrorPayload(r, "object")).toBeNull();
    expect(buildGatewayErrorPayload(r, "compact")).toBeNull();
    expect(buildGatewayErrorPayload(r, "pretty")).toBeNull();
  });

  it("returns null for successful rows with an error_message (not a gateway error)", () => {
    expect(
      buildGatewayErrorPayload(base({ success: true, error_message: "warn", gateway_status: 200 })),
    ).toBeNull();
  });

  it("returns null for in-flight rows with no gateway_status and no error_message", () => {
    expect(
      buildGatewayErrorPayload(base({ success: false, error_message: null, gateway_status: null })),
    ).toBeNull();
  });

  it("returns a fully-populated nested object for HTTP >= 400 rows (default format)", () => {
    const r = base({
      gateway_status: 503,
      success: false,
      error_message: "upstream unavailable",
      retry_strategy: "backoff",
      tool_args: { q: "x" },
      tool_result: null,
    });
    const payload = buildGatewayErrorPayload(r) as Record<string, unknown>;
    expect(payload).toEqual({
      tool: "search",
      round: 1,
      gateway_status: 503,
      gateway_model: "openai/gpt-5",
      retry_strategy: "backoff",
      error_message: "upstream unavailable",
      tool_args: { q: "x" },
      tool_result: null,
    });
  });

  it("returns a compact JSON string when format='compact'", () => {
    const r = base({ gateway_status: 500, success: false, error_message: "e" });
    const out = buildGatewayErrorPayload(r, "compact");
    expect(typeof out).toBe("string");
    expect(out as string).not.toContain("\n");
    expect(JSON.parse(out as string)).toMatchObject({
      gateway_status: 500,
      error_message: "e",
    });
  });

  it("returns an indented multi-line JSON string when format='pretty'", () => {
    const r = base({ gateway_status: 500, success: false, error_message: "e" });
    const out = buildGatewayErrorPayload(r, "pretty") as string;
    expect(typeof out).toBe("string");
    expect(out).toContain("\n");
    expect(out).toMatch(/^{\n {2}"tool":/);
    expect(JSON.parse(out)).toMatchObject({
      gateway_status: 500,
      error_message: "e",
    });
  });

  it("preserves null gateway_model / retry_strategy / tool_result verbatim", () => {
    const r = base({
      gateway_status: 502,
      success: false,
      error_message: "bad gateway",
      gateway_model: null,
      retry_strategy: null,
      tool_result: null,
    });
    const payload = buildGatewayErrorPayload(r) as Record<string, unknown>;
    expect(payload.gateway_model).toBeNull();
    expect(payload.retry_strategy).toBeNull();
    expect(payload.tool_result).toBeNull();
  });

  it("is populated for the failed-with-message-but-no-status case (drawer-parity)", () => {
    const r = base({
      success: false,
      error_message: "aborted mid-stream",
      gateway_status: null,
    });
    const payload = buildGatewayErrorPayload(r) as Record<string, unknown>;
    expect(payload).not.toBeNull();
    expect(payload.gateway_status).toBeNull();
    expect(payload.error_message).toBe("aborted mid-stream");
  });
});
