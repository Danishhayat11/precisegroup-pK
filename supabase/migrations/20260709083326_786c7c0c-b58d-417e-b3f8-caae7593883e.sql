-- 1) Force existing views to run with the querying user's privileges, so
--    they honour RLS on their base tables instead of the view owner's rights.
ALTER VIEW public.bookings_public SET (security_invoker = true);
ALTER VIEW public.clients_public  SET (security_invoker = true);
ALTER VIEW public.payments_public SET (security_invoker = true);

-- 2) Tighten the storage read policy for the booking-documents bucket so it
--    mirrors public.booking_documents_read: only admins and writers assigned
--    to the row's project can download the object. Match objects to rows via
--    file_path.
DROP POLICY IF EXISTS "Authenticated can read booking-documents" ON storage.objects;

CREATE POLICY "Assigned admins or writers can read booking-documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'booking-documents'
  AND EXISTS (
    SELECT 1
    FROM public.booking_documents bd
    WHERE bd.file_path = storage.objects.name
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR (
          public.is_writer(auth.uid())
          AND public.booking_project_code(bd.booking_id) = public.active_project_code(auth.uid())
        )
      )
  )
);