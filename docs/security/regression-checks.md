# Security regression checks

CI runs `scripts/security/regression-check.mjs` on every PR and push to `main`
(via `.github/workflows/security.yml`). Each check below corresponds to a
finding that was previously marked **fixed** or **ignored** in the project's
security memory. If any of these assertions fail, the build fails — that is
the regression signal.

When you resolve a new finding, **add a check here**. The rule is: every
finding that ever appeared in `security--get_scan_results` and was closed
must have a corresponding `SEC-xxx` assertion or it doesn't count as fixed.

## Static (source) checks — always run

| ID        | What it asserts                                                                                                                                    | Fails if…                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `SEC-001` | `src/pages/Login.tsx` exposes no self-signup affordance (no `auth.signUp(` call, no `mode === 'signup'`).                                          | Anyone re-introduces a "Create account" UI.                                  |
| `SEC-002` | No file under `src/` calls `supabase.auth.signUp(`.                                                                                                | Self-signup is reintroduced anywhere in the client bundle.                   |
| `SEC-003` | `src/routes/api/ai.ts` validates a Supabase bearer (`getAuthedSupabase` / `requireSupabaseAuth` / `auth.getClaims`) **and** has a `401` code path. | The AI route becomes anonymously callable.                                   |
| `SEC-004` | `src/components/DashboardAI.tsx` (or whichever component owns `/api/ai`) attaches `Authorization: Bearer …`.                                       | The client stops sending the bearer, making the AI route effectively public. |
| `SEC-005` | No route file or `*.functions.ts` module imports `@/integrations/supabase/client.server` at top level.                                             | The service-role client leaks into a client-reachable module graph.          |

## DB checks — run only when `SUPABASE_DB_URL` secret is set

These connect via `psql` using the repo secret `SUPABASE_DB_URL`. They are
skipped (with a log line, not a failure) when the secret is absent — handy for
forks and dependabot PRs where the secret is unavailable.

| ID        | What it asserts                                                                                                                                                                                                                                                                                     | Fails if…                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SEC-100` | No `SECURITY DEFINER` function in schema `public` is `EXECUTE`-able by `anon`, **except** the intentional allowlist (`client_get_payment_by_token`, `client_add_note_by_token`).                                                                                                                    | A migration re-grants anon execute on any other definer.                                                 |
| `SEC-101` | The trigger/maintenance helpers `handle_new_user`, `recompute_booking_overdue`, `trg_recompute_booking_overdue` are **not** callable by `authenticated`.                                                                                                                                            | Someone widens grants on internal helpers.                                                               |
| `SEC-102` | RLS is enabled on **every** table in `public`.                                                                                                                                                                                                                                                      | A new table is added without `ALTER TABLE … ENABLE ROW LEVEL SECURITY`.                                  |
| `SEC-103` | Every row in `public.user_roles` uses one of the four known roles (`admin`, `manager`, `staff`, `viewer`).                                                                                                                                                                                          | The role enum drifts or junk role values are inserted.                                                   |
| `SEC-104` | For **every** `SECURITY DEFINER` function in `public` outside the allowlist above, executing under `SET ROLE anon` reports no EXECUTE privilege. Catches privilege leaks through `PUBLIC`, default privileges, or wider group roles that SEC-100's catalog read can miss.                           | Any non-allowlisted definer becomes anon-callable at runtime.                                            |
| `SEC-105` | The allowlisted client-note RPCs (`client_get_payment_by_token`, `client_add_note_by_token`) are still `EXECUTE`-able by `anon`.                                                                                                                                                                    | The share flow silently breaks because a migration revoked anon EXECUTE.                                 |
| `SEC-106` | Anon (and `PUBLIC`) hold **no** table privileges on the sensitive tables `payments`, `payment_comments`, `payment_allocations`, `installment_ledger`, `bookings`, `clients`, `user_roles`, `profiles`, `audit_logs`.                                                                                | A migration grants anon direct Data-API access to any of them.                                           |
| `SEC-107` | Runtime double-check under `SET ROLE anon`: (a) `client_get_payment_by_token(gen_random_uuid())` returns `NULL`; (b) `SELECT` on `public.payments` is denied; (c) `SELECT` on `public.user_roles` is denied. Skipped with an informational pass when the connecting role is not a member of `anon`. | The runtime posture drifts from the ACL scan (SEC-105/106) even though catalog reads still look correct. |

## Runtime AI auth checks — run only when `AI_TEST_BASE_URL` is set

These hit the live `/api/ai` endpoint over HTTP. The base URL is anything the
job can reach (preview URL, `http://localhost:8080` in dev, the published URL
on a smoke job). `SEC-202` additionally requires `AI_TEST_BEARER` — a valid
Supabase JWT for a real signed-in user.

| ID        | What it asserts                                                                                                                                                                                                                          | Fails if…                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `SEC-200` | `POST /api/ai` with **no** Authorization header returns `401`.                                                                                                                                                                           | The route stops requiring auth.                                                                      |
| `SEC-201` | `POST /api/ai` with a malformed (non-JWT) bearer returns `401`.                                                                                                                                                                          | The route accepts unverified tokens.                                                                 |
| `SEC-202` | `POST /api/ai` with a valid Supabase JWT returns a 2xx (or upstream 402/429).                                                                                                                                                            | The bearer validator rejects legitimate users.                                                       |
| `SEC-203` | `POST /api/ai` with a JWT whose `exp` is in the past returns `401`. The script forges an unsigned JWT-shaped token with `exp = now − 1h` (and `nbf = now − 2h`) so Supabase Auth rejects it on lifetime grounds before the handler runs. | The route accepts expired sessions — a stolen old token would keep working past its lifetime.        |
| `SEC-204` | `POST /api/ai` with a JWT whose `nbf` is in the future returns `401`. Same forgery shape as SEC-203 but with `nbf = now + 1h` / `exp = now + 2h`, asserting not-before semantics are enforced.                                           | The route accepts tokens before they are valid — clock-skew / pre-minted tokens could be used early. |

The same three runtime cases are also implemented as a Playwright spec at
`tests/security/ai-auth.spec.ts` for local interactive runs:

```
bunx playwright test tests/security/ai-auth.spec.ts
```

The spec auto-picks up `LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN` from the
sandbox so `SEC-202` runs without extra setup there.

## Minting `AI_TEST_BEARER` in CI

`AI_TEST_BEARER` is **optional** as a repo secret. When absent, the workflow
runs `scripts/security/mint-test-bearer.mjs` to provision a dedicated CI
test user via the service-role key and sign it in via the publishable key to
get a real Supabase access token. The script masks the token and exports it
to `$GITHUB_ENV` for the smoke + Playwright steps that follow.

Required repo secrets for the mint step to run:

| Secret                      | Where it comes from                                      | Why it's needed                                           |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `SUPABASE_URL`              | Lovable Cloud project URL (`https://<ref>.supabase.co`). | Both the admin and sign-in clients target this project.   |
| `SUPABASE_SERVICE_ROLE_KEY` | Lovable Cloud service-role key (admin).                  | Provisions / updates the CI test user via Auth Admin API. |
| `SUPABASE_PUBLISHABLE_KEY`  | Lovable Cloud publishable (anon) key.                    | Used to call `signInWithPassword` and obtain a real JWT.  |
| `AI_TEST_BASE_URL`          | Deployed app URL (e.g. `https://<project>.lovable.app`). | Target for the smoke probe and Playwright suite.          |

Optional overrides:

| Var                          | Default                     | Purpose                                                   |
| ---------------------------- | --------------------------- | --------------------------------------------------------- |
| `AI_TEST_EMAIL`              | `ai-ci-bearer@precise.test` | Override the CI test user identity.                       |
| `AI_TEST_JWT_LEEWAY_SECONDS` | `60`                        | Skew tolerance used by SEC-214 / SEC-215 boundary checks. |
| `AI_TEST_BEARER`             | _(minted at runtime)_       | Set this to skip the mint step and use a pre-issued JWT.  |

If any of `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
`SUPABASE_PUBLISHABLE_KEY` are missing **and** `AI_TEST_BEARER` is not
pre-set, the mint step is skipped and a `::notice::` annotation in the job
log explains exactly which secret is missing (`set` / `MISSING` per var).

## Dependency audit

`bun audit --prod --severity high --json` runs before the assertion script
and fails the job on any **high** or **critical** advisory in production
dependencies. Dev-only advisories are tolerated to avoid noise from build
tooling.

## Adding a new check

1. Resolve the finding (fix code or schema; call `manage_security_finding`).
2. Add an `SEC-xxx` function to `scripts/security/regression-check.mjs` that
   would have caught it.
3. Add a row to the table above with a one-line description.
4. Run `node scripts/security/regression-check.mjs` locally — it must pass.
5. Open the PR. CI runs the new check on every future change.

## Why this design

- **Scanner output is not stable across runs**, so we don't diff scanner
  results. Instead we encode each closed finding as an explicit assertion
  about the _thing the fix changed_ (a file, a grant, a policy).
- **Static + DB split** keeps PR checks fast (static-only run in <10 s) while
  still catching schema regressions on `main` and on any PR that has access
  to the DB secret.
- **Stable IDs** (`SEC-001`, `SEC-100`, …) survive renames and make failure
  messages directly point at the right row in this table.
