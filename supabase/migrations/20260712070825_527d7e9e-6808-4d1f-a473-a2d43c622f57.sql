
REVOKE EXECUTE ON FUNCTION public.next_adjustment_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_ledger_for_booking_internal(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_adjustment_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_ledger_for_booking_internal(text) TO authenticated, service_role;
