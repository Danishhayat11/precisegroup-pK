-- Tighten multi-tenant RLS: every role-based policy on tenant tables must
-- also filter by company_id = current_company_id(). Postgres OR-combines
-- permissive policies for the same command, so a loose role-only policy
-- currently defeats the sibling _tenant_isolation policy.

DROP POLICY IF EXISTS "adj_delete" ON public.adjustments;
CREATE POLICY "adj_delete" ON public.adjustments AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "adj_update" ON public.adjustments;
CREATE POLICY "adj_update" ON public.adjustments AS PERMISSIVE FOR UPDATE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id()))) WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "adj_write" ON public.adjustments;
CREATE POLICY "adj_write" ON public.adjustments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "adjustments_read" ON public.adjustments;
CREATE POLICY "adjustments_read" ON public.adjustments AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "Admins can read all AI tool call logs" ON public.ai_tool_call_log;
CREATE POLICY "Admins can read all AI tool call logs" ON public.ai_tool_call_log AS PERMISSIVE FOR SELECT TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "settings_read" ON public.app_settings;
CREATE POLICY "settings_read" ON public.app_settings AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "settings_write" ON public.app_settings;
CREATE POLICY "settings_write" ON public.app_settings AS PERMISSIVE FOR ALL TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id()))) WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "audit_read_admin" ON public.audit_logs;
CREATE POLICY "audit_read_admin" ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "audit_read_booking_docs_admin" ON public.audit_logs;
CREATE POLICY "audit_read_booking_docs_admin" ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated USING (((((entity = 'booking_document'::text) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "Reviewed issues are visible to writers" ON public.audit_reviewed_issues;
CREATE POLICY "Reviewed issues are visible to writers" ON public.audit_reviewed_issues AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "Writers can clear reviewed" ON public.audit_reviewed_issues;
CREATE POLICY "Writers can clear reviewed" ON public.audit_reviewed_issues AS PERMISSIVE FOR DELETE TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "Writers can mark reviewed" ON public.audit_reviewed_issues;
CREATE POLICY "Writers can mark reviewed" ON public.audit_reviewed_issues AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "Writers can update reviewed" ON public.audit_reviewed_issues;
CREATE POLICY "Writers can update reviewed" ON public.audit_reviewed_issues AS PERMISSIVE FOR UPDATE TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "Admins can delete booking documents" ON public.booking_documents;
CREATE POLICY "Admins can delete booking documents" ON public.booking_documents AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "Admins can insert booking documents" ON public.booking_documents;
CREATE POLICY "Admins can insert booking documents" ON public.booking_documents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "Admins can update booking documents" ON public.booking_documents;
CREATE POLICY "Admins can update booking documents" ON public.booking_documents AS PERMISSIVE FOR UPDATE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id()))) WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "booking_documents_read" ON public.booking_documents;
CREATE POLICY "booking_documents_read" ON public.booking_documents AS PERMISSIVE FOR SELECT TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR (is_writer(auth.uid()) AND (booking_project_code(booking_id) = active_project_code(auth.uid()))))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "bookings_delete" ON public.bookings;
CREATE POLICY "bookings_delete" ON public.bookings AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "bookings_read" ON public.bookings;
CREATE POLICY "bookings_read" ON public.bookings AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "bookings_update" ON public.bookings;
CREATE POLICY "bookings_update" ON public.bookings AS PERMISSIVE FOR UPDATE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id()))) WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "bookings_write" ON public.bookings;
CREATE POLICY "bookings_write" ON public.bookings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "clients_delete" ON public.clients;
CREATE POLICY "clients_delete" ON public.clients AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "clients_read" ON public.clients;
CREATE POLICY "clients_read" ON public.clients AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "clients_update" ON public.clients;
CREATE POLICY "clients_update" ON public.clients AS PERMISSIVE FOR UPDATE TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "clients_write" ON public.clients;
CREATE POLICY "clients_write" ON public.clients AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "dealers_read" ON public.dealers;
CREATE POLICY "dealers_read" ON public.dealers AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "dealers_write" ON public.dealers;
CREATE POLICY "dealers_write" ON public.dealers AS PERMISSIVE FOR ALL TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_attendance_delete" ON public.hr_attendance;
CREATE POLICY "hr_attendance_delete" ON public.hr_attendance AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_attendance_insert" ON public.hr_attendance;
CREATE POLICY "hr_attendance_insert" ON public.hr_attendance AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_attendance_select" ON public.hr_attendance;
CREATE POLICY "hr_attendance_select" ON public.hr_attendance AS PERMISSIVE FOR SELECT TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'staff'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_attendance_update" ON public.hr_attendance;
CREATE POLICY "hr_attendance_update" ON public.hr_attendance AS PERMISSIVE FOR UPDATE TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id()))) WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_employees_delete" ON public.hr_employees;
CREATE POLICY "hr_employees_delete" ON public.hr_employees AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_employees_insert" ON public.hr_employees;
CREATE POLICY "hr_employees_insert" ON public.hr_employees AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_employees_select" ON public.hr_employees;
CREATE POLICY "hr_employees_select" ON public.hr_employees AS PERMISSIVE FOR SELECT TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_employees_update" ON public.hr_employees;
CREATE POLICY "hr_employees_update" ON public.hr_employees AS PERMISSIVE FOR UPDATE TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id()))) WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_final_settlements_delete" ON public.hr_final_settlements;
CREATE POLICY "hr_final_settlements_delete" ON public.hr_final_settlements AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_final_settlements_insert" ON public.hr_final_settlements;
CREATE POLICY "hr_final_settlements_insert" ON public.hr_final_settlements AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_final_settlements_select" ON public.hr_final_settlements;
CREATE POLICY "hr_final_settlements_select" ON public.hr_final_settlements AS PERMISSIVE FOR SELECT TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'staff'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_final_settlements_update" ON public.hr_final_settlements;
CREATE POLICY "hr_final_settlements_update" ON public.hr_final_settlements AS PERMISSIVE FOR UPDATE TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id()))) WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_payroll_runs_delete" ON public.hr_payroll_runs;
CREATE POLICY "hr_payroll_runs_delete" ON public.hr_payroll_runs AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_payroll_runs_insert" ON public.hr_payroll_runs;
CREATE POLICY "hr_payroll_runs_insert" ON public.hr_payroll_runs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_payroll_runs_select" ON public.hr_payroll_runs;
CREATE POLICY "hr_payroll_runs_select" ON public.hr_payroll_runs AS PERMISSIVE FOR SELECT TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'staff'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_payroll_runs_update" ON public.hr_payroll_runs;
CREATE POLICY "hr_payroll_runs_update" ON public.hr_payroll_runs AS PERMISSIVE FOR UPDATE TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id()))) WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_payslips_delete" ON public.hr_payslips;
CREATE POLICY "hr_payslips_delete" ON public.hr_payslips AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_payslips_insert" ON public.hr_payslips;
CREATE POLICY "hr_payslips_insert" ON public.hr_payslips AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_payslips_select" ON public.hr_payslips;
CREATE POLICY "hr_payslips_select" ON public.hr_payslips AS PERMISSIVE FOR SELECT TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'staff'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "hr_payslips_update" ON public.hr_payslips;
CREATE POLICY "hr_payslips_update" ON public.hr_payslips AS PERMISSIVE FOR UPDATE TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id()))) WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "admins and managers read all audit" ON public.import_validation_audit;
CREATE POLICY "admins and managers read all audit" ON public.import_validation_audit AS PERMISSIVE FOR SELECT TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "led_delete" ON public.installment_ledger;
CREATE POLICY "led_delete" ON public.installment_ledger AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "led_read" ON public.installment_ledger;
CREATE POLICY "led_read" ON public.installment_ledger AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "led_update" ON public.installment_ledger;
CREATE POLICY "led_update" ON public.installment_ledger AS PERMISSIVE FOR UPDATE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id()))) WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "led_write" ON public.installment_ledger;
CREATE POLICY "led_write" ON public.installment_ledger AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "admins delete charges" ON public.maintenance_charges;
CREATE POLICY "admins delete charges" ON public.maintenance_charges AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "roled users read charges" ON public.maintenance_charges;
CREATE POLICY "roled users read charges" ON public.maintenance_charges AS PERMISSIVE FOR SELECT TO authenticated USING (((has_any_role(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "writers manage charges" ON public.maintenance_charges;
CREATE POLICY "writers manage charges" ON public.maintenance_charges AS PERMISSIVE FOR ALL TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "admins delete expenses" ON public.maintenance_expenses;
CREATE POLICY "admins delete expenses" ON public.maintenance_expenses AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "roled users read expenses" ON public.maintenance_expenses;
CREATE POLICY "roled users read expenses" ON public.maintenance_expenses AS PERMISSIVE FOR SELECT TO authenticated USING (((has_any_role(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "writers manage expenses" ON public.maintenance_expenses;
CREATE POLICY "writers manage expenses" ON public.maintenance_expenses AS PERMISSIVE FOR ALL TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "admins delete payments" ON public.maintenance_payments;
CREATE POLICY "admins delete payments" ON public.maintenance_payments AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "roled users read payments" ON public.maintenance_payments;
CREATE POLICY "roled users read payments" ON public.maintenance_payments AS PERMISSIVE FOR SELECT TO authenticated USING (((has_any_role(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "writers manage payments" ON public.maintenance_payments;
CREATE POLICY "writers manage payments" ON public.maintenance_payments AS PERMISSIVE FOR ALL TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "admins delete schedules" ON public.maintenance_schedules;
CREATE POLICY "admins delete schedules" ON public.maintenance_schedules AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "roled users read schedules" ON public.maintenance_schedules;
CREATE POLICY "roled users read schedules" ON public.maintenance_schedules AS PERMISSIVE FOR SELECT TO authenticated USING (((has_any_role(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "writers manage schedules" ON public.maintenance_schedules;
CREATE POLICY "writers manage schedules" ON public.maintenance_schedules AS PERMISSIVE FOR ALL TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "office_expenses_delete" ON public.office_expenses;
CREATE POLICY "office_expenses_delete" ON public.office_expenses AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "office_expenses_insert" ON public.office_expenses;
CREATE POLICY "office_expenses_insert" ON public.office_expenses AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "office_expenses_select" ON public.office_expenses;
CREATE POLICY "office_expenses_select" ON public.office_expenses AS PERMISSIVE FOR SELECT TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'staff'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "office_expenses_update" ON public.office_expenses;
CREATE POLICY "office_expenses_update" ON public.office_expenses AS PERMISSIVE FOR UPDATE TO authenticated USING ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id()))) WITH CHECK ((((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pa_delete" ON public.payment_allocations;
CREATE POLICY "pa_delete" ON public.payment_allocations AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pa_insert" ON public.payment_allocations;
CREATE POLICY "pa_insert" ON public.payment_allocations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pa_read" ON public.payment_allocations;
CREATE POLICY "pa_read" ON public.payment_allocations AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pa_update" ON public.payment_allocations;
CREATE POLICY "pa_update" ON public.payment_allocations AS PERMISSIVE FOR UPDATE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id()))) WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pc_delete" ON public.payment_comments;
CREATE POLICY "pc_delete" ON public.payment_comments AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pc_read" ON public.payment_comments;
CREATE POLICY "pc_read" ON public.payment_comments AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "peh_admin_read" ON public.payment_edit_history;
CREATE POLICY "peh_admin_read" ON public.payment_edit_history AS PERMISSIVE FOR SELECT TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "peh_writers_read" ON public.payment_edit_history;
CREATE POLICY "peh_writers_read" ON public.payment_edit_history AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pmt_delete" ON public.payments;
CREATE POLICY "pmt_delete" ON public.payments AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pmt_read" ON public.payments;
CREATE POLICY "pmt_read" ON public.payments AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pmt_update" ON public.payments;
CREATE POLICY "pmt_update" ON public.payments AS PERMISSIVE FOR UPDATE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id()))) WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pmt_write" ON public.payments;
CREATE POLICY "pmt_write" ON public.payments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "prh_admin_read" ON public.plan_restructure_history;
CREATE POLICY "prh_admin_read" ON public.plan_restructure_history AS PERMISSIVE FOR SELECT TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "prh_writers_read" ON public.plan_restructure_history;
CREATE POLICY "prh_writers_read" ON public.plan_restructure_history AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "projects_read" ON public.projects;
CREATE POLICY "projects_read" ON public.projects AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "projects_write" ON public.projects;
CREATE POLICY "projects_write" ON public.projects AS PERMISSIVE FOR ALL TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "tsl_admin_read" ON public.tenant_scope_logs;
CREATE POLICY "tsl_admin_read" ON public.tenant_scope_logs AS PERMISSIVE FOR SELECT TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "units_delete" ON public.units;
CREATE POLICY "units_delete" ON public.units AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "units_read" ON public.units;
CREATE POLICY "units_read" ON public.units AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "units_update" ON public.units;
CREATE POLICY "units_update" ON public.units AS PERMISSIVE FOR UPDATE TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "units_write" ON public.units;
CREATE POLICY "units_write" ON public.units AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "settings_change_log_read" ON public.settings_change_log;
CREATE POLICY "settings_change_log_read" ON public.settings_change_log AS PERMISSIVE FOR SELECT TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "settings_change_log_write" ON public.settings_change_log;
CREATE POLICY "settings_change_log_write" ON public.settings_change_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "roles_admin_delete" ON public.user_roles;
CREATE POLICY "roles_admin_delete" ON public.user_roles AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "roles_admin_insert" ON public.user_roles;
CREATE POLICY "roles_admin_insert" ON public.user_roles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "roles_admin_update" ON public.user_roles;
CREATE POLICY "roles_admin_update" ON public.user_roles AS PERMISSIVE FOR UPDATE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id()))) WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));