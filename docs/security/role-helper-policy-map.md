# Role-Helper → RLS Policy Map

This checklist maps each role-helper function to **every** RLS policy that
calls it, plus the policies on the same table that intentionally **don't**
gate on it. It is verified against the deployed SQL — see "Verification"
at the bottom to re-run the check.

| Helper      | Signature                                 | Returns                                               |
| ----------- | ----------------------------------------- | ----------------------------------------------------- |
| `has_role`  | `has_role(_user_id uuid, _role app_role)` | `true` if the user has the given role                 |
| `is_writer` | `is_writer(_uid uuid)`                    | `true` if the user has `admin`, `manager`, or `staff` |

Both are `SECURITY DEFINER` with `search_path=public`, EXECUTE granted to
`authenticated` (RLS depends on them being callable by the signed-in user).

---

## `is_writer(auth.uid())` — used by 19 policies

Anyone with `admin` / `manager` / `staff` can write business data.

| Table                | Policy                                 | Cmd    | Clause                 |
| -------------------- | -------------------------------------- | ------ | ---------------------- |
| `adjustments`        | `adj_write`                            | INSERT | `WITH CHECK`           |
| `adjustments`        | `adj_update`                           | UPDATE | `USING`                |
| `bookings`           | `bookings_write`                       | INSERT | `WITH CHECK`           |
| `bookings`           | `bookings_update`                      | UPDATE | `USING`                |
| `clients`            | `clients_write`                        | INSERT | `WITH CHECK`           |
| `clients`            | `clients_update`                       | UPDATE | `USING`                |
| `installment_ledger` | `led_write`                            | INSERT | `WITH CHECK`           |
| `installment_ledger` | `led_update`                           | UPDATE | `USING`                |
| `payments`           | `pay_write`                            | INSERT | `WITH CHECK`           |
| `payments`           | `pay_update`                           | UPDATE | `USING`                |
| `projects`           | `projects_write`                       | INSERT | `WITH CHECK`           |
| `projects`           | `projects_update`                      | UPDATE | `USING`                |
| `units`              | `units_write`                          | INSERT | `WITH CHECK`           |
| `units`              | `units_update`                         | UPDATE | `USING`                |
| `dealers`            | `dealers_write`                        | ALL    | `USING` + `WITH CHECK` |
| `booking_documents`  | `Writers can insert booking documents` | INSERT | `WITH CHECK`           |
| `booking_documents`  | `Writers can update booking documents` | UPDATE | `USING` + `WITH CHECK` |
| `booking_documents`  | `Writers can delete booking documents` | DELETE | `USING`                |

> `dealers` has no admin-only DELETE policy: deletes go through the writer
> ALL policy. Intentional — dealers are reference data, not financial records.

---

## `has_role(auth.uid(), 'admin')` — used by 10 policies

Admin-only destructive or sensitive access.

| Table                | Policy                       | Cmd    | Notes                                                    |
| -------------------- | ---------------------------- | ------ | -------------------------------------------------------- |
| `adjustments`        | `adj_delete`                 | DELETE | admin-only                                               |
| `bookings`           | `bookings_delete`            | DELETE | admin-only                                               |
| `clients`            | `clients_delete`             | DELETE | admin-only                                               |
| `installment_ledger` | `led_delete`                 | DELETE | admin-only                                               |
| `payments`           | `pay_delete`                 | DELETE | admin-only                                               |
| `projects`           | `projects_delete`            | DELETE | admin-only                                               |
| `units`              | `units_delete`               | DELETE | admin-only                                               |
| `app_settings`       | `settings_write`             | ALL    | `USING` + `WITH CHECK` — admins manage app-wide settings |
| `audit_logs`         | `audit_read_admin`           | SELECT | full audit log visibility                                |
| `user_roles`         | `roles_select_self_or_admin` | SELECT | also allows `auth.uid() = user_id`                       |

---

## `has_role(auth.uid(), 'admin' | 'manager')` — used by 2 policies

Manager + admin scope.

| Table        | Policy                          | Cmd    | Notes                                                  |
| ------------ | ------------------------------- | ------ | ------------------------------------------------------ |
| `profiles`   | `profiles_select_self_or_admin` | SELECT | also allows `auth.uid() = id`                          |
| `audit_logs` | `audit_read_booking_docs_admin` | SELECT | restricted to rows where `entity = 'booking_document'` |

> `staff` and `viewer` cannot read other users' profiles or booking-document
> audit rows.

---

## Policies that do **not** call either helper

These are by design — the checklist must stay green even when no helper is invoked.

| Table                                                      | Policy                                | Cmd    | Clause                            | Reason                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------- | ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| All business tables + `app_settings` + `booking_documents` | `*_read` / "Authenticated can read…"  | SELECT | `USING (true)`                    | Every signed-in user is staff (sign-up closed).                                                               |
| `assistant_messages`                                       | `Users read own assistant messages`   | SELECT | `auth.uid() = user_id`            | Per-user chat history.                                                                                        |
| `assistant_messages`                                       | `Users insert own assistant messages` | INSERT | `WITH CHECK auth.uid() = user_id` | Per-user chat history.                                                                                        |
| `assistant_messages`                                       | `Users delete own assistant messages` | DELETE | `auth.uid() = user_id`            | Per-user chat history.                                                                                        |
| `profiles`                                                 | `profiles_update_self`                | UPDATE | `auth.uid() = id`                 | Self-service profile edits.                                                                                   |
| `audit_logs`                                               | `audit_insert_self`                   | INSERT | `WITH CHECK true`                 | Any authenticated session may log.                                                                            |
| `_seed_*` (8 tables)                                       | _(no policies)_                       | —      | —                                 | RLS on + 0 policies = unreachable from the Data API. Reached only by `reseed_demo_data()` (SECURITY DEFINER). |

---

## Tables to re-audit if `disable_signup` is ever turned off

Re-opening sign-up makes "every signed-in user is staff" false. Before flipping
that flag, replace each `USING (true)` SELECT policy below with a role-scoped
predicate (`is_writer(auth.uid())` for working data; `has_role(..., 'admin')`
for sensitive aggregates).

`projects`, `clients`, `units`, `dealers`, `bookings`, `payments`,
`installment_ledger`, `adjustments`, `booking_documents`, `app_settings`.

---

## Verification

Re-run this query and confirm the rows match the **"used by"** tables above.
The expected row count is **30** (19 + 10 + 2 − overlap = 30 unique policies
referencing either helper, including the `auth.uid() OR has_role` composites).

```sql
SELECT tablename, policyname, cmd,
       COALESCE(qual, '')        AS using_clause,
       COALESCE(with_check, '')  AS check_clause
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  (qual       ILIKE '%has_role%' OR qual       ILIKE '%is_writer%'
     OR with_check ILIKE '%has_role%' OR with_check ILIKE '%is_writer%')
ORDER  BY tablename, policyname;
```

And confirm both helpers are still callable by `authenticated`:

```sql
SELECT proname, proacl
FROM   pg_proc
WHERE  pronamespace = 'public'::regnamespace
  AND  proname IN ('has_role', 'is_writer');
-- Expect: acl includes "authenticated=X/postgres" for both.
```

**Last verified:** 2026-06-29 against the deployed schema.
Counts at verification: `is_writer` → 18 policy rows (one `ALL` counts as two
clauses), `has_role` → 12 policy rows.
