/**
 * CI annotation emission for fuzz failures.
 *
 * Verifies that `assertProperty`, on a failing property, writes a
 * GitHub Actions `::error ...::` workflow command to stdout with:
 *   • title containing the property name, mode, seed, and path
 *   • message body containing the shrunk counterexample
 *   • newlines/carriage-returns/percent signs properly encoded
 *
 * Also verifies gating: `FUZZ_CI_ANNOTATIONS=off` suppresses; `auto`
 * (default) only emits when `GITHUB_ACTIONS=true`; `github` forces on;
 * successful runs never emit anything.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";
import { assertProperty } from "../fuzzReporter";

const ENV_KEYS = ["FUZZ_CI_ANNOTATIONS", "GITHUB_ACTIONS", "FUZZ_FAILURE_DIR"] as const;
type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

let snapshot: EnvSnapshot;
let writeSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];

beforeEach(() => {
  snapshot = {};
  for (const k of ENV_KEYS) snapshot[k] = process.env[k];
  // Disable disk artifacts for these unit tests — we only care about
  // the stdout side-channel.
  process.env.FUZZ_FAILURE_DIR = "";
  stdoutChunks = [];
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  writeSpy.mockRestore();
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

function annotationLine(): string | undefined {
  return stdoutChunks.find((c) => c.startsWith("::error "));
}

let propCounter = 0;
function uniqueName(base: string): string {
  // Fresh property name per invocation so the seed-store auto-replay
  // machinery (which persists across runs) can't relabel our banner
  // with "[auto-replay of stored seed]" and break tight regex asserts.
  return `${base}/${Date.now()}-${++propCounter}`;
}

function runFailingProperty(name = uniqueName("ci-annot/always-false")): string {
  expect(() =>
    assertProperty(
      name,
      fc.property(fc.integer({ min: 1, max: 10 }), () => false),
      { seed: 42, numRuns: 5, argNames: ["n"] },
    ),
  ).toThrow(/failed \(mode: property\)/);
  return name;
}

describe("emitCiAnnotation", () => {
  it("emits a GitHub workflow-command on failure when FUZZ_CI_ANNOTATIONS=github", () => {
    process.env.FUZZ_CI_ANNOTATIONS = "github";
    delete process.env.GITHUB_ACTIONS;
    const name = runFailingProperty();
    const line = annotationLine();
    expect(line, `no ::error line in stdout chunks: ${JSON.stringify(stdoutChunks)}`).toBeDefined();
    // Title carries name + mode + seed + path for at-a-glance triage.
    // Property/file values are not %-encoded (only the message body is).
    expect(line!).toContain(`title=fuzz: ${name} (property, seed=42, path=0:0)::`);
    expect(line!).toMatch(/seed=42/);
    // Message body includes the reproduce line and counterexample block,
    // with newlines encoded as %0A per workflow-command rules.
    expect(line!).toMatch(/%0AMinimal counterexample/);
    expect(line!).toMatch(/node scripts\/ci\/fuzz-replay\.mjs --seed 42/);
    expect(line!.endsWith("\n")).toBe(true);
  });

  it("emits under auto mode only when GITHUB_ACTIONS=true", () => {
    process.env.FUZZ_CI_ANNOTATIONS = "auto";
    delete process.env.GITHUB_ACTIONS;
    runFailingProperty();
    expect(annotationLine()).toBeUndefined();

    stdoutChunks = [];
    process.env.GITHUB_ACTIONS = "true";
    runFailingProperty();
    expect(annotationLine()).toBeDefined();
  });

  it("never emits when FUZZ_CI_ANNOTATIONS=off, even under GitHub Actions", () => {
    process.env.FUZZ_CI_ANNOTATIONS = "off";
    process.env.GITHUB_ACTIONS = "true";
    runFailingProperty();
    expect(annotationLine()).toBeUndefined();
  });

  it("does not emit on a passing property", () => {
    process.env.FUZZ_CI_ANNOTATIONS = "github";
    assertProperty(
      "ci-annot/always-true",
      fc.property(fc.integer(), () => true),
      { seed: 1, numRuns: 5 },
    );
    expect(annotationLine()).toBeUndefined();
  });

  it("encodes % and CR in the counterexample body", () => {
    process.env.FUZZ_CI_ANNOTATIONS = "github";
    // Force a counterexample containing a percent + CR so we can assert
    // encoding rather than trusting the escape table alone. The property
    // always fails, and fast-check shrinks toward the empty/simple case;
    // we make the failure MESSAGE include the raw characters by throwing
    // an Error that contains them.
    expect(() =>
      assertProperty(
        "ci-annot/percent-cr",
        fc.property(fc.constant("x"), () => {
          throw new Error("has %25 and \r inside");
        }),
        { seed: 7, numRuns: 1 },
      ),
    ).toThrow();
    const line = annotationLine();
    expect(line).toBeDefined();
    // Raw `%` in the source error becomes `%25` on the wire; raw CR
    // becomes `%0D`. Neither should appear literally.
    expect(line!).not.toMatch(/\r/);
    expect(line!).toMatch(/%2525/); // the literal "%25" in the source, re-encoded
    expect(line!).toMatch(/%0D/);
  });
});
