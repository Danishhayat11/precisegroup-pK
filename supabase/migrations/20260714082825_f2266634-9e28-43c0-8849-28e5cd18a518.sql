
CREATE TABLE public.settings_change_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company','project')),
  entity_label TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_settings_change_log_company_created
  ON public.settings_change_log (company_id, created_at DESC);

GRANT SELECT, INSERT ON public.settings_change_log TO authenticated;
GRANT ALL ON public.settings_change_log TO service_role;

ALTER TABLE public.settings_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company's change log"
  ON public.settings_change_log
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Members can insert into their company's change log"
  ON public.settings_change_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    AND (changed_by IS NULL OR changed_by = auth.uid())
  );
