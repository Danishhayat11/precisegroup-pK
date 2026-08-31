
-- 1) booking_documents (public schema) — admin-only writes
DROP POLICY IF EXISTS "Writers can insert booking documents" ON public.booking_documents;
DROP POLICY IF EXISTS "Writers can update booking documents" ON public.booking_documents;
DROP POLICY IF EXISTS "Writers can delete booking documents" ON public.booking_documents;

CREATE POLICY "Admins can insert booking documents"
  ON public.booking_documents FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update booking documents"
  ON public.booking_documents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete booking documents"
  ON public.booking_documents FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) storage.objects for booking-documents bucket — admin-only writes
DROP POLICY IF EXISTS "Writers can upload booking-documents" ON storage.objects;
DROP POLICY IF EXISTS "Writers can update booking-documents" ON storage.objects;
DROP POLICY IF EXISTS "Writers can delete booking-documents" ON storage.objects;

CREATE POLICY "Admins can upload booking-documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'booking-documents' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update booking-documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'booking-documents' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'booking-documents' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete booking-documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'booking-documents' AND public.has_role(auth.uid(), 'admin'::app_role));

-- 3) Server-side admin assertion helper
CREATE OR REPLACE FUNCTION public.assert_admin_access(_scope text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only: %', COALESCE(_scope, 'restricted') USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('ok', true, 'scope', _scope, 'uid', v_uid);
END $$;

REVOKE ALL ON FUNCTION public.assert_admin_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_admin_access(text) TO authenticated;
