
REVOKE EXECUTE ON FUNCTION public.get_system_date() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_ledger_for_booking(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recompute_all_bookings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.data_health_summary() FROM PUBLIC, anon;

ALTER VIEW public.data_health_issues SET (security_invoker = true);
REVOKE SELECT ON public.data_health_issues FROM anon;
