
DO $$
DECLARE
  t text;
  tabs text[] := ARRAY[
    'bookings','payments','installment_ledger','payment_allocations','payment_comments','payment_edit_history',
    'projects','units','clients','dealers','adjustments','plan_restructure_history','booking_documents',
    'crm_leads','office_expenses','construction_costs','construction_project_budgets',
    'hr_employees','hr_attendance','hr_payroll_runs','hr_payslips','hr_final_settlements',
    'maintenance_schedules','maintenance_charges','maintenance_payments','maintenance_expenses',
    'audit_logs','audit_reviewed_issues','erp_action_log','import_validation_audit',
    'ai_tool_call_log','assistant_messages','app_settings','user_roles'
  ];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN company_id SET DEFAULT public.current_company_id()',
      t
    );
  END LOOP;
END $$;
