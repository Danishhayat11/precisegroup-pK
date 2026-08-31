
CREATE TABLE public.crm_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  whatsapp TEXT,
  cnic TEXT,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'Walk-in',
  interested_project_code TEXT,
  interested_unit_type TEXT,
  budget_min NUMERIC(14,2),
  budget_max NUMERIC(14,2),
  notes TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  follow_up_date DATE,
  stage TEXT NOT NULL DEFAULT 'New Inquiry',
  stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_booking_id TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_leads_stage_check CHECK (stage IN (
    'New Inquiry','Site Visit Scheduled','Negotiation','Booking Done','Lost'
  ))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_leads TO authenticated;
GRANT ALL ON public.crm_leads TO service_role;

ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view leads"
  ON public.crm_leads FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert leads"
  ON public.crm_leads FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update leads"
  ON public.crm_leads FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete leads"
  ON public.crm_leads FOR DELETE
  TO authenticated
  USING (true);

-- Reuse the shared updated_at trigger function if present, else create it.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Reset stage_entered_at whenever the stage changes.
CREATE OR REPLACE FUNCTION public.crm_leads_stage_stamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_entered_at = now();
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER crm_leads_before_update
  BEFORE UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.crm_leads_stage_stamp();

CREATE INDEX crm_leads_stage_idx ON public.crm_leads(stage);
CREATE INDEX crm_leads_follow_up_idx ON public.crm_leads(follow_up_date);
CREATE INDEX crm_leads_created_at_idx ON public.crm_leads(created_at DESC);
