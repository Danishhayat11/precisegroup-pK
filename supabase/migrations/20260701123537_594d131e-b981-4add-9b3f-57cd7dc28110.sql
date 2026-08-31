
ALTER TABLE public.import_validation_audit
  ADD COLUMN IF NOT EXISTS workbook_path text,
  ADD COLUMN IF NOT EXISTS workbook_content_type text,
  ADD COLUMN IF NOT EXISTS report_path text;

DROP POLICY IF EXISTS "import_artifacts_insert_own" ON storage.objects;
CREATE POLICY "import_artifacts_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'import-artifacts' AND owner = auth.uid());

DROP POLICY IF EXISTS "import_artifacts_select_own_or_admin" ON storage.objects;
CREATE POLICY "import_artifacts_select_own_or_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'import-artifacts'
    AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "import_artifacts_update_own_or_admin" ON storage.objects;
CREATE POLICY "import_artifacts_update_own_or_admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'import-artifacts'
    AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "import_artifacts_delete_own_or_admin" ON storage.objects;
CREATE POLICY "import_artifacts_delete_own_or_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'import-artifacts'
    AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );
