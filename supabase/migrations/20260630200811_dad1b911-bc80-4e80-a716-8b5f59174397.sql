DROP TRIGGER IF EXISTS ledger_recompute_overdue ON public.installment_ledger;
DROP TRIGGER IF EXISTS payments_recompute_overdue ON public.payments;
-- Drop the now-unused legacy functions (safe: no remaining trigger references)
DROP FUNCTION IF EXISTS public.trg_recompute_booking_overdue() CASCADE;
DROP FUNCTION IF EXISTS public.recompute_booking_overdue() CASCADE;
-- Recompute everything one more time so cached values are authoritative.
SELECT public.recompute_all_bookings();