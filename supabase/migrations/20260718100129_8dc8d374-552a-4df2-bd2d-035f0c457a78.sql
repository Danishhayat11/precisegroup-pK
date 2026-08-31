-- Harden push_subscriptions RLS to enforce tenant scoping in addition to user ownership.
DROP POLICY IF EXISTS "Users read own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users insert own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users update own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users delete own push subscriptions" ON public.push_subscriptions;

CREATE POLICY "Users read own push subscriptions"
  ON public.push_subscriptions
  FOR SELECT
  USING (
    auth.uid() = user_id
    AND company_id = public.current_company_id()
  );

CREATE POLICY "Users insert own push subscriptions"
  ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND company_id = public.current_company_id()
  );

CREATE POLICY "Users update own push subscriptions"
  ON public.push_subscriptions
  FOR UPDATE
  USING (
    auth.uid() = user_id
    AND company_id = public.current_company_id()
  )
  WITH CHECK (
    auth.uid() = user_id
    AND company_id = public.current_company_id()
  );

CREATE POLICY "Users delete own push subscriptions"
  ON public.push_subscriptions
  FOR DELETE
  USING (
    auth.uid() = user_id
    AND company_id = public.current_company_id()
  );