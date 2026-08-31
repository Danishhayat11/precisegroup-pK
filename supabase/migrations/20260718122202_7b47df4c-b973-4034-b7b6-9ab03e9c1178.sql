-- Revoke EXECUTE from anon and authenticated on SECURITY DEFINER functions
-- that are NOT intended to be called by end users via the PostgREST Data API.
-- These are only invoked server-side (admin maintenance tasks) or are unused.

REVOKE EXECUTE ON FUNCTION public.data_health_summary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_system_date() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_all_bookings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_maintenance_charge(_charge_id text) FROM PUBLIC, anon, authenticated;

-- Ensure service_role retains access for server-side use
GRANT EXECUTE ON FUNCTION public.data_health_summary() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_system_date() TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_all_bookings() TO service_role;
GRANT EXECUTE ON FUNCTION public.recalc_maintenance_charge(_charge_id text) TO service_role;