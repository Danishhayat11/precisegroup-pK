-- Restrict audit_logs reads for booking documents to admins/managers
DROP POLICY IF EXISTS audit_read_booking_docs ON public.audit_logs;

CREATE POLICY audit_read_booking_docs_admin ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    entity = 'booking_document'
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'manager'::app_role))
  );

-- Lock down admin-only SECURITY DEFINER functions so anon/authenticated
-- cannot call them directly through the API. The internal admin check
-- inside reseed_demo_data already gates usage; this also removes the
-- linter warning. Trigger-only functions don't need EXECUTE for the
-- API roles either.
REVOKE EXECUTE ON FUNCTION public.reseed_demo_data() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reseed_demo_data() TO service_role;
