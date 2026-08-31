
CREATE TABLE public.import_validation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  file_name text NOT NULL,
  file_size bigint,
  file_hash text,
  file_version text,
  sheets_validated int NOT NULL DEFAULT 0,
  input_rows int NOT NULL DEFAULT 0,
  clean_rows int NOT NULL DEFAULT 0,
  quarantined_rows int NOT NULL DEFAULT 0,
  per_sheet jsonb NOT NULL DEFAULT '[]'::jsonb,
  rule_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text
);

CREATE INDEX idx_ivat_created_at ON public.import_validation_audit (created_at DESC);
CREATE INDEX idx_ivat_created_by ON public.import_validation_audit (created_by);
CREATE INDEX idx_ivat_file_hash ON public.import_validation_audit (file_hash);

GRANT SELECT, INSERT ON public.import_validation_audit TO authenticated;
GRANT ALL ON public.import_validation_audit TO service_role;

ALTER TABLE public.import_validation_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insert own audit" ON public.import_validation_audit
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "read own audit" ON public.import_validation_audit
  FOR SELECT TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "admins and managers read all audit" ON public.import_validation_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));
