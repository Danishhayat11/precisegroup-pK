DROP POLICY IF EXISTS "Reviewed issues are visible to authenticated users" ON public.audit_reviewed_issues;
CREATE POLICY "Reviewed issues are visible to writers"
  ON public.audit_reviewed_issues
  FOR SELECT TO authenticated
  USING (public.is_writer(auth.uid()));