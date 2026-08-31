# RLS integration tests

SQL integration tests that assert Row-Level Security policies deny
cross-tenant writes. Each test wraps its assertions in `BEGIN`/`ROLLBACK`
and never persists data.

## What they cover

- `push_subscriptions_company_scoping.sql` — verifies the fix for the
  `push_subscriptions_missing_company_scoping` security finding:
  `INSERT` and `UPDATE` on `public.push_subscriptions` must reject
  rows whose `company_id` does not match `public.current_company_id()`.
- `companies_isolation.sql` — verifies `public.companies` isolation:
  own row visible, foreign row hidden, INSERT/DELETE denied for
  non-super-admins, UPDATE on a foreign row rejected.
- `tenant_policy_coverage.sql` — catalog-level meta test that fails
  when any tenant-scoped table listed in the suite loses RLS or its
  `company_id`-scoping policy, and asserts `public.companies` still
  has RLS + RESTRICTIVE `INSERT`/`DELETE` policies gated on
  `is_super_admin()` plus the super-admin `ALL` policy.
- `super_admin_admin_workflows_isolation.sql` — asserts that when a
  `super_admin` runs admin-only workflows (`current_company_id`,
  `has_role`, `mark_onboarding_complete`, `admin_create_invitation`,
  `admin_deactivate_company`), all writes remain bound to the caller's
  own tenant and a foreign company's row is never mutated — even though
  the super-admin `ALL` policy grants cross-tenant SELECT.

`run.sh` executes every `*.sql` in this directory against live-picked
fixtures (a real non-super-admin profile + a foreign company).

## Running locally

```bash
bash tests/integration/rls/run.sh
```

Requires managed `PG*` env vars (`PGHOST`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE`) pointing at a role that can `SET ROLE authenticated`.
The managed sandbox exec role is BYPASSRLS and **cannot** switch into
`authenticated`, so this test is designed to run in CI against a
DB connection with the required grant (see the CI workflow) or
against a local Supabase instance where you own `postgres`.

## Assertions

1. INSERT with a foreign `company_id` → denied.
2. INSERT with the user's own `company_id` → allowed (baseline).
3. UPDATE rewriting `company_id` to a foreign tenant → denied
   (raises `check_violation` **or** silently no-ops; both are caught).
4. UPDATE within the user's own `company_id` → allowed (baseline).
