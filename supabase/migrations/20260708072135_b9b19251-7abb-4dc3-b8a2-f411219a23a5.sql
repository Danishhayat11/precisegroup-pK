-- 1. Tighten UPDATE with a symmetric WITH CHECK so post-update state is
--    still gated by is_writer(). Recreate to add with_check cleanly.
DROP POLICY IF EXISTS "clients_update" ON public.clients;
CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_writer(auth.uid()))
  WITH CHECK (public.is_writer(auth.uid()));

-- 2. Revoke every direct privilege from anon on clients. RLS was already
--    blocking anon reads (no anon policy), but the table-level GRANTs
--    were still permissive — belt-and-braces defense.
REVOKE ALL ON public.clients FROM anon;

-- 3. Reaffirm the correct grants for the authenticated role and
--    service_role, matching the policies exactly.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;