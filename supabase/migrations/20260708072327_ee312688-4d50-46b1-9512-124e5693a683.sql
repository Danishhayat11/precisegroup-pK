REVOKE EXECUTE ON FUNCTION public.reseed_demo_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reseed_demo_data() TO service_role;