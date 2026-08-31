-- Enforce that Adjustment/Asset payments never contribute to Cash Received.
-- This is the automated guarantee that backs the rule on Dashboard, Booking
-- details, Ledger, and Reports — which all sum `safe_cash_amount`.

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_adjustment_excludes_cash;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_adjustment_excludes_cash
  CHECK (
    CASE
      WHEN payment_mode IN ('Adjustment/Asset', 'Adjustment')
        THEN COALESCE(safe_cash_amount, 0) = 0
             AND COALESCE(cash_bank_include, false) = false
             AND COALESCE(non_cash_adjustment, true)  = true
      ELSE COALESCE(safe_cash_amount, 0) = COALESCE(amount, 0)
             AND COALESCE(cash_bank_include, true)  = true
             AND COALESCE(non_cash_adjustment, false) = false
    END
  );