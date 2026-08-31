
ALTER POLICY pa_delete ON public.payment_allocations TO authenticated;
ALTER POLICY pa_update ON public.payment_allocations TO authenticated;
ALTER POLICY adj_update ON public.adjustments TO authenticated;
ALTER POLICY bookings_update ON public.bookings TO authenticated;
ALTER POLICY led_update ON public.installment_ledger TO authenticated;
ALTER POLICY prh_insert ON public.plan_restructure_history TO authenticated;
ALTER POLICY peh_insert ON public.payment_edit_history TO authenticated;
ALTER POLICY pc_delete ON public.payment_comments TO authenticated;
ALTER POLICY pc_update ON public.payment_comments TO authenticated;
ALTER POLICY pc_insert ON public.payment_comments TO authenticated;
