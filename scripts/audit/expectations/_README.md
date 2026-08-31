# Pinned booking expectations

Each `<BOOKING_ID>.json` here is a reconciled snapshot the auditor enforces in
CI. Filenames starting with `_` (e.g. `_template.json`, `_README.md`) are
**templates only** — they are never executed because the
`booking-reconciliation` matrix in `.github/workflows/security.yml` lists
booking IDs explicitly.

## Add a new pinned booking

1. Copy the template:
   ```bash
   cp scripts/audit/expectations/_template.json \
      scripts/audit/expectations/BK-XX-00000.json
   ```
2. Set `booking_id`, `label`, and every value under `expected` (PKR integers).
   Field meanings live in the `_help` block of `_template.json`.
3. Add the new ID to the matrix:
   ```yaml
   # .github/workflows/security.yml — booking-reconciliation job
   matrix:
     booking:
       - BK-MA-00014
       - BK-MA-00015
       - BK-XX-00000 # ← new
   ```
4. Verify locally before pushing:
   ```bash
   node scripts/audit/booking-reconciliation.mjs BK-XX-00000
   ```
   Exit `0` = pinned totals match live ledger and cached `bookings` row.

## Sanity checks the auditor enforces

- `down_payment_paid + installments_paid + possession_paid === cash_received`
- `cash_received + remaining_balance === total_contract_value`
- `current_overdue_count === 0  ⇔  total_overdue_amount === 0`

Any drift fails CI with a per-booking job summary table (expected vs live vs
cached) in the GitHub Actions run page.
