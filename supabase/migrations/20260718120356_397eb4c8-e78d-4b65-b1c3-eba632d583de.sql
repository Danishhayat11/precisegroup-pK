-- Revoke EXECUTE from anon on SECURITY DEFINER functions that should require authentication.
-- Kept anon-executable intentionally: current_company_id, client_add_note_by_token,
-- client_get_payment_by_token, log_redirect_reason.
REVOKE EXECUTE ON FUNCTION public.admin_create_invitation(text, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_deactivate_company(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_transfer_ownership(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role_in_company(uuid, uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_writer_in_company(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_maintenance_charges(uuid, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalc_maintenance_charge(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.waive_maintenance_charge(text, text) FROM anon;

-- Trigger-only functions: not meant to be called as RPCs. Revoke from anon and authenticated
-- (Postgres still invokes them internally via triggers regardless of EXECUTE grants).
REVOKE EXECUTE ON FUNCTION public.audit_companies_changes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_push_subscriptions_company_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_super_admin_grant() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_company_id_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_adjustments_derive_lossgain() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recalc_maintenance_charge() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sync_booking_adjustment_credit() FROM anon, authenticated;