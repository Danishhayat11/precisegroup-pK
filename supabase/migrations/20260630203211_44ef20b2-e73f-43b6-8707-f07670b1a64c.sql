CREATE TABLE public.audit_reviewed_issues (
  issue_id text NOT NULL PRIMARY KEY,
  booking_id text,
  issue_type text,
  reviewed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  note text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_reviewed_issues TO authenticated;
GRANT ALL ON public.audit_reviewed_issues TO service_role;

ALTER TABLE public.audit_reviewed_issues ENABLE ROW LEVEL SECURITY;

-- Anyone signed in (writer or viewer) can see what's been marked reviewed.
CREATE POLICY "Reviewed issues are visible to authenticated users"
  ON public.audit_reviewed_issues FOR SELECT
  TO authenticated
  USING (true);

-- Only writers (admin/manager/staff) may mark/unmark.
CREATE POLICY "Writers can mark reviewed"
  ON public.audit_reviewed_issues FOR INSERT
  TO authenticated
  WITH CHECK (public.is_writer(auth.uid()));

CREATE POLICY "Writers can update reviewed"
  ON public.audit_reviewed_issues FOR UPDATE
  TO authenticated
  USING (public.is_writer(auth.uid()))
  WITH CHECK (public.is_writer(auth.uid()));

CREATE POLICY "Writers can clear reviewed"
  ON public.audit_reviewed_issues FOR DELETE
  TO authenticated
  USING (public.is_writer(auth.uid()));

CREATE INDEX idx_audit_reviewed_booking ON public.audit_reviewed_issues(booking_id);