# Booking reconciliation CLI

`scripts/audit/booking-reconciliation.mjs` cross-checks a booking's pinned
expectations (under `scripts/audit/expectations/<BOOKING_ID>.json`) against
the live ledger and cached `bookings` row in Lovable Cloud. It exits non-zero
on any mismatch and writes a per-booking section to `$GITHUB_STEP_SUMMARY`
when run in CI.

See `expectations/_README.md` for how to pin a new contract.

## Usage

```bash
node scripts/audit/booking-reconciliation.mjs <BOOKING_ID>
node scripts/audit/booking-reconciliation.mjs --booking <BOOKING_ID>
node scripts/audit/booking-reconciliation.mjs --expectations <path/to/file.json>
node scripts/audit/booking-reconciliation.mjs --list     # or -l
node scripts/audit/booking-reconciliation.mjs --help     # or -h

# Strict mode (default) — missing expectations file exits 2 (hard fail):
node scripts/audit/booking-reconciliation.mjs BK-MA-00014 --strict

# Non-strict mode — missing expectations file exits 0 with a `::warning`:
node scripts/audit/booking-reconciliation.mjs BK-XX-99999 --no-strict
AUDIT_STRICT=0 node scripts/audit/booking-reconciliation.mjs BK-XX-99999
```

### Strict mode (`--strict` / `--no-strict` / `AUDIT_STRICT`)

Controls **only** how a missing `expectations/<BOOKING_ID>.json` is reported.
All other exit-2 conditions (invalid booking ID, malformed JSON, schema
errors, unknown flags) always hard-fail regardless of strict mode.

| Mode                          | Missing expectations file         |
| ----------------------------- | --------------------------------- |
| `--strict` (default)          | Exit `2`, error printed to stderr |
| `--no-strict`                 | Exit `0`, `::warning` printed     |
| `AUDIT_STRICT=0`/`false`/`no` | Same as `--no-strict`             |
| `AUDIT_STRICT=1`/`true`/`yes` | Same as `--strict`                |

Precedence: explicit CLI flag > `AUDIT_STRICT` env var > default (`strict`).

Use `--no-strict` on feature-branch CI so an un-pinned new booking doesn't
block the build; keep `--strict` on `main`/protected branches so every
contract must be pinned before merge.

## Examples

### Valid booking ID (happy path)

Run the auditor against a pinned contract — exits `0` and prints the live
totals table when everything matches:

```bash
$ node scripts/audit/booking-reconciliation.mjs BK-MA-00014
✓ BK-MA-00014 cross-check OK — ledger, cached booking fields, and KPIs all match the pinned reconciliation.
┌─────────┬────────────────────────┬───────────┬───────────┬───────────┐
│ (index) │ field                  │ expected  │ live      │ cached    │
├─────────┼────────────────────────┼───────────┼───────────┼───────────┤
│ 0       │ 'cash_received'        │ 8778000   │ 8778000   │ 8778000   │
│ 1       │ 'remaining_balance'    │ 0         │ 0         │ 0         │
│ 2       │ 'current_overdue_count'│ 0         │ 0         │ 0         │
└─────────┴────────────────────────┴───────────┴───────────┴───────────┘
```

In CI the same run also writes an anchored `## 🧾 Booking BK-MA-00014 — ✅ OK`
section to `$GITHUB_STEP_SUMMARY` with the live totals table.

### Missing expectations file (exit 2, no DB call)

If `scripts/audit/expectations/<BOOKING_ID>.json` does not exist, the CLI
fails fast **before** touching the database and tells you exactly which file
to create:

```bash
$ node scripts/audit/booking-reconciliation.mjs BK-XX-00099
✗ expectations file not found: scripts/audit/expectations/BK-XX-00099.json
  Create scripts/audit/expectations/BK-XX-00099.json or pass --expectations <path>.
  Run with --help for usage and an example snapshot path.
$ echo $?
2
```

Copy `scripts/audit/expectations/_template.json` to that path, fill in the
pinned totals (see `expectations/_README.md`), and re-run.

## Listing pinned bookings

`--list` (alias `-l`) prints every `<BOOKING_ID>.json` under
`scripts/audit/expectations/` (templates prefixed with `_` are skipped) along
with the `label` field — the same set CI can audit. Exits `0` when all files
parse, `1` when any file is malformed or its `booking_id` field disagrees
with the filename (each broken file is marked with `!`), `2` when the
directory is empty.

Requires `SUPABASE_DB_URL` in the environment (Lovable Cloud connection
string) for the live cross-check.

## Booking ID format

IDs must match `^BK-[A-Z]{2,4}-\d{5}$` — a fixed `BK-` prefix, a 2–4 letter
uppercase project/region code, and a 5-digit zero-padded sequence. The CLI
validates the argument before any DB call and rejects lowercase, missing
prefix, or wrong digit count with exit code `2`.

### Matcher examples

These all satisfy the regex and are accepted by the CLI:

```bash
# 2-letter project code (Manal Arcade), sequence 00014
node scripts/audit/booking-reconciliation.mjs BK-MA-00014

# 3-letter project code (e.g. Karachi tower "KHI"), sequence 00007
node scripts/audit/booking-reconciliation.mjs BK-KHI-00007

# 4-letter project code (e.g. "ISBX"), sequence 12345
node scripts/audit/booking-reconciliation.mjs BK-ISBX-12345
```

These are rejected with exit `2` (and no DB call):

```bash
node scripts/audit/booking-reconciliation.mjs bk-ma-00014   # lowercase
node scripts/audit/booking-reconciliation.mjs BK-M-00014    # 1-letter code
node scripts/audit/booking-reconciliation.mjs BK-MANAL-00014 # 5-letter code
node scripts/audit/booking-reconciliation.mjs BK-MA-014     # 3-digit sequence
node scripts/audit/booking-reconciliation.mjs MA-00014      # missing BK- prefix
```

## Exit codes

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| `0`  | Help printed, or live totals match the pinned expectations.                                   |
| `1`  | Live data drifted from the pinned expectations (diff printed).                                |
| `2`  | Usage error — bad/missing ID, missing flag value, unknown flag, or missing expectations file. |

### CI interpretation

CI should treat the three exit codes as distinct signals:

- **`0` → pass.** Live totals match the pinned snapshot. Continue the pipeline.
- **`1` → hard fail.** Real ledger/booking drift. Block the merge and surface
  the diff table from `$GITHUB_STEP_SUMMARY` to the author — do **not**
  downgrade to a warning, since this means the database disagrees with the
  pinned ground truth.
- **`2` → hard fail as a configuration error.** Bad CLI arguments or a missing
  `expectations/<BOOKING_ID>.json`. Treat the same as `1` for build status,
  but the remediation is "fix the matrix entry / pin the contract", not
  "reconcile the data".

- **`3` → infrastructure failure.** `psql` is missing from `PATH` or the
  database is unreachable. The CLI prints `✗ database connection failed
(psql exit N). Set SUPABASE_DB_URL / PGHOST and ensure psql is on PATH.`
  Fail the build (or retry on a transient runner) — the audit did not
  verify the contract, but this is not a data or pin problem.

### Shell snippet (fail on drift, warn on missing pin)

If you want missing-pin runs (exit `2`) to surface as a non-blocking warning
on a feature branch while still hard-failing on real drift (exit `1`), wrap
the call in a shell branch:

```bash
set +e
node scripts/audit/booking-reconciliation.mjs "$BOOKING_ID"
status=$?
set -e

case "$status" in
  0)
    echo "::notice title=Audit OK::$BOOKING_ID matches pinned expectations"
    ;;
  1)
    echo "::error title=Audit drift::$BOOKING_ID live totals differ from pinned snapshot"
    exit 1
    ;;
  2)
    echo "::warning title=Audit not pinned::$BOOKING_ID has no expectations file or bad CLI args"
    # Flip to `exit 1` on protected branches (e.g. main) to require every
    # contract to be pinned before merge.
    ;;
  *)
    echo "::error title=Audit infra failure::$BOOKING_ID exited with $status"
    exit "$status"
    ;;
esac
```

On `main`/protected branches, change the `2)` arm to `exit 1` so that an
un-pinned contract blocks the merge instead of warning. The default matrix
job in `.github/workflows/security.yml` already does the strict variant —
this snippet is for opt-in lenient runs in pre-merge or nightly jobs.

## Missing expectations file

If `scripts/audit/expectations/<BOOKING_ID>.json` does not exist, the CLI
exits `2` **before** touching the database and prints the expected path so
you can copy the template:

```text
✗ Expectations file not found: scripts/audit/expectations/BK-XX-00000.json
  Copy scripts/audit/expectations/_template.json and fill in the pinned totals.
```

Filenames beginning with `_` (e.g. `_template.json`) are templates and are
never executed by the CI matrix.

## Running every pinned booking

- **In CI:** the `booking-reconciliation` matrix in
  `.github/workflows/security.yml` runs one runner per ID (capped by
  `max-parallel`), with `fail-fast: false` so one mismatch never hides
  another.
- **Locally:** `node scripts/audit/run-all-reconciliations.mjs
[--concurrency N]` spawns one child per pinned `expectations/*.json`
  through a worker pool and prints a contiguous block per booking.

## Related scripts

| Script                              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate-expectations.mjs`         | Schema-validates every `expectations/*.json` (no DB needed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `expectations-schema.mjs`           | Zero-dep validator shared by the CLI and the schema gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `run-all-reconciliations.mjs`       | Parallel local runner over every pinned booking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/cli-contract.sh`             | Asserts `--help` exits `0` and invalid args exit `2`. MUST source `tests/_lib/exit-summary.sh` and render one `── Exit-code summary ──` block covering canonical buckets `0 / 1 / 2` — bucket 0 records the two `--help` / `-h` scenarios, bucket 1 renders the `(no scenarios exercised this code)` placeholder (this suite never drives drift), bucket 2 records the six invalid-arg scenarios. The suite's own self-regression assertions verify it stays sourced (not inlined) and is auto-discovered by `summary-format.sh` without an `EXEMPT` entry. |
| `tests/_lib/exit-summary.sh`        | Shared helper every `tests/*.sh` suite sources to emit the canonical `── Exit-code summary ──` block. See `tests/_lib/README.md` for the contract.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tests/summary-format.sh`           | Layer-1 pinned + Layer-2 auto-discovered guard that every audit suite emits the canonical summary block with the documented bucket labels in the documented order.                                                                                                                                                                                                                                                                                                                                                                                          |
| `tests/_lib/summary-format.meta.sh` | Meta-test that pins `summary-format.sh`'s auto-discovery layer: canonical render order matches `discover_suites`, and orchestrators (`run-all.sh`, `summary-format.sh` itself, `_lib/` helpers) stay excluded.                                                                                                                                                                                                                                                                                                                                              |
| `tests/run-all.sh`                  | Single fail-fast entrypoint that invokes every audit test in the canonical order — mirrors the per-step layout of `.github/workflows/security.yml` → `audit-cli-contract`.                                                                                                                                                                                                                                                                                                                                                                                  |
