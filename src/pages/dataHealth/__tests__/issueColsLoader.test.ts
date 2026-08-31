/**
 * Unit tests for `loadIssueVisibleCols` — the pure loader that hydrates the
 * Issues table's column-visibility state from localStorage.
 *
 * Covers the versioned envelope schema, legacy migration from the pre-v1
 * bare-array format, and every fallback path DataHealth relies on.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadIssueVisibleCols,
  sanitizeIssueVisibleCols,
  serializeIssueVisibleCols,
  ISSUE_VIS_KEY,
  CURRENT_VERSION,
} from "@/pages/dataHealth/issueColsLoader";

const ALL_KEYS = ["severity", "booking", "type", "description", "detected", "action"] as const;

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const calls = { getItem: 0, removeItem: 0 };
  return {
    getItem: (k: string) => {
      calls.getItem++;
      return store.has(k) ? store.get(k)! : null;
    },
    removeItem: (k: string) => {
      calls.removeItem++;
      store.delete(k);
    },
    _store: store,
    _calls: calls,
  };
}

describe("loadIssueVisibleCols — versioned schema", () => {
  let storage: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    storage = makeStorage();
  });

  it("returns defaults with no reason when localStorage is unavailable", () => {
    const r = loadIssueVisibleCols(ALL_KEYS, null);
    expect(r.reason).toBeNull();
    expect([...r.cols].sort()).toEqual([...ALL_KEYS].sort());
  });

  it("returns defaults with no reason on first visit (missing key)", () => {
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBeNull();
    expect([...r.cols].sort()).toEqual([...ALL_KEYS].sort());
    expect(storage._calls.removeItem).toBe(0);
  });

  it("loads a valid current-version envelope", () => {
    storage._store.set(
      ISSUE_VIS_KEY,
      JSON.stringify({ v: CURRENT_VERSION, cols: ["severity", "booking"] }),
    );
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBeNull();
    expect([...r.cols].sort()).toEqual(["booking", "severity"]);
  });

  it("migrates the legacy bare-array format to the current envelope", () => {
    storage._store.set(ISSUE_VIS_KEY, JSON.stringify(["severity", "booking"]));
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBeNull();
    expect([...r.cols].sort()).toEqual(["booking", "severity"]);
    // Legacy value stays put until the user next persists — no destructive rewrite on read.
    expect(storage._store.has(ISSUE_VIS_KEY)).toBe(true);
  });

  it("returns 'unsupported' when the stored version is newer than CURRENT_VERSION", () => {
    storage._store.set(
      ISSUE_VIS_KEY,
      JSON.stringify({ v: CURRENT_VERSION + 1, cols: ["severity"] }),
    );
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBe("unsupported");
    expect([...r.cols].sort()).toEqual([...ALL_KEYS].sort());
    expect(storage._store.has(ISSUE_VIS_KEY)).toBe(false);
  });

  it("returns 'corrupted' and wipes the key when JSON is unparseable", () => {
    storage._store.set(ISSUE_VIS_KEY, "{not json");
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBe("corrupted");
    expect(storage._store.has(ISSUE_VIS_KEY)).toBe(false);
  });

  it.each([
    ["object w/o version", JSON.stringify({ cols: ["severity"] })],
    ["negative version", JSON.stringify({ v: -1, cols: ["severity"] })],
    ["string version", JSON.stringify({ v: "1", cols: ["severity"] })],
    ["string payload", JSON.stringify("severity")],
    ["number payload", JSON.stringify(42)],
    ["null payload", JSON.stringify(null)],
  ])("returns 'invalid' when envelope is malformed (%s)", (_label, raw) => {
    storage._store.set(ISSUE_VIS_KEY, raw);
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBe("invalid");
    expect(storage._store.has(ISSUE_VIS_KEY)).toBe(false);
  });

  it("returns 'invalid' when a versioned envelope has a non-array cols field", () => {
    storage._store.set(ISSUE_VIS_KEY, JSON.stringify({ v: CURRENT_VERSION, cols: "severity" }));
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBe("invalid");
    expect(storage._store.has(ISSUE_VIS_KEY)).toBe(false);
  });

  it("returns 'empty' when the envelope has an empty cols array", () => {
    storage._store.set(ISSUE_VIS_KEY, JSON.stringify({ v: CURRENT_VERSION, cols: [] }));
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBe("empty");
    expect(storage._store.has(ISSUE_VIS_KEY)).toBe(false);
  });

  it("returns 'empty' when every stored key is unknown", () => {
    storage._store.set(
      ISSUE_VIS_KEY,
      JSON.stringify({ v: CURRENT_VERSION, cols: ["nope", "gone"] }),
    );
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBe("empty");
    expect(storage._store.has(ISSUE_VIS_KEY)).toBe(false);
  });

  it("filters unknown keys out but keeps the valid subset", () => {
    storage._store.set(
      ISSUE_VIS_KEY,
      JSON.stringify({ v: CURRENT_VERSION, cols: ["severity", "removed_col", "booking", 7, null] }),
    );
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBeNull();
    expect([...r.cols].sort()).toEqual(["booking", "severity"]);
    expect(storage._store.has(ISSUE_VIS_KEY)).toBe(true);
  });

  it("swallows getItem() throwing and returns defaults with no reason", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    const r = loadIssueVisibleCols(ALL_KEYS, throwing);
    expect(r.reason).toBeNull();
    expect([...r.cols].sort()).toEqual([...ALL_KEYS].sort());
  });
});

describe("serializeIssueVisibleCols", () => {
  it("writes a current-version envelope", () => {
    const raw = serializeIssueVisibleCols(new Set(["severity", "booking"]));
    expect(JSON.parse(raw)).toEqual({ v: CURRENT_VERSION, cols: ["severity", "booking"] });
  });

  it("round-trips through the loader", () => {
    const storage = makeStorage();
    storage._store.set(ISSUE_VIS_KEY, serializeIssueVisibleCols(["severity", "type"]));
    const r = loadIssueVisibleCols(ALL_KEYS, storage);
    expect(r.reason).toBeNull();
    expect([...r.cols].sort()).toEqual(["severity", "type"]);
  });

  describe("sanitizeIssueVisibleCols — shared picker + export validator", () => {
    it("keeps only known keys and reports dropped ones", () => {
      const r = sanitizeIssueVisibleCols(["severity", "bogus", "type"], ALL_KEYS);
      expect([...r.cols].sort()).toEqual(["severity", "type"]);
      expect(r.dropped).toEqual(["bogus"]);
      expect(r.valid).toBe(true);
    });

    it("de-duplicates repeated keys", () => {
      const r = sanitizeIssueVisibleCols(["severity", "severity", "type"], ALL_KEYS);
      expect([...r.cols].sort()).toEqual(["severity", "type"]);
      expect(r.valid).toBe(true);
    });

    it("filters non-string entries", () => {
      // Callers pass Set<string>, but a corrupted mutation could sneak non-strings in.
      const r = sanitizeIssueVisibleCols(
        ["severity", 42 as unknown as string, null as unknown as string],
        ALL_KEYS,
      );
      expect([...r.cols]).toEqual(["severity"]);
      expect(r.dropped.length).toBe(2);
      expect(r.valid).toBe(true);
    });

    it("reports invalid when nothing usable remains", () => {
      const r = sanitizeIssueVisibleCols(["bogus", "also-bogus"], ALL_KEYS);
      expect(r.cols.size).toBe(0);
      expect(r.valid).toBe(false);
      expect(r.dropped).toEqual(["bogus", "also-bogus"]);
    });

    it("treats null/undefined input as an invalid empty selection", () => {
      expect(sanitizeIssueVisibleCols(null, ALL_KEYS).valid).toBe(false);
      expect(sanitizeIssueVisibleCols(undefined, ALL_KEYS).valid).toBe(false);
    });

    it("accepts a Set as candidate (matches picker call site)", () => {
      const r = sanitizeIssueVisibleCols(new Set(["severity", "booking"]), ALL_KEYS);
      expect([...r.cols].sort()).toEqual(["booking", "severity"]);
      expect(r.valid).toBe(true);
    });
  });
});
