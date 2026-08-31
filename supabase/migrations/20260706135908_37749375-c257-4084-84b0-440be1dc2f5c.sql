DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='adjustments') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.adjustments';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='units') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.units';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='installment_ledger') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.installment_ledger';
  END IF;
END $$;

ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.adjustments REPLICA IDENTITY FULL;
ALTER TABLE public.units REPLICA IDENTITY FULL;
ALTER TABLE public.installment_ledger REPLICA IDENTITY FULL;