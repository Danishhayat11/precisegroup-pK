
-- Read: signed-in users can view any logo within their company's folder
CREATE POLICY "Company members read their company logo"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

-- Write: admins only, and only in their own company's folder
CREATE POLICY "Admins upload their company logo"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'company-logos'
    AND public.has_role(auth.uid(),'admin')
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

CREATE POLICY "Admins replace their company logo"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND public.has_role(auth.uid(),'admin')
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

CREATE POLICY "Admins delete their company logo"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND public.has_role(auth.uid(),'admin')
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );
