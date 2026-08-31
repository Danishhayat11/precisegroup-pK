import { describe, expect, it } from "vitest";
import {
  ToolSchemaValidationError,
  validateToolSchemas,
  type ToolFunctionSchema,
} from "@/lib/aiToolSchemas";

const good: ToolFunctionSchema = {
  type: "function",
  function: {
    name: "search_bookings",
    description: "Search bookings",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

const another: ToolFunctionSchema = {
  type: "function",
  function: {
    name: "get_booking_detail",
    description: "Full booking detail",
    parameters: {
      type: "object",
      properties: { booking_id: { type: "string" } },
      required: ["booking_id"],
    },
  },
};

describe("validateToolSchemas", () => {
  it("accepts a well-formed list", () => {
    expect(() => validateToolSchemas([good, another])).not.toThrow();
    const out = validateToolSchemas([good, another]);
    expect(out).toHaveLength(2);
  });

  it("rejects a non-array input with a descriptive error", () => {
    expect(() => validateToolSchemas("nope" as unknown)).toThrow(ToolSchemaValidationError);
    expect(() => validateToolSchemas(null)).toThrow(/Expected an array/);
  });

  it("catches a stray-comma array hole (undefined entry)", () => {
    // Simulate `[good, , another]` — Array.prototype.forEach would skip it,
    // but our validator must flag it.
    const holed: unknown[] = [good, another];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (holed as any)[3] = another; // creates a hole at index 2
    expect(() => validateToolSchemas(holed)).toThrow(/stray comma|undefined/i);
  });

  it("catches a null entry", () => {
    expect(() => validateToolSchemas([good, null])).toThrow(/is null/);
  });

  it("rejects entries missing type: function", () => {
    const bad = { ...good, type: "other" } as unknown;
    expect(() => validateToolSchemas([bad])).toThrow(/type.*must be the literal/);
  });

  it("rejects a missing function.name", () => {
    const bad = { type: "function", function: { ...good.function, name: "" } };
    expect(() => validateToolSchemas([bad])).toThrow(/name.*non-empty/);
  });

  it("rejects non-snake_case names", () => {
    const bad = { type: "function", function: { ...good.function, name: "SearchBookings" } };
    expect(() => validateToolSchemas([bad])).toThrow(/snake_case/);
  });

  it("rejects duplicate tool names", () => {
    expect(() => validateToolSchemas([good, { ...good }])).toThrow(/duplicate tool name/);
  });

  it("rejects missing description", () => {
    const bad = { type: "function", function: { ...good.function, description: "" } };
    expect(() => validateToolSchemas([bad])).toThrow(/description.*non-empty/);
  });

  it("rejects parameters that are not object-typed", () => {
    const bad = {
      type: "function",
      function: {
        ...good.function,
        parameters: { type: "string" } as unknown as ToolFunctionSchema["function"]["parameters"],
      },
    };
    expect(() => validateToolSchemas([bad])).toThrow(/parameters\.type.*"object"/);
  });

  it("rejects required keys not declared in properties", () => {
    const bad = {
      type: "function",
      function: {
        ...good.function,
        parameters: {
          type: "object" as const,
          properties: { query: { type: "string" } },
          required: ["query", "missing_key"],
        },
      },
    };
    expect(() => validateToolSchemas([bad])).toThrow(/"missing_key" is not declared/);
  });

  it("aggregates every issue in one throw (no whack-a-mole)", () => {
    const bad1 = { type: "wrong", function: { name: "", description: "", parameters: {} } };
    const bad2 = null;
    try {
      validateToolSchemas([bad1, bad2]);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolSchemaValidationError);
      const issues = (err as ToolSchemaValidationError).issues;
      // bad1 contributes: type + name + description + parameters.type; bad2: null entry.
      expect(issues.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("validates the real TOOL_SCHEMAS shipped to the gateway", async () => {
    // Import the runtime list to guarantee production schemas satisfy the
    // same rules the unit tests enforce.
    const mod = await import("@/routes/api/ai");
    // TOOL_SCHEMAS is not exported; instead, importing the module must
    // succeed — assertToolSchemas runs at module load and would throw here
    // if any schema were malformed.
    expect(mod).toBeTruthy();
  });
});
