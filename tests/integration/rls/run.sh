#!/usr/bin/env bash
# Runs every *.sql RLS regression test in this directory against the
# managed database. Fixtures (a real profile + a foreign company) are
# picked live so tests are self-contained.
#
# Requires managed PG* env vars (PGHOST, PGUSER, PGPASSWORD, PGDATABASE),
# and the connecting role must have permission to `SET ROLE authenticated`
# (Supabase's `postgres` role does).

set -euo pipefail

if [ -z "${PGHOST:-}" ]; then
  echo "PGHOST is not set — managed DB access is unavailable." >&2
  exit 1
fi

# Fixture selection: pick a non-super-admin profile with a company_id and
# a different company as the "foreign" tenant.
read -r TEST_USER_ID HOME_COMPANY_ID <<<"$(psql -tAX -F' ' -c "
  SELECT p.id, p.company_id
    FROM public.profiles p
   WHERE p.company_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = p.id AND ur.role = 'super_admin'
     )
   ORDER BY p.id
   LIMIT 1
")"

FOREIGN_COMPANY_ID="$(psql -tAX -c "
  SELECT id
    FROM public.companies
   WHERE id <> '${HOME_COMPANY_ID}'::uuid
   ORDER BY id
   LIMIT 1
")"

SUPER_ADMIN_ID="$(psql -tAX -c "
  SELECT user_id
    FROM public.user_roles
   WHERE role = 'super_admin'
   ORDER BY user_id
   LIMIT 1
")"

if [ -z "${TEST_USER_ID}" ] || [ -z "${HOME_COMPANY_ID}" ] || [ -z "${FOREIGN_COMPANY_ID}" ] || [ -z "${SUPER_ADMIN_ID}" ]; then
  echo "Could not select fixtures (need >=1 non-super-admin profile with a company, >=2 companies, and >=1 super_admin)." >&2
  echo "Got: user=${TEST_USER_ID} home=${HOME_COMPANY_ID} foreign=${FOREIGN_COMPANY_ID} super=${SUPER_ADMIN_ID}" >&2
  exit 1
fi

echo "Fixtures: user=${TEST_USER_ID} home=${HOME_COMPANY_ID} foreign=${FOREIGN_COMPANY_ID} super=${SUPER_ADMIN_ID}"

DIR="$(dirname "$0")"
FAIL=0
for sql in "$DIR"/*.sql; do
  echo
  echo "=== $(basename "$sql") ==="
  if ! psql -v ON_ERROR_STOP=1 \
      -v "test_user_id=${TEST_USER_ID}" \
      -v "home_company_id=${HOME_COMPANY_ID}" \
      -v "foreign_company_id=${FOREIGN_COMPANY_ID}" \
      -v "super_admin_id=${SUPER_ADMIN_ID}" \
      -f "$sql"; then
    FAIL=1
    echo "FAILED: $(basename "$sql")" >&2
  fi
done

exit "$FAIL"
