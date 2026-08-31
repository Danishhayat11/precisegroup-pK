import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_REVOKED_PG_CODES,
  DEFAULT_REVOKED_TEXT_MARKERS,
  getRevokedRpcMappings,
  registerRevokedRpcMappings,
  __resetRuntimeRevokedRpcMappingsForTests,
} from "../revokedRpcMappings";
import { isRevokedRpcError } from "../approvedRpc";

afterEach(() => {
  __resetRuntimeRevokedRpcMappingsForTests();
});

describe("revokedRpcMappings config layer", () => {
  it("ships every default SQLSTATE / PGRST code", () => {
    const { codes } = getRevokedRpcMappings();
    for (const c of DEFAULT_REVOKED_PG_CODES) expect(codes.has(c)).toBe(true);
  });

  it("ships every default text marker (case-insensitive)", () => {
    const { textMarkers } = getRevokedRpcMappings();
    for (const m of DEFAULT_REVOKED_TEXT_MARKERS) {
      expect(textMarkers).toContain(m.toLowerCase());
    }
  });

  it("registerRevokedRpcMappings extends codes without removing defaults", () => {
    registerRevokedRpcMappings({ codes: ["PGRST999", "CUSTOM_A"] });
    const { codes } = getRevokedRpcMappings();
    expect(codes.has("PGRST999")).toBe(true);
    expect(codes.has("CUSTOM_A")).toBe(true);
    // defaults still present
    expect(codes.has("42501")).toBe(true);
    expect(codes.has("PGRST301")).toBe(true);
  });

  it("registerRevokedRpcMappings extends text markers (lowercased) without removing defaults", () => {
    registerRevokedRpcMappings({ textMarkers: ["Custom Denied Marker"] });
    const { textMarkers } = getRevokedRpcMappings();
    expect(textMarkers).toContain("custom denied marker");
    expect(textMarkers).toContain("insufficient privilege");
  });

  it("ignores empty / non-string entries", () => {
    registerRevokedRpcMappings({
      codes: ["", "   ", null, undefined, "OK1"],
      textMarkers: ["", "  ", null, undefined, "OK MARKER"],
    });
    const { codes, textMarkers } = getRevokedRpcMappings();
    expect(codes.has("")).toBe(false);
    expect(codes.has("OK1")).toBe(true);
    expect(textMarkers).toContain("ok marker");
    expect(textMarkers.includes("")).toBe(false);
  });

  it("is idempotent — registering the same value twice does not duplicate", () => {
    registerRevokedRpcMappings({ codes: ["DUP1"], textMarkers: ["dup marker"] });
    registerRevokedRpcMappings({ codes: ["DUP1"], textMarkers: ["dup marker"] });
    const { codes, textMarkers } = getRevokedRpcMappings();
    expect([...codes].filter((c) => c === "DUP1")).toHaveLength(1);
    expect(textMarkers.filter((m) => m === "dup marker")).toHaveLength(1);
  });

  it("isRevokedRpcError picks up runtime-added codes and markers", () => {
    // Baseline: unknown code + benign message is not treated as revoked.
    expect(isRevokedRpcError({ code: "CUSTOM_X" })).toBe(false);
    expect(isRevokedRpcError({ message: "custom vendor denial" })).toBe(false);

    registerRevokedRpcMappings({
      codes: ["CUSTOM_X"],
      textMarkers: ["custom vendor denial"],
    });

    expect(isRevokedRpcError({ code: "CUSTOM_X" })).toBe(true);
    expect(isRevokedRpcError({ message: "Custom Vendor Denial happened" })).toBe(true);
    // Existing defaults still work.
    expect(isRevokedRpcError({ code: "42501" })).toBe(true);
  });
});
