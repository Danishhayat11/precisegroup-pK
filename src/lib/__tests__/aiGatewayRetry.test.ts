import { describe, expect, it } from "vitest";
import {
  isToolsRelatedError,
  nextRetryTools,
  sanitizeToolsForRetry,
  MAX_TOOLS_RETRY_ATTEMPTS,
} from "@/lib/aiGatewayRetry";
import type { ToolFunctionSchema } from "@/lib/aiToolSchemas";

const good: ToolFunctionSchema = {
  type: "function",
  function: {
    name: "search_bookings",
    description: "Search bookings",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
};

const alsoGood: ToolFunctionSchema = {
  type: "function",
  function: {
    name: "get_booking_detail",
    description: "One booking",
    parameters: {
      type: "object",
      properties: { booking_id: { type: "string" } },
      required: ["booking_id"],
    },
  },
};

describe("isToolsRelatedError", () => {
  it("flags 400 responses that mention tools/function/schema", () => {
    expect(isToolsRelatedError(400, "invalid tools[2].function.name")).toBe(true);
    expect(isToolsRelatedError(400, "schema validation failed for parameters")).toBe(true);
    expect(isToolsRelatedError(422, "unknown_tool: foobar")).toBe(true);
  });

  it("ignores auth / quota / server errors", () => {
    expect(isToolsRelatedError(401, "invalid tool token")).toBe(false);
    expect(isToolsRelatedError(402, "credits exhausted for tools")).toBe(false);
    expect(isToolsRelatedError(429, "too many tools")).toBe(false);
    expect(isToolsRelatedError(500, "tool internal error")).toBe(false);
  });

  it("ignores 4xx without tools-related wording", () => {
    expect(isToolsRelatedError(400, "invalid model")).toBe(false);
    expect(isToolsRelatedError(400, "")).toBe(false);
  });
});

describe("sanitizeToolsForRetry", () => {
  it("keeps valid entries and returns no drops", () => {
    const { tools, dropped } = sanitizeToolsForRetry([good, alsoGood]);
    expect(tools).toHaveLength(2);
    expect(dropped).toEqual([]);
  });

  it("drops null / undefined / holed entries", () => {
    const list: unknown[] = [good, null, alsoGood];
    const { tools, dropped } = sanitizeToolsForRetry(list);
    expect(tools).toHaveLength(2);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toMatch(/null/);
  });

  it("drops entries that fail per-entry validation but keeps their siblings", () => {
    const bad = { type: "function", function: { name: "", description: "", parameters: {} } };
    const { tools, dropped } = sanitizeToolsForRetry([good, bad, alsoGood]);
    expect(tools.map((t) => t.function.name)).toEqual(["search_bookings", "get_booking_detail"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].index).toBe(1);
  });

  it("collapses duplicate names to the first occurrence", () => {
    const { tools, dropped } = sanitizeToolsForRetry([good, { ...good }]);
    expect(tools).toHaveLength(1);
    expect(dropped[0].reason).toMatch(/duplicate/);
  });

  it("returns an empty list for non-array inputs (never throws)", () => {
    expect(sanitizeToolsForRetry(undefined).tools).toEqual([]);
    expect(sanitizeToolsForRetry(null).tools).toEqual([]);
    expect(sanitizeToolsForRetry("nope" as unknown).tools).toEqual([]);
  });
});

describe("nextRetryTools", () => {
  it("returns sanitized tools on attempt 1 when any valid entries survive", () => {
    const bad = { type: "function", function: { name: "", description: "", parameters: {} } };
    const step = nextRetryTools(1, [good, bad, alsoGood]);
    expect(step.strategy).toBe("sanitized");
    expect(step.tools?.map((t) => t.function.name)).toEqual([
      "search_bookings",
      "get_booking_detail",
    ]);
    expect(step.dropped).toHaveLength(1);
  });

  it("skips straight to safe-default when no valid entries remain", () => {
    const step = nextRetryTools(1, [null, undefined]);
    expect(step.strategy).toBe("safe-default");
    expect(step.tools).toBeUndefined();
  });

  it("returns safe-default (no tools) on attempt 2", () => {
    const step = nextRetryTools(2, [good]);
    expect(step.strategy).toBe("safe-default");
    expect(step.tools).toBeUndefined();
  });

  it("signals stop past MAX_TOOLS_RETRY_ATTEMPTS", () => {
    const step = nextRetryTools(MAX_TOOLS_RETRY_ATTEMPTS + 1, [good]);
    expect(step.strategy).toBe("stop");
    expect(step.tools).toBeUndefined();
  });
});
