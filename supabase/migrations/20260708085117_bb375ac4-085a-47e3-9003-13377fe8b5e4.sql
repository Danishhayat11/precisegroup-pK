-- INSERT policy: already gated to is_writer via with_check; recreate to
-- normalise roles=authenticated and make the intent explicit.
DROP POLICY IF EXISTS pay_write ON public.payments;
CREATE POLICY pay_write ON public.payments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_writer(auth.uid()));

-- UPDATE policy: was admin-only; broaden to any writer per requirement.
DROP POLICY IF EXISTS pay_update ON public.payments;
CREATE POLICY pay_update ON public.payments
  FOR UPDATE
  TO authenticated
  USING (public.is_writer(auth.uid()))
  WITH CHECK (public.is_writer(auth.uid()));