
CREATE OR REPLACE FUNCTION public.admin_cleanup_test_tenant(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_primary constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_user_ids uuid[] := '{}';
  v_invitation_ids uuid[] := '{}';
  v_company_name text;
  v_counts jsonb := '{}'::jsonb;
  v_tbl text;
  v_deleted bigint;
  v_tables text[] := ARRAY[
    'adjustments','ai_tool_call_log','app_settings','assistant_messages',
    'audit_logs','audit_reviewed_issues','booking_documents','bookings',
    'clients','construction_costs','construction_project_budgets','crm_leads',
    'dealers','erp_action_log','hr_attendance','hr_employees','hr_final_settlements',
    'hr_payroll_runs','hr_payslips','import_validation_audit','installment_ledger',
    'maintenance_charges','maintenance_expenses','maintenance_payments',
    'maintenance_schedules','office_expenses','payment_allocations',
    'payment_comments','payment_edit_history','payments','plan_restructure_history',
    'projects','tenant_scope_logs','units'
  ];
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF _company_id IS NULL OR _company_id = v_primary THEN
    RAISE EXCEPTION 'refusing to delete primary/seed company' USING ERRCODE='42501';
  END IF;
  IF _company_id = public.current_company_id() THEN
    RAISE EXCEPTION 'refusing to delete your own current company' USING ERRCODE='42501';
  END IF;

  SELECT name INTO v_company_name FROM public.companies WHERE id = _company_id;
  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'company % not found', _company_id USING ERRCODE='22023';
  END IF;

  -- Collect users and invitations belonging to this tenant.
  SELECT COALESCE(array_agg(id), '{}') INTO v_user_ids
    FROM public.profiles WHERE company_id = _company_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_invitation_ids
    FROM public.company_invitations WHERE company_id = _company_id;

  -- Delete tenant-scoped rows across every table with a company_id column.
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format('DELETE FROM public.%I WHERE company_id = $1', v_tbl)
      USING _company_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted > 0 THEN
      v_counts := v_counts || jsonb_build_object(v_tbl, v_deleted);
    END IF;
  END LOOP;

  DELETE FROM public.user_roles WHERE company_id = _company_id;
  DELETE FROM public.company_invitations WHERE company_id = _company_id;
  DELETE FROM public.profiles WHERE company_id = _company_id;
  DELETE FROM public.companies WHERE id = _company_id;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs(actor_id, actor_email, action, entity, entity_id, before, after)
  VALUES (
    v_uid, v_email, 'tenant.cleanup', 'company', _company_id::text,
    jsonb_build_object('company_name', v_company_name),
    jsonb_build_object(
      'deleted_counts', v_counts,
      'user_ids', to_jsonb(v_user_ids),
      'invitation_ids', to_jsonb(v_invitation_ids),
      'at', now()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', _company_id,
    'company_name', v_company_name,
    'user_ids', to_jsonb(v_user_ids),
    'invitation_ids', to_jsonb(v_invitation_ids),
    'deleted_counts', v_counts
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_cleanup_test_tenant(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_test_tenant(uuid) TO authenticated;
