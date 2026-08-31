/**
 * Regression test for the ignore-with-justification skip loop.
 *
 * Scenario:
 *   1. A synthetic finding is seeded into the local test store.
 *   2. The reviewer ignores it with a substantive justification and the
 *      exported decisions are persisted into the local `security-memory`
 *      mirror (via `recordIgnored`).
 *   3. A page refresh is simulated by rebuilding the merged findings list
 *      from scratch (same call the route makes on mount) — the finding
 *      must come back with `status: "ignored"` and the same justification.
 *   4. The next scan is simulated via `applyIgnoreSkip` — the finding must
 *      disappear from the result set entirely, matching what the real
 *      backend scanner promises once the rule is in security-memory.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { SECURITY_FINDINGS } from "@/lib/security/findings";
import {
  applyIgnoreSkip,
  buildTestFinding,
  clearAllTestState,
  getIgnoredMemory,
  mergeWithSeededFindings,
  recordIgnored,
  saveTestFindings,
} from "@/lib/security/testFindings";

describe("security ignore-with-justification skip loop", () => {
  beforeEach(() => {
    clearAllTestState();
  });

  it("persists the ignore across refresh and drops the rule from the next scan", () => {
    // (1) Seed a synthetic finding — mirrors the reviewer clicking
    // "Seed test finding" in the TestFindingSeeder panel.
    const seeded = buildTestFinding({ id: "TEST_ignore_skip_loop" });
    saveTestFindings([seeded]);

    // Precondition: the seeded finding is present and pending.
    const beforeIgnore = mergeWithSeededFindings(SECURITY_FINDINGS);
    const originalRow = beforeIgnore.find((f) => f.id === seeded.id);
    expect(originalRow).toBeDefined();
    expect(originalRow?.status).toBe("pending");

    // (2) Ignore with a ≥ 20-char justification — this is what the panel
    // writes to security-memory on Export decisions.
    const justification =
      "Synthetic finding intentionally seeded by the security ignore-loop test.";
    recordIgnored(seeded.id, justification);

    // Sanity: memory now holds the rule with its rationale.
    const memory = getIgnoredMemory();
    expect(memory[seeded.id]).toEqual(expect.objectContaining({ justification }));
    expect(memory[seeded.id]?.ignoredAt).toEqual(expect.any(String));

    // (3) Simulate a page refresh — rebuild the merged list from scratch,
    // exactly like the route's initial useState does on mount.
    const afterRefresh = mergeWithSeededFindings(SECURITY_FINDINGS);
    const refreshedRow = afterRefresh.find((f) => f.id === seeded.id);
    expect(refreshedRow).toBeDefined();
    expect(refreshedRow?.status).toBe("ignored");
    expect(refreshedRow?.justification).toBe(justification);

    // (4) Simulate the next scanner run — the rule is in security-memory
    // so it must not reappear in the surfaced findings.
    const nextScan = applyIgnoreSkip(afterRefresh);
    expect(nextScan.find((f) => f.id === seeded.id)).toBeUndefined();

    // And every curated real finding is still passed through untouched,
    // proving the skip filter only removes ignored+justified rules.
    for (const real of SECURITY_FINDINGS) {
      const stillPresent = nextScan.find((f) => f.id === real.id);
      // Real findings not in the local memory should survive the skip.
      if (!memory[real.id]) {
        expect(stillPresent).toBeDefined();
      }
    }
  });

  it("does not skip findings whose justification was never recorded", () => {
    const seeded = buildTestFinding({ id: "TEST_missing_justification" });
    saveTestFindings([seeded]);

    // No recordIgnored call → security-memory stays empty for this id.
    const merged = mergeWithSeededFindings(SECURITY_FINDINGS);
    const nextScan = applyIgnoreSkip(merged);
    const row = nextScan.find((f) => f.id === seeded.id);

    expect(row).toBeDefined();
    expect(row?.status).toBe("pending");
  });
});
