import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import fc from "fast-check";

// Ensure localStorage is always defined in Node 26+ jsdom environments.
if (typeof window !== "undefined") {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  try {
    if (!window.localStorage || typeof window.localStorage.clear !== "function") {
      Object.defineProperty(window, "localStorage", {
        value: mockStorage,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Ignore if non-configurable
  }
  try {
    if (!globalThis.localStorage || typeof (globalThis.localStorage as any).clear !== "function") {
      Object.defineProperty(globalThis, "localStorage", {
        value: mockStorage,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Ignore if non-configurable
  }
}

// Auto-unmount React trees between tests so each test starts with a clean DOM.
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Deterministic property-test reproduction in CI.
//
// fast-check already prints `seed`, `path`, and the shrunk counterexample on
// failure, but the default one-liner is easy to miss in a long CI log. Here
// we install a custom `reporter` that:
//
//   1. Emits a clearly-marked ⚠ PROPERTY TEST FAILED banner.
//   2. Prints the shrunk counterexample as pretty JSON so a caller can copy
//      it into a regression test verbatim.
//   3. Prints a copy-pasteable `fc.assert(..., { seed, path, endOnFailure: true })`
//      snippet — dropping that into the failing test reproduces the exact
//      collision deterministically on any machine.
//
// Also flips `verbose: 2` on globally so fast-check records every failing
// value it encounters while shrinking (not just the final shrunk one),
// which makes triaging flaky-looking collision bugs much faster.
// ---------------------------------------------------------------------------
fc.configureGlobal({
  verbose: 2,
  reporter(runDetails) {
    if (!runDetails.failed) return;
    const {
      seed,
      counterexamplePath: path,
      numRuns,
      numShrinks,
      counterexample,
      errorInstance: error,
    } = runDetails;
    const repro = `fc.assert(prop, { seed: ${seed}, path: ${JSON.stringify(path)}, endOnFailure: true })`;
    const banner = "⚠  PROPERTY TEST FAILED — deterministic reproduction below";
    const bar = "─".repeat(banner.length);

    console.error(
      [
        "",
        bar,
        banner,
        bar,
        `runs:        ${numRuns}`,
        `shrinks:     ${numShrinks}`,
        `seed:        ${seed}`,
        `path:        ${path}`,
        `counterexample: ${safeJson(counterexample)}`,
        error ? `error:       ${String(error).split("\n")[0]}` : "",
        "",
        "Reproduce with:",
        `  ${repro}`,
        bar,
        "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    // fast-check suppresses its default throw when a custom `reporter` is
    // installed — re-throw so the test still fails and CI turns red.
    throw new Error(
      `Property test failed. Reproduce with: fc.assert(prop, { seed: ${seed}, path: ${JSON.stringify(path)}, endOnFailure: true })`,
      { cause: error },
    );
  },
});

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? String(val) : val), 2);
  } catch {
    return String(v);
  }
}
