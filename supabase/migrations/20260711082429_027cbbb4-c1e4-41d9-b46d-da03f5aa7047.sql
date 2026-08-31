-- 1) Drop the 4 legacy permissive policies on crm_leads that bypass tenant isolation.
--    The correctly-scoped `crm_leads_tenant_isolation` (ALL) policy remains and
--    continues to enforce company_id = current_company_id() for every operation.
DROP POLICY IF EXISTS "Authenticated users can view leads"   ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can insert leads" ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can update leads" ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can delete leads" ON public.crm_leads;

-- 2) Add missing status indexes flagged in the perf audit.
CREATE INDEX IF NOT EXISTS installment_ledger_status_idx
  ON public.installment_ledger (status);

CREATE INDEX IF NOT EXISTS maintenance_charges_status_idx
  ON public.maintenance_charges (status);