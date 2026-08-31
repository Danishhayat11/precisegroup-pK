-- Extend payments.payment_mode CHECK to include "Cheque" and "Online Transfer"
-- which the app UI now surfaces alongside Cash / Bank Transfer / Adjustment/Asset.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_mode_chk;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_mode_chk
  CHECK (payment_mode IN (
    'Cash',
    'Cheque',
    'Online',
    'Online Transfer',
    'Bank Transfer',
    'Rent Adjustment',
    'Adjustment',
    'Adjustment/Asset'
  ));