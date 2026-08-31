# Required CI status checks

Branch protection lives in GitHub, not in this repo. This doc records the
**exact status check names** that must be marked required on `main` so that
merges are blocked when the payments schema regression fails.

## Required checks (must all be green to merge)

| Workflow file                                              | Job name                                                      | Status check to require                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `.github/workflows/dashboard-payments-receipt-no.yml`      | `Payments receipt_no regression gate`                         | **`Payments receipt_no regression gate`**                         |
| `.github/workflows/dashboard-payments-receipt-no.yml`      | `Playwright — payments receipt_no`                            | **`Playwright — payments receipt_no`**                            |
| `.github/workflows/supabase-schema.yml` (schema validator) | `Validate .from().select/.eq columns against generated types` | **`Validate .from().select/.eq columns against generated types`** |
| `.github/workflows/security.yml`                           | `Security invariants (CORS + route gating)`                   | **`Security invariants (CORS + route gating)`**                   |

The `regression-gate` job re-emits the receipt_no result as its own status
so a single required check is enough to block on the whole spec (including
retries and the nightly run). The Playwright job is listed too for
redundancy — if the gate is ever removed, the raw spec still blocks merge.

The parallel `other-e2e` shards are intentionally **NOT** required — they
run alongside for speed but must never block merge on the payments contract.

## How to enable (GitHub UI)

1. Repo → **Settings → Branches → Branch protection rules** → edit `main`.
2. Enable **Require status checks to pass before merging**.
3. Enable **Require branches to be up to date before merging**.
4. In the search box, add each check name from the table above exactly as
   shown. GitHub only lists checks that have run at least once — trigger
   the workflow on a throwaway PR first if a name is missing.
5. Save.

## How to enable (GitHub Rulesets — recommended)

The equivalent ruleset config is committed at
[`.github/rulesets/main-required-checks.json`](../../.github/rulesets/main-required-checks.json).
Import it via **Settings → Rules → Rulesets → New ruleset → Import**, or
apply it with the GitHub CLI:

```bash
gh api -X POST repos/:owner/:repo/rulesets \
  --input .github/rulesets/main-required-checks.json
```

## Regression policy

If any required check above fails on a PR:

- **Do not** disable the required status.
- **Do not** merge with admin override unless the failure is a confirmed
  infra flake AND a follow-up PR restoring green is opened immediately.
- Fix forward: reproduce locally with
  `bun run test:dashboard:payments-receipt-no`, patch, re-push.

## Verifying the gate is live

After enabling, open any PR and confirm the "Merge" button is disabled
until the three checks above report success. If the button is enabled
while a required check is still pending or failing, the protection rule
is misconfigured — re-check the exact status names above.
