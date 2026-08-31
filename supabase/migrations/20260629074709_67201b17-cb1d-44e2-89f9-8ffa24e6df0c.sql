
-- Lock down internal/trigger helpers so the Data API cannot invoke them directly.
REVOKE ALL ON FUNCTION public.handle_new_user()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_booking_overdue()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_recompute_booking_overdue()   FROM PUBLIC, anon, authenticated;

-- Admin-only demo reseed: revoke from anon, keep authenticated (function checks has_role internally).
REVOKE ALL ON FUNCTION public.reseed_demo_data() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reseed_demo_data() TO authenticated;

-- Role-check helpers must stay callable by signed-in users (RLS policies depend on them).
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.is_writer(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_writer(uuid) TO authenticated;
