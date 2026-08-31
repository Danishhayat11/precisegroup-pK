# Precise Realtors & Builders ERP

Internal ERP for Manal Arcade — bookings, ledger, payments, adjustments,
documents, and dashboard KPIs. Built on TanStack Start + Lovable Cloud.

## Audit CLI

`scripts/audit/booking-reconciliation.mjs` cross-checks a booking's pinned
expectations (`scripts/audit/expectations/<BOOKING_ID>.json`) against the
live `installment_ledger` rows and the cached `bookings` row. CI runs it
for every pinned contract and fails the build on any mismatch.

**Booking ID format:** `^BK-[A-Z]{2,4}-\d{5}$` — e.g. `BK-MA-00014`,
`BK-MA-00015`. The CLI validates the argument before any DB call.

**Example commands:**

```bash
# Audit a single pinned booking
node scripts/audit/booking-reconciliation.mjs BK-MA-00014

# List every pinned booking under scripts/audit/expectations/
node scripts/audit/booking-reconciliation.mjs --list

# Validate every pinned expectations file (no DB needed)
node scripts/audit/validate-expectations.mjs

# Run every pinned booking locally in parallel
node scripts/audit/run-all-reconciliations.mjs

# Show full usage
node scripts/audit/booking-reconciliation.mjs --help
```

**Key exit codes:**

| Code | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| `0`  | Help/list printed, or live totals match the pinned expectations.          |
| `1`  | Live data drifted from the pinned expectations (diff table printed).      |
| `2`  | Usage error — bad/missing ID, unknown flag, or missing expectations file. |

### CI interpretation

CI should treat the three exit codes as distinct signals:

- **`0` → pass.** Live totals match the pinned snapshot. Continue the pipeline.
- **`1` → hard fail.** Real ledger/booking drift. Block the merge and surface
  the diff table from `$GITHUB_STEP_SUMMARY` to the author — do **not**
  downgrade to a warning, since the database disagrees with the pinned
  ground truth.
- **`2` → hard fail as a configuration error.** Bad CLI arguments or a
  missing `expectations/<BOOKING_ID>.json`. Same build status as `1`, but the
  remediation is "fix the matrix entry / pin the contract", not "reconcile
  the data".

Any other non-zero exit (e.g. `psql` connectivity) is an infrastructure
failure — also fail the build, since the audit could not verify the
contract.

### Shell snippet (fail on drift, warn on missing pin)

To let missing-pin runs (exit `2`) surface as a non-blocking warning on a
feature branch while still hard-failing on real drift (exit `1`):

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

On `main`/protected branches, change the `2)` arm to `exit 1` so an
un-pinned contract blocks the merge instead of warning. The default matrix
job in `.github/workflows/security.yml` already does the strict variant —
this snippet is for opt-in lenient runs in pre-merge or nightly jobs.

### GitHub Actions workflow snippet

Drop this job into a workflow (e.g. `.github/workflows/audit.yml`) to run
the auditor for a matrix of pinned bookings, hard-failing on drift (exit
`1`) and warning on missing pins / bad args (exit `2`) on feature branches
while still hard-failing on `main`:

```yaml
name: Booking reconciliation
on:
  pull_request:
  push:
    branches: [main]

jobs:
  reconcile:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      max-parallel: 10
      matrix:
        booking_id: [BK-MA-00014, BK-MA-00015]
    env:
      SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Validate every pinned expectations file
        run: node scripts/audit/validate-expectations.mjs

      - name: Reconcile ${{ matrix.booking_id }}
        run: |
          set +e
          node scripts/audit/booking-reconciliation.mjs "${{ matrix.booking_id }}"
          status=$?
          set -e

          # On protected branches, treat missing-pin (2) as a hard failure too.
          strict=0
          if [ "${{ github.ref }}" = "refs/heads/main" ]; then
            strict=1
          fi

          case "$status" in
            0)
              echo "::notice title=Audit OK::${{ matrix.booking_id }} matches pinned expectations"
              ;;
            1)
              echo "::error title=Audit drift::${{ matrix.booking_id }} live totals differ from pinned snapshot"
              exit 1
              ;;
            2)
              if [ "$strict" = "1" ]; then
                echo "::error title=Audit not pinned::${{ matrix.booking_id }} has no expectations file or bad CLI args"
                exit 1
              else
                echo "::warning title=Audit not pinned::${{ matrix.booking_id }} has no expectations file or bad CLI args"
              fi
              ;;
            *)
              echo "::error title=Audit infra failure::${{ matrix.booking_id }} exited with $status"
              exit "$status"
              ;;
          esac
```

`fail-fast: false` ensures one mismatched booking never hides another, and
the per-runner `case` keeps the GitHub annotations (`::error` / `::warning`
/ `::notice`) aligned with the exit-code semantics above.

### GitLab CI variant

Equivalent job for GitLab CI/CD — uses a `parallel:matrix` for the pinned
bookings, `allow_failure` with `exit_codes` to treat exit `2` as a
non-blocking warning on feature branches, and a `rules:` override that
escalates exit `2` to a hard failure on the default branch:

```yaml
stages: [audit]

variables:
  SUPABASE_DB_URL: $SUPABASE_DB_URL # set as a masked CI/CD variable

reconcile:
  stage: audit
  image: node:20
  parallel:
    matrix:
      - BOOKING_ID: [BK-MA-00014, BK-MA-00015]
  before_script:
    - node scripts/audit/validate-expectations.mjs
  script:
    - |
      set +e
      node scripts/audit/booking-reconciliation.mjs "$BOOKING_ID"
      status=$?
      set -e

      case "$status" in
        0)
          echo "Audit OK: $BOOKING_ID matches pinned expectations"
          exit 0
          ;;
        1)
          echo "Audit drift: $BOOKING_ID live totals differ from pinned snapshot"
          exit 1
          ;;
        2)
          echo "Audit not pinned: $BOOKING_ID has no expectations file or bad CLI args"
          exit 2
          ;;
        *)
          echo "Audit infra failure: $BOOKING_ID exited with $status"
          exit "$status"
          ;;
      esac
  # Exit 2 = warning (yellow) on feature branches; the rules block below
  # promotes it to a hard failure on the default branch.
  allow_failure:
    exit_codes: [2]
  rules:
    - if: "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH"
      allow_failure: false
    - when: on_success
```

GitLab surfaces `allow_failure: { exit_codes: [2] }` as an orange "passed
with warnings" badge on the pipeline, so a missing pin is visible without
blocking the merge — and the `rules:` override flips it back to a hard
failure on `main`/the default branch, matching the GitHub Actions snippet
above.

See `scripts/audit/README.md` for the full CLI reference and
`scripts/audit/expectations/_README.md` for how to pin a new contract.

## Chart QA export

The `/chart-preview` route can emit a QA report as a PDF plus a
`chart-qa-failures.json` sidecar for bug reports. The sidecar's shape —
including the hard-omission contract for the optional `environment` field
when **Include environment block** is disabled — is documented and
schema-validated:

- Human-readable schema, examples, and consumer guidance:
  [`docs/chart-qa-failures-schema.md`](docs/chart-qa-failures-schema.md)
- Machine-readable JSON Schema (Draft 2020-12):
  [`docs/schemas/chart-qa-failures.schema.json`](docs/schemas/chart-qa-failures.schema.json)
- Consumer migration guide (`"environment" in payload` detection):
  [`docs/chart-qa-failures-migration.md`](docs/chart-qa-failures-migration.md)
- Payload builder + unit/schema tests:
  [`src/lib/chartQaFailuresPayload.ts`](src/lib/chartQaFailuresPayload.ts),
  [`src/lib/__tests__/chartQaFailuresPayload.test.ts`](src/lib/__tests__/chartQaFailuresPayload.test.ts),
  [`src/lib/__tests__/chartQaFailuresPayload.schema.test.ts`](src/lib/__tests__/chartQaFailuresPayload.schema.test.ts)
