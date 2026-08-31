
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    '_seed_adjustments','_seed_bookings','_seed_clients','_seed_dealers',
    '_seed_installment_ledger','_seed_payments','_seed_projects','_seed_units'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_admin_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''::app_role))',
      t||'_admin_read', t
    );
  END LOOP;
END $$;
