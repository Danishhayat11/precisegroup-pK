/**
 * Verifies the failure banner produced by `assertProperty` inlines the
 * caller-supplied `renderInputs` output — the exact CSV header/metadata
 * block + body, or the JSON envelope — so a reviewer can copy-paste
 * from the CI log to reproduce a collision without opening any sibling
 * artifact file.
 *
 * Contract:
 *   • On a property-mode failure with `renderInputs`, the banner contains
 *     a "Rendered inputs" section with `----- BEGIN <name> -----` /
 *     `----- END <name> -----` fences around each entry's exact bytes.
 *   • Each fenced body reports its original byte length in the BEGIN line.
 *   • Bodies over the banner cap are truncated with an explicit
 *     "... [truncated N bytes — full text in the sibling artifact file]"
 *     footer, and the truncation preserves the prefix verbatim.
 *   • A throwing renderer never masks the assertion — the banner still
 *     throws with the property failure and reports the renderer error
 *     inline.
 *   • Non-property modes (tooManySkips, interrupted) and successful runs
 *     do NOT inline rendered inputs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { assertProperty } from "../fuzzReporter";

let PRIOR_FUZZ_DIR: string | undefined;
beforeEach(() => {
  PRIOR_FUZZ_DIR = process.env.FUZZ_FAILURE_DIR;
  // Disable disk artifacts — we're asserting on the thrown banner only.
  process.env.FUZZ_FAILURE_DIR = "";
});
afterEach(() => {
  if (PRIOR_FUZZ_DIR === undefined) delete process.env.FUZZ_FAILURE_DIR;
  else process.env.FUZZ_FAILURE_DIR = PRIOR_FUZZ_DIR;
});

let counter = 0;
function uniq(base: string): string {
  // Fresh per test so the seed-store auto-replay doesn't relabel the
  // banner and shift the "shrinks=..." counts we implicitly rely on.
  return `${base}/${Date.now()}-${++counter}`;
}

function captureBanner(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error) return err.message;
    return String(err);
  }
  throw new Error("expected the property to throw, but it passed");
}

describe("failure banner inlines rendered inputs", () => {
  it("includes fenced CSV + JSON blocks with exact bytes and byte counts", () => {
    // Simulate a CSV-collision property: the counterexample is a pair
    // of column labels that collide to the same slug. The renderer
    // produces the metadata header + body the property would have
    // exercised.
    const csvBody = "amount,amount_2\n1,2\n";
    const csvMeta =
      "# Lovable CSV export\n# Columns: amount|amount_2\n# generatedAt: 2026-01-01T00:00:00.000Z\n";
    const csv = csvMeta + csvBody;
    const jsonEnvelope = JSON.stringify(
      {
        _meta: { columns: [{ key: "amount" }, { key: "amount_2" }] },
        rows: [{ amount: 1, amount_2: 2 }],
      },
      null,
      2,
    );

    const banner = captureBanner(() =>
      assertProperty(
        uniq("csv/collision"),
        fc.property(fc.constant(["amount", "amount"] as const), () => false),
        {
          seed: 1,
          numRuns: 1,
          argNames: ["labels"],
          renderInputs: () => ({
            "input.csv": csv,
            "input.json": jsonEnvelope,
          }),
        },
      ),
    );

    expect(banner).toContain("Rendered inputs (exact bytes the property saw):");
    // Fence with byte count so a reviewer knows whether they're seeing
    // the whole thing or a truncation.
    expect(banner).toContain(`----- BEGIN input.csv (${csv.length} bytes) -----`);
    expect(banner).toContain("----- END input.csv -----");
    expect(banner).toContain(`----- BEGIN input.json (${jsonEnvelope.length} bytes) -----`);
    expect(banner).toContain("----- END input.json -----");
    // Exact CSV metadata + body bytes appear verbatim (no re-encoding,
    // no escaping) so the reviewer can pipe the block back into the
    // parser.
    expect(banner).toContain(csvMeta);
    expect(banner).toContain(csvBody);
    // JSON body appears verbatim including whitespace.
    expect(banner).toContain(jsonEnvelope);
  });

  it("truncates large rendered inputs and marks the tail", () => {
    // A body larger than the 4 KB banner cap should be sliced with a
    // clear "truncated N bytes" marker pointing at the sibling artifact.
    const big = "row,val\n" + "x,1\n".repeat(2000); // >> 4096 bytes
    const banner = captureBanner(() =>
      assertProperty(
        uniq("csv/large"),
        fc.property(fc.constant(0), () => false),
        {
          seed: 2,
          numRuns: 1,
          renderInputs: () => ({ "input.csv": big }),
        },
      ),
    );
    expect(banner).toContain(`----- BEGIN input.csv (${big.length} bytes) -----`);
    expect(banner).toMatch(/… \[truncated \d+ bytes — full text in the sibling artifact file\]/);
    // Prefix is preserved verbatim — the header line is intact so a
    // reviewer can at least see the columns.
    expect(banner).toContain("row,val\n");
    // Banner never contains the full body in the truncated case.
    expect(banner.length).toBeLessThan(big.length);
  });

  it("does not mask the assertion when renderInputs throws", () => {
    const banner = captureBanner(() =>
      assertProperty(
        uniq("csv/renderer-throws"),
        fc.property(fc.constant(0), () => false),
        {
          seed: 3,
          numRuns: 1,
          renderInputs: () => {
            throw new Error("boom in renderer");
          },
        },
      ),
    );
    // Property failure still surfaces.
    expect(banner).toMatch(/failed \(mode: property\)/);
    // Renderer error is reported inline, no BEGIN/END fences.
    expect(banner).toContain("Rendered inputs unavailable (renderInputs threw):");
    expect(banner).toContain("boom in renderer");
    expect(banner).not.toContain("----- BEGIN");
  });

  it("omits the rendered-inputs section when renderInputs is not provided", () => {
    const banner = captureBanner(() =>
      assertProperty(
        uniq("csv/no-renderer"),
        fc.property(fc.constant(0), () => false),
        { seed: 4, numRuns: 1 },
      ),
    );
    expect(banner).toMatch(/failed \(mode: property\)/);
    expect(banner).not.toContain("Rendered inputs");
    expect(banner).not.toContain("----- BEGIN");
  });
});
