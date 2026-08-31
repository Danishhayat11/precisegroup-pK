
CREATE OR REPLACE FUNCTION public.trg_recompute_booking_overdue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_booking_overdue();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS payments_recompute_overdue ON public.payments;
CREATE TRIGGER payments_recompute_overdue
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_recompute_booking_overdue();

DROP TRIGGER IF EXISTS ledger_recompute_overdue ON public.installment_ledger;
CREATE TRIGGER ledger_recompute_overdue
AFTER INSERT OR UPDATE OR DELETE ON public.installment_ledger
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_recompute_booking_overdue();
