CREATE TABLE public.inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code TEXT REFERENCES public.projects(project_code) ON DELETE CASCADE,
  unit_id TEXT REFERENCES public.units(unit_id) ON DELETE CASCADE,
  inspection_date DATE,
  inspector_name TEXT,
  status TEXT DEFAULT 'Scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspections_project ON public.inspections(project_code);
CREATE INDEX idx_inspections_unit ON public.inspections(unit_id);
CREATE INDEX idx_inspections_status ON public.inspections(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspections TO authenticated;
GRANT ALL ON public.inspections TO service_role;

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inspections_read" ON public.inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "inspections_write" ON public.inspections FOR INSERT TO authenticated WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "inspections_update" ON public.inspections FOR UPDATE TO authenticated USING (public.is_writer(auth.uid()));
CREATE POLICY "inspections_delete" ON public.inspections FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER t_inspections_upd BEFORE UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
