-- Fix: clients_read previously granted SELECT to every role via
-- has_any_role(), which meant a plain 'viewer' could pull every client's
-- CNIC, mobile and address. Restrict PII reads to admin/manager/staff —
-- the roles that actually process bookings/payments and legitimately
-- need client contact details. Viewers must go through purpose-built
-- aggregated views / RPCs for any client-linked data they need.

DROP POLICY IF EXISTS clients_read ON public.clients;

CREATE POLICY clients_read ON public.clients
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (public.is_writer(auth.uid()));