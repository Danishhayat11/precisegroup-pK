# `scripts/audit/tests/_lib/` — shared helpers for audit CLI tests

This directory holds the bash helpers that every `scripts/audit/tests/*.sh`
suite is expected to consume so their CI output stays uniform.

| File                       | Role                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exit-summary.sh`          | Library. Sourced by audit suites to emit the canonical "── Exit-code summary ──" block.                                                                                                                                                                                                                                                         |
| `exit-summary.smoke.sh`    | Smoke test. Exercises `exit-summary.sh` in isolation (no auditor, no psql, no DB) and pins its output contract.                                                                                                                                                                                                                                 |
| `suite-discovery.sh`       | Shared helper that defines what counts as an audit test suite — used by `summary-format.sh` (Layer 2 auto-discovery) and by `cli-contract.sh`'s self-regression assertions.                                                                                                                                                                     |
| `suite-discovery.smoke.sh` | Smoke test for `suite-discovery.sh`. Pins real-tree enumeration, built-in exemptions, sorted output, caller-supplied extra exempts, fixture-tree edge cases (empty dir, `_lib`-only dir, unsorted on-disk creation order, non-`.sh` files), AND that `discover_suites` is safe under `set -u` / `set -euo pipefail` with no positional args.    |
| `bucket-fixtures.sh`       | Reusable generators (`emit_placeholder_only_suite`, `emit_records_only_suite`, `emit_mixed_bucket_suite`, plus the `write_bucket_fixture` convenience wrapper) that emit canonical bucket-shape fixtures consumed by negative / fail-artifact / future regression tests. Single source of truth for the placeholder line and ✓-row body format. |
| `bucket-fixtures.smoke.sh` | Smoke test for `bucket-fixtures.sh`. Pins the emitted byte layout of each shape AND drives every fixture through `summary-format.sh` in an isolated mirror to confirm placeholder-only / records-only pass the validator and mixed buckets are rejected with the documented reason.                                                             |
| `summary-format.meta.sh`   | Meta-test for `summary-format.sh`. Pins canonical render order against `discover_suites` and asserts orchestrators (`run-all.sh`, `summary-format.sh`, `_lib/*`) are never auto-discovered. Lives under `_lib/` so it can't be auto-discovered by the very layer it tests.                                                                      |

## Canonical bucket shapes emitted by `bucket-fixtures.sh`

Reviewers debugging a `summary-format.sh` failure can compare a real
suite's output against the exact byte layout each fixture kind emits.
The placeholder line is defined once as
`BUCKET_PLACEHOLDER_LINE="  (no scenarios exercised this code)"`
(two leading spaces, no trailing punctuation) — every fixture and
validator branch derives from that constant.

### `emit_placeholder_only_suite` — all three buckets empty

Mirrors a suite that sourced `exit-summary.sh` and called
`summary_print 0 1 2` without ever recording a scenario.

```text
── Exit-code summary ──
exit 0 — pass:
  (no scenarios exercised this code)
exit 1 — drift:
  (no scenarios exercised this code)
exit 2 — strict missing pin:
  (no scenarios exercised this code)
```

### `emit_records_only_suite` — every bucket carries a ✓ row

Mirrors a fully exercised suite (e.g. `cli-exit-codes.sh` on a healthy
run). Row bodies use two leading spaces, a `✓` glyph, one space, then
the scenario description verbatim.

```text
── Exit-code summary ──
exit 0 — pass:
  ✓ scenario A — clean pass
exit 1 — drift:
  ✓ scenario B — drift detected
exit 2 — strict missing pin:
  ✓ scenario C — strict missing pin
```

### `emit_mixed_bucket_suite [code]` — contract violation (rejected)

`code` defaults to `1`. The chosen bucket emits its ✓ row **and** the
placeholder line back-to-back; the other two buckets stay records-only.
`summary-format.sh` rejects this shape with
`bucket for exit <code> mixes placeholder + ✓/✗ rows`. Example for
`emit_mixed_bucket_suite 1`:

```text
── Exit-code summary ──
exit 0 — pass:
  ✓ scenario A — clean pass
exit 1 — drift:
  ✓ scenario B — drift detected
  (no scenarios exercised this code)
exit 2 — strict missing pin:
  ✓ scenario C — strict missing pin
```

A `✗` row (failing scenario filed under its `expected` bucket) has the
same shape as a `✓` row with the glyph swapped and a trailing
`(got exit <N>)` suffix — e.g. `  ✗ scenario B — drift detected (got exit 0)`.

### End-to-end example: running `cli-contract.sh` locally

`cli-contract.sh` is the canonical reference suite — it never touches the
DB, so it's the fastest way to see a real `summary_print 0 1 2` render.
Run it directly:

<!-- BEGIN:cli-contract-example-full (auto-generated, do not edit) -->

```bash
$ bash scripts/audit/tests/cli-contract.sh
✓ [1] --help prints usage and exits 0
... (8 scenarios) ...
── Exit-code summary ──
exit 0 — pass / warn-mode:
  ✓ --help prints usage and exits 0
  ✓ -h prints usage and exits 0
exit 1 — drift detected:
  (no scenarios exercised this code)
exit 2 — strict missing pin / invalid args:
  ✓ missing booking id exits 2 with usage
  ✓ invalid booking id format exits 2
  ✓ missing expectations file exits 2 with path hint
  ✓ --booking without value exits 2
  ✓ --expectations without value exits 2
  ✓ unknown flag exits 2
── self-regression: helper delegation + auto-discovery (no EXEMPT) ──
  ✓ [self/1..11] ...
✓ All 19 CLI contract assertions passed.
```

<!-- END:cli-contract-example-full -->

> Regenerate this block with
> `bash scripts/audit/tests/_lib/regenerate-cli-contract-example.sh`
> (or `--check` for a non-mutating drift gate). The same generator also
> rewrites the matching block in `scripts/audit/tests/cli-contract.sh`'s
> header so the two stay byte-for-byte in sync.

What to notice in the snippet:

- The `── Exit-code summary ──` header appears **exactly once**, immediately
  after the per-scenario `✓` rows.
- Buckets render in ascending `0 → 1 → 2` order. The default labels
  (`pass / warn-mode`, `drift detected`, `strict missing pin / invalid args`)
  come from `exit-summary.sh`; suites override them with `summary_set_label`.
- Bucket 1 shows the `  (no scenarios exercised this code)` placeholder
  (two leading spaces, no trailing punctuation) because `cli-contract.sh`
  never drives a drift scenario — exactly the
  `emit_placeholder_only_suite` shape for that one bucket.
- Buckets 0 and 2 render `✓` rows (`  ✓ <desc>` — two leading spaces, glyph,
  one space, verbatim description) — the `emit_records_only_suite` shape.
- `summary-format.sh` enforces this exact byte layout; the same snippet is
  what reviewers should see in the GitHub Actions job summary for any
  passing audit suite.

To run the same gate against every audit suite at once (and reuse the
shared discovery rules), use the orchestrator:

```bash
$ bash scripts/audit/tests/run-all.sh
```

#### Drill-down: bucket 1 placeholder + bucket 2 multi-row invalid-arg fan-out

The most common audit-suite render in practice is "no drift attempted,
several invalid-arg defences" — `cli-contract.sh` is the canonical
example. Slicing the rendered summary down to the bucket block makes
the bucket-1-stays-placeholder / bucket-2-captures-many-rows shape
unmistakable:

```bash
$ bash scripts/audit/tests/cli-contract.sh 2>&1 \
    | sed -n '/── Exit-code summary ──/,/^── self-regression/p' \
    | sed '$d'
── Exit-code summary ──
exit 0 — pass / warn-mode:
  ✓ --help prints usage and exits 0
  ✓ -h prints usage and exits 0
exit 1 — drift detected:
  (no scenarios exercised this code)        ← placeholder, never mixed with ✓/✗
exit 2 — strict missing pin / invalid args:
  ✓ missing booking id exits 2 with usage            ← invalid-arg #1
  ✓ invalid booking id format exits 2                ← invalid-arg #2
  ✓ missing expectations file exits 2 with path hint ← invalid-arg #3
  ✓ --booking without value exits 2                  ← invalid-arg #4
  ✓ --expectations without value exits 2             ← invalid-arg #5
  ✓ unknown flag exits 2                             ← invalid-arg #6
```

Reviewer checklist for this shape:

- **Bucket 1 is exactly one line** — the `  (no scenarios exercised this code)`
  placeholder (two leading spaces, no trailing punctuation). A ✓ or ✗
  row sneaking in here is rejected by `summary-format.sh` with
  `bucket for exit 1 mixes placeholder + ✓/✗ rows` — exactly the
  contract `bucket-fixtures.sh`'s `emit_mixed_bucket_suite` exercises.
- **Bucket 2 carries N ✓ rows in registration order** — one per
  `summary_record 2 2 "<desc>"` call. Adding a 7th invalid-arg
  scenario to `cli-contract.sh` means updating the header's
  "six invalid-arg scenarios" claim, which
  `_lib/cli-contract.docs.sh` pins as a hard drift gate.
- **Buckets 0 and 2 never interleave with bucket 1** — `summary_print 0 1 2`
  emits buckets in ascending order regardless of `summary_record` call
  order, so the placeholder line stays sandwiched between the two
  records-only buckets.

## How `suite-discovery.sh` works

Every tool that needs to answer "which files under `scripts/audit/tests/`
are real test suites?" MUST answer it the same way, or a suite that's
enforced by one tool can be silently skipped by another. `suite-discovery.sh`
centralises that selection rule behind a single function — `discover_suites` —
so the four current consumers (`summary-format.sh` Layer 2 auto-discovery,
`cli-contract.sh` self-regression, `_lib/summary-format.meta.sh` order pin,
`run-all.sh` drift guard) can never disagree on the set.

### Selection rules

`discover_suites` returns one path per line, **sorted in `LC_ALL=C` order**,
**repo-relative** (e.g. `scripts/audit/tests/foo.sh`), with these rules:

1. **`find -maxdepth 1`** — only files directly under `scripts/audit/tests/`
   qualify. Anything under `_lib/` is structurally excluded (defence in
   depth: renaming a `_lib/` helper to look like a suite still keeps it
   out of the set).
2. **`*.sh` only** — non-shell files (`README.md`, `notes.txt`, etc.)
   are silently ignored.
3. **Built-in exemptions** — never returned, even though they live at the
   top level:
   - `scripts/audit/tests/summary-format.sh` — the format guard itself;
     it shells out to every suite and would self-recurse.
   - `scripts/audit/tests/run-all.sh` — the orchestrator; same reason.
4. **Caller-supplied extra exempts** — every positional arg passed to
   `discover_suites` is layered on top of the built-in set. Passing a
   path that doesn't exist (or isn't a suite) is a **silent no-op**,
   not an error — callers can therefore exempt-by-name without first
   stat-checking the path.

### How other scripts MUST source it

```bash
#!/usr/bin/env bash
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # adjust to your script's depth
# shellcheck source=./_lib/suite-discovery.sh
. "$TESTS_DIR/_lib/suite-discovery.sh"

# Enumerate every audit suite (built-in exempts already applied):
while IFS= read -r suite; do
  # $suite is a repo-relative path like "scripts/audit/tests/foo.sh"
  echo "→ $suite"
done < <(discover_suites)

# Or, with a per-tool exemption layered on top:
while IFS= read -r suite; do
  process_one "$suite"
done < <(discover_suites "scripts/audit/tests/long-running-suite.sh")

# Or, narrow to a specific suite or pattern (CI matrix, local dev loop):
discover_suites --suite cli-contract                  # exact basename
discover_suites --suite=cli-exit-codes.sh             # equals form
discover_suites --pattern 'cli-*'                     # bash glob
discover_suites --suite strict-mode --pattern 'cli-*' # union of both
discover_suites --exempt scripts/audit/tests/slow.sh  # flag-form exempt
```

### Optional narrowing flags

`discover_suites` accepts repeatable flags so callers (CI jobs, local
dev loops, the `run-all.sh` runner) can run a subset of suites without
re-implementing the selection rules:

| Flag                 | Repeatable | Value                                                                                                                  | Effect                                                                                                     |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--suite <name>`     | yes        | basename (`foo`), basename.sh (`foo.sh`), or repo-relative path (`scripts/audit/tests/foo.sh`)                         | Narrow to the named suite. Multiple `--suite` flags union.                                                 |
| `--pattern <glob>`   | yes        | bash glob matched against the basename AND the repo-relative path (`cli-*`, `*contract*`, `scripts/audit/tests/cli-*`) | Narrow to suites matching the glob. Quote to stop the caller's shell from expanding it.                    |
| `--exempt <relpath>` | yes        | repo-relative path                                                                                                     | Same as a positional exempt; provided so flag-style call sites read clearly.                               |
| `--`                 | n/a        | —                                                                                                                      | End-of-flags marker. Everything after is treated as a positional exempt path, even if it starts with `--`. |

Filter semantics worth memorising:

- **Filters narrow, never expand.** A `--suite` or `--pattern` that
  matches nothing yields empty output silently — not an error.
- **Exempts always win.** Built-in exempts (`summary-format.sh`,
  `run-all.sh`, anything under `_lib/`) and caller-supplied
  `--exempt` / positional exempts subtract even when the same path
  was named by `--suite`. This keeps the self-recursion guard intact
  no matter what flags a caller passes.
- **Unknown flag → exit 2.** `discover_suites --bogus` writes
  `discover_suites: unknown flag: --bogus` to stderr and returns 2,
  so a typo in a CI invocation fails fast instead of running the
  full suite.

### Sourcing conventions

Every consumer follows these rules:

1. **Source by the canonical path** —
   `. "$TESTS_DIR/_lib/suite-discovery.sh"`. Do NOT copy the
   `find -maxdepth 1` invocation inline; the rules live in one file
   for a reason.

2. **Include the `# shellcheck source=./_lib/suite-discovery.sh`
   directive** above the `.` line so `shellcheck -x` can follow it
   (CI runs shellcheck with `-x` and treats unresolved sources as
   warnings).
3. **Consume via `while IFS= read -r ... done < <(discover_suites ...)`**
   — process substitution keeps the loop in the parent shell so `fail`
   counters and `set -e` semantics behave as expected. Avoid piping
   into `while`, which spawns a subshell and drops mutations on exit.
4. **Layer per-tool exemptions as positional args**, never by editing
   `suite-discovery.sh`'s `_audit_suite_builtin_exempt`. Each call
   site documents WHY a suite is being skipped at the place that
   skips it, which is auditable in code review.
5. **The helper is safe under `set -u` / `set -euo pipefail`** with
   zero extra args — `suite-discovery.smoke.sh` pins this so a future
   refactor that introduces an unguarded `${var}` lookup trips CI
   before any consumer hits it.

### When you change `suite-discovery.sh`

1. Update `suite-discovery.smoke.sh` to pin the new behavior. Every
   selection rule above is covered by an explicit assertion there.
2. Re-read every consumer (`grep -rn 'discover_suites' scripts/audit/`)
   to confirm the new rule doesn't break their assumptions — most
   notably `run-all.sh`'s drift guard, which compares its curated
   `STEPS` array against `discover_suites` output verbatim.
3. Re-run `bash scripts/audit/tests/run-all.sh` locally; it executes
   `suite-discovery.smoke.sh` early (step 2) so a regression fails
   fast before any downstream suite runs.

### Special case: `cli-contract.sh`

`cli-contract.sh` is itself a consumer of `exit-summary.sh`. Its contract:

- MUST `source "$(dirname "$0")/_lib/exit-summary.sh"` via the canonical
  path (no inlined copy of the helper, no shadowing of `summary_init` /
  `summary_record` / `summary_print`).
- MUST render exactly one `── Exit-code summary ──` block via
  `summary_print 0 1 2`, covering all three canonical buckets:
  - **exit 0** — the `--help` / `-h` scenarios (✓ rows).
  - **exit 1** — the `(no scenarios exercised this code)` placeholder
    (this suite never drives drift).
  - **exit 2** — the invalid-arg scenarios (✓ rows).
- MUST be auto-discovered by `summary-format.sh` (i.e. listed by
  `discover_suites`) and MUST NOT appear in that script's `EXEMPT` array.

These guarantees are pinned by the self-regression assertions appended
to `cli-contract.sh` itself; if you change the helper API or the
discovery rules, update those assertions in the same edit.

#### Running the doc-vs-render drift gate locally

`_lib/cli-contract.docs.sh` cross-checks the header comment in
`cli-contract.sh` against what the script actually renders, so a typo
in the contract block (or a silent change in row counts) fails fast
before it ships. Two equivalent ways to run it:

```bash
# 1) Just the doc-vs-render gate — fastest feedback loop while editing
#    cli-contract.sh's header or row count.
bash scripts/audit/tests/_lib/cli-contract.docs.sh
# → "✓ All 14 cli-contract.sh doc-vs-render assertions passed."

# 2) The full local fail-fast runner — invokes the doc gate in lockstep
#    with the rest of the audit-test suites in the same order CI uses.
bash scripts/audit/tests/run-all.sh

# 3) Narrow run-all.sh to just the doc gate via the shared discovery
#    flags (useful in tight edit loops):
bash scripts/audit/tests/run-all.sh --suite cli-contract.docs
```

##### Interpreting failures

Every assertion is numbered (`✓ [N]` / `✗ [N]`) and the script exits 1
with `✗ <fail>/<total> cli-contract.sh doc-vs-render assertion(s) failed.`
The failing assertion number maps directly to the drift that needs
fixing:

| Failing assertion                            | What drifted                                                                                       | Fix                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `[1]` `summary_print 0 1 2` claim            | Header lost the canonical bucket-order line.                                                       | Restore the `summary_print 0 1 2` wording in the contract block.                                               |
| `[2]` bucket 0 → `--help` / `-h`             | Header no longer documents the bucket-0 scenarios.                                                 | Re-add the `--help` / `-h` reference in the contract block.                                                    |
| `[3]` bucket 1 placeholder                   | Header dropped the `(no scenarios exercised this code)` string.                                    | Re-add the placeholder line so reviewers know bucket 1 is intentionally empty.                                 |
| `[4]` bucket 2 → "six invalid-arg scenarios" | Row count changed without updating the prose, **or** the prose changed without updating the count. | Either restore the count to six, or update the header + this README to the new count.                          |
| `[5]` `── Exit-code summary ──` heading      | Header lost the canonical block name.                                                              | Restore the exact heading string (em-dashes included) in the contract block.                                   |
| `[6]` `_lib/exit-summary.sh` source path     | Header no longer references the canonical helper path.                                             | Re-add the `_lib/exit-summary.sh` mention so the source-of-truth pointer stays visible.                        |
| `[7]` script body `summary_print 0 1 2`      | Body call doesn't match the documented invocation.                                                 | Restore the `summary_print 0 1 2` line in `cli-contract.sh`.                                                   |
| `[8]` exactly one summary header rendered    | Script renders zero or multiple headers.                                                           | Most likely cause: `summary_print` was called twice, or the helper wasn't sourced.                             |
| `[9]` rendered buckets `0,1,2` ascending     | A bucket is missing or out of order in the live render.                                            | Match the `summary_print` arglist to `0 1 2`.                                                                  |
| `[10]` bucket 0 has exactly 2 ✓ rows         | `--help` / `-h` rows weren't both recorded.                                                        | Confirm both `summary_record 0 0 "..."` calls still run for the help scenarios.                                |
| `[11]` bucket 0 ✓ rows reference "help"      | Help scenario descriptions changed and no longer contain `help`.                                   | Either keep the word `help` in the descriptions, or relax the assertion.                                       |
| `[12]` bucket 1 placeholder line rendered    | Bucket 1 has no body, or the wrong body.                                                           | Ensure `summary_print 0 1 2` still includes `1` — the helper auto-emits the placeholder for unused codes.      |
| `[13]` bucket 1 has no ✓/✗ rows              | Something recorded a row under exit 1 (mixed-bucket violation).                                    | Remove the stray `summary_record 1 …` call; this suite never drives drift.                                     |
| `[14]` bucket 2 has exactly 6 ✓ rows         | Invalid-arg scenario count drifted from six.                                                       | Update both the header's "six invalid-arg scenarios" claim **and** assertion `[14]`'s expected count together. |

Two common workflow gotchas:

- **Adding a new invalid-arg scenario** to `cli-contract.sh` will trip
  `[4]` and `[14]` simultaneously. Update both in the same commit: the
  header's "six" → "seven" prose AND `cli-contract.docs.sh`'s expected
  ✓-row count. The README's drill-down example
  (bucket 2 multi-row fan-out) should be updated to match.
- **Renaming the canonical heading** (e.g. swapping em-dashes) trips
  `[5]` and `[8]` together. The string must stay byte-identical
  because `summary-format.sh` greps for it with `grep -F` — keep the
  header text in sync across `exit-summary.sh`, this README, and any
  CI job-summary excerpts.

A non-zero exit from `cli-contract.docs.sh` is **always** a hard CI
failure (`.github/workflows/security.yml` → step
`Verify cli-contract.sh docs match rendered bucket layout`) — do not
disable it as a workaround; fix the drift instead.

## How audit tests consume `exit-summary.sh`

Each suite under `scripts/audit/tests/` (e.g. `cli-exit-codes.sh`,
`strict-mode.sh`, `branch-escalate.sh`, `required-args-and-db.sh`) follows
the same shape:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib/exit-summary.sh"

summary_init                       # mktemp + EXIT trap; composes with caller traps

# Optional: override a heading. Use when the suite is exit-code-specific
# (e.g. branch-escalate.sh annotates exit 1 as "drift / strict-on-default
# branch escalation"). See scripts/audit/README.md → "CI interpretation"
# for the canonical wording.
summary_set_label 1 "exit 1 — drift / strict-on-default-branch escalation"

# For every scenario the suite runs:
#   expected = the exit code the scenario was designed to assert
#   actual   = the exit code the auditor actually produced
# summary_record files passing rows under `actual` and failing rows under
# `expected` so the printed table still reflects which contract row broke.
summary_record "$expected" "$actual" "human-readable scenario description"

# At the end of the suite, render the buckets in display order.
# Pass the codes the suite exercises; defaults to `0 1 2` when omitted.
summary_print 0 1 2
```

### Rules the suites MUST follow

1. **Always source the helper** — never hand-roll the summary block. The
   CI guard `summary-format.sh` (Layer 2 auto-discovery) fails the
   workflow when a new suite forgets the header or grouping.
2. **Call `summary_init` before any `summary_record`.** The helper aborts
   loudly otherwise.
3. **Pass `expected` first, `actual` second** to `summary_record`. The
   contract is "file the row under the bucket it was supposed to cover,
   not the one it actually hit." Tests and reviewers rely on this when
   asking "which scenario produced exit N?".
4. **Always cover the canonical `0 1 2` buckets** in `summary_print`, even
   if the suite only exercises some of them. `summary-format.sh`'s Layer 2
   auto-discovery treats a missing 0, 1, or 2 bucket as a contract
   violation: reviewers grepping CI logs need to tell "this suite ran zero
   drift scenarios" (placeholder bucket present) apart from "this suite
   forgot to wire in the helper" (bucket absent). Codes ≥ 3 are
   suite-specific — include them only when relevant (e.g. exit 3 in
   `required-args-and-db.sh`). The auto-discovery layer also enforces that
   placeholder and `✓`/`✗` rows are never mixed inside one bucket.

5. **Use `summary_set_label` only for suite-specific framing.** The
   defaults in `exit-summary.sh` mirror `scripts/audit/README.md`. If you
   change wording here, change it there too.

## How `exit-summary.smoke.sh` validates the helper

The smoke test sources `exit-summary.sh` and invokes it directly — no
auditor, no psql, no DB — so a failure unambiguously points at the
helper, not at a downstream suite. It pins seven scenarios:

| Scenario                             | What it pins                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** — all-pass, default labels     | Header appears exactly once; default `exit 0 / 1 / 2` labels render; `✓` row formatting; buckets emitted in the order passed to `summary_print`.                                                                                                                                                     |
| **B** — failing row attribution      | A row recorded with `expected=1, actual=0` shows up under the **exit 1** bucket as `✗ <desc> (got exit 0)` and does **not** leak into the exit-0 bucket. Empty buckets show `(no scenarios exercised this code)`.                                                                                    |
| **C** — `summary_set_label` override | Override reaches the rendered output; the default heading for that code disappears entirely.                                                                                                                                                                                                         |
| **D** — custom print order           | `summary_print 2 0 1` renders buckets in that exact order.                                                                                                                                                                                                                                           |
| **E** — empty-label override         | Documented `${SUMMARY_LABELS[$code]:-exit $code}` quirk: an empty string is indistinguishable from "unset" and falls back to the generic `exit 1:` heading. Bucket body still renders in 0 → 1 → 2 order, with the fallback heading correctly positioned between the exit-0 and exit-1 rows.         |
| **F** — whitespace-only label        | Three-space label is preserved verbatim with the trailing `:` appended (`   :`) — not trimmed, not collapsed to a bare `:`. Bucket order survives.                                                                                                                                                   |
| **G** — multi-line label             | Label containing an embedded newline renders both lines verbatim on consecutive output lines, with the trailing `:` attached to the **last** line only (the helper does a single `echo "$label:"`, so the first line stays colon-free). Bucket order and row attribution survive across the newline. |

All assertions use whole-line (`assert_line`, `grep -qxF`) or single-line
substring (`assert_contains`, `grep -F`) matchers, plus `awk` for
position-aware checks. Multi-line needles are deliberately avoided —
`grep -F` treats embedded newlines as **alternation**, not as a literal
multi-line match, which would silently pass.

### Running locally

```bash
bash scripts/audit/tests/_lib/exit-summary.smoke.sh
# → "✓ All N exit-summary smoke assertions passed."
```

### CI wiring

`.github/workflows/security.yml` → `audit-cli-contract` job runs the
smoke test **before** `summary-format.sh`, so a helper bug is reported
as such instead of cascading into every consumer suite's format check.
The orchestrator `scripts/audit/tests/run-all.sh` runs the same
ordering for local fail-fast verification.

## When you change `exit-summary.sh`

1. Update the smoke test to pin the new behavior (add a Scenario H+,
   keep the 0 → 1 → 2 ordering invariants intact).
2. Re-read `scripts/audit/README.md` → "CI interpretation" and keep the
   default label wording in sync.
3. Re-run `bash scripts/audit/tests/run-all.sh` locally before pushing.
