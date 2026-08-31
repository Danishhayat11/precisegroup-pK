
-- 1. Allow client-authored comments (no auth uid) and remember who wrote it
ALTER TABLE public.payment_comments
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff'
    CHECK (source IN ('staff','client')),
  ADD COLUMN IF NOT EXISTS client_name text;

-- 2. Public share token per payment
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS public_note_token uuid UNIQUE DEFAULT gen_random_uuid();
UPDATE public.payments SET public_note_token = gen_random_uuid()
  WHERE public_note_token IS NULL;

-- 3. Public helper: fetch a minimal payment summary + client-visible notes by token
CREATE OR REPLACE FUNCTION public.client_get_payment_by_token(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay record;
  v_allocs jsonb;
  v_comments jsonb;
BEGIN
  IF _token IS NULL THEN RETURN NULL; END IF;
  SELECT receipt_no, payment_date, amount, payment_mode, payment_head,
         client_name, unit_no, booking_id, cheque_txn_no, remarks
    INTO v_pay
  FROM public.payments WHERE public_note_token = _token;
  IF v_pay.receipt_no IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'head_label', pa.head_label,
      'amount',     pa.amount,
      'particulars',(il.particulars),
      'due_date',   (il.due_date)
    ) ORDER BY il.due_date NULLS LAST), '[]'::jsonb)
    INTO v_allocs
  FROM public.payment_allocations pa
  LEFT JOIN public.installment_ledger il ON il.ledger_id = pa.ledger_id
  WHERE pa.receipt_no = v_pay.receipt_no;

  -- Only expose comments visible to the client: those the client wrote, plus
  -- staff replies that have been resolved (i.e. the outcome).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id, 'body', c.body, 'kind', c.kind, 'status', c.status,
      'source', c.source, 'client_name', c.client_name,
      'created_at', c.created_at, 'resolved_at', c.resolved_at
    ) ORDER BY c.created_at), '[]'::jsonb)
    INTO v_comments
  FROM public.payment_comments c
  WHERE c.payment_receipt_no = v_pay.receipt_no
    AND (c.source = 'client' OR c.status = 'resolved');

  RETURN jsonb_build_object(
    'receipt_no',   v_pay.receipt_no,
    'payment_date', v_pay.payment_date,
    'amount',       v_pay.amount,
    'payment_mode', v_pay.payment_mode,
    'payment_head', v_pay.payment_head,
    'client_name',  v_pay.client_name,
    'unit_no',      v_pay.unit_no,
    'booking_id',   v_pay.booking_id,
    'reference',    v_pay.cheque_txn_no,
    'remarks',      v_pay.remarks,
    'allocations',  v_allocs,
    'notes',        v_comments
  );
END $$;

REVOKE ALL ON FUNCTION public.client_get_payment_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_get_payment_by_token(uuid) TO anon, authenticated;

-- 4. Public helper: client submits a note against a payment token
CREATE OR REPLACE FUNCTION public.client_add_note_by_token(
  _token uuid, _client_name text, _body text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt text;
  v_booking text;
  v_name text := btrim(coalesce(_client_name, ''));
  v_body text := btrim(coalesce(_body, ''));
BEGIN
  IF _token IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'name must be 2 to 100 characters';
  END IF;
  IF length(v_body) < 3 OR length(v_body) > 2000 THEN
    RAISE EXCEPTION 'note must be 3 to 2000 characters';
  END IF;

  SELECT receipt_no, booking_id INTO v_receipt, v_booking
  FROM public.payments WHERE public_note_token = _token;
  IF v_receipt IS NULL THEN RAISE EXCEPTION 'payment not found'; END IF;

  -- Simple abuse guard: max 5 open client notes per payment
  IF (SELECT count(*) FROM public.payment_comments
        WHERE payment_receipt_no = v_receipt
          AND source = 'client' AND status = 'open') >= 5 THEN
    RAISE EXCEPTION 'too many pending notes on this payment';
  END IF;

  INSERT INTO public.payment_comments
    (payment_receipt_no, booking_id, body, kind, status, source, client_name, created_by)
  VALUES
    (v_receipt, v_booking, v_body, 'comment', 'open', 'client', v_name, NULL);

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.client_add_note_by_token(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_add_note_by_token(uuid, text, text) TO anon, authenticated;
