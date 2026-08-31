
-- Masking helpers -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_cnic(v text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN v IS NULL OR length(v) = 0 THEN NULL
    WHEN length(regexp_replace(v, '\D', '', 'g')) >= 4
      THEN '•••••-•••••••-' || right(regexp_replace(v, '\D', '', 'g'), 1)
    ELSE '•••••'
  END
$$;

CREATE OR REPLACE FUNCTION public.mask_mobile(v text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN v IS NULL OR length(v) = 0 THEN NULL
    WHEN length(regexp_replace(v, '\D', '', 'g')) >= 4
      THEN left(regexp_replace(v, '\D', '', 'g'), 4) || '-•••••' ||
           right(regexp_replace(v, '\D', '', 'g'), 2)
    ELSE '•••••'
  END
$$;

CREATE OR REPLACE FUNCTION public.mask_name(v text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN v IS NULL OR length(trim(v)) = 0 THEN NULL
    ELSE upper(left(trim(v), 1)) || '. ' ||
         COALESCE(NULLIF(split_part(trim(v), ' ', 2), ''), '•••')
  END
$$;

CREATE OR REPLACE FUNCTION public.mask_address(v text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN v IS NULL OR length(trim(v)) = 0 THEN NULL
    ELSE '••• ' || COALESCE(NULLIF(regexp_replace(v, '.*,\s*', ''), ''), 'Undisclosed')
  END
$$;

-- Masked bookings view ------------------------------------------------------
-- SECURITY INVOKER=false (default): runs as owner (postgres) which bypasses
-- RLS on underlying tables, then we gate access via GRANT to authenticated.
CREATE OR REPLACE VIEW public.bookings_public
WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  b.booking_id,
  b.booking_date,
  b.project_code,
  b.project_name,
  b.unit_id,
  b.client_ref,
  public.mask_name(b.client_name)     AS client_name_masked,
  public.mask_cnic(b.cnic)            AS cnic_masked,
  public.mask_mobile(b.mobile)        AS mobile_masked,
  public.mask_address(b.address)      AS address_masked,
  b.unit_type,
  b.floor,
  b.size_sqft,
  b.booking_status,
  b.risk_level,
  b.total_contract_value,
  b.remaining_balance,
  b.current_overdue_count,
  b.total_overdue_amount,
  b.oldest_overdue_date,
  b.created_at,
  b.updated_at
FROM public.bookings b;

-- Masked payments view ------------------------------------------------------
CREATE OR REPLACE VIEW public.payments_public
WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  p.receipt_no,
  p.payment_date,
  p.booking_id,
  public.mask_name(p.client_name)     AS client_name_masked,
  public.mask_cnic(p.cnic)            AS cnic_masked,
  p.project,
  p.unit_no,
  p.payment_head,
  p.payment_mode,
  p.amount,
  p.status,
  p.created_at,
  p.updated_at
FROM public.payments p;

-- Masked clients view -------------------------------------------------------
CREATE OR REPLACE VIEW public.clients_public
WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  c.client_ref,
  public.mask_name(c.name)            AS name_masked,
  public.mask_cnic(c.cnic)            AS cnic_masked,
  public.mask_mobile(c.mobile)        AS mobile_masked,
  public.mask_address(c.address)      AS address_masked,
  c.created_at,
  c.updated_at
FROM public.clients c;

-- Grants --------------------------------------------------------------------
-- Every authenticated user (including viewers/unassigned) may read the
-- masked views. Writers already have direct access to the underlying
-- tables via existing RLS policies, so no additional grants are needed
-- for them. The anon role is intentionally NOT granted.
REVOKE ALL ON public.bookings_public FROM PUBLIC, anon;
REVOKE ALL ON public.payments_public FROM PUBLIC, anon;
REVOKE ALL ON public.clients_public  FROM PUBLIC, anon;

GRANT SELECT ON public.bookings_public TO authenticated;
GRANT SELECT ON public.payments_public TO authenticated;
GRANT SELECT ON public.clients_public  TO authenticated;

GRANT SELECT ON public.bookings_public TO service_role;
GRANT SELECT ON public.payments_public TO service_role;
GRANT SELECT ON public.clients_public  TO service_role;

COMMENT ON VIEW public.bookings_public IS
  'Masked, viewer-safe projection of public.bookings. CNIC, mobile, full name and address are irreversibly obscured. Financial totals (contract value, overdue amount) are exposed for operational visibility. Available to all authenticated roles.';
COMMENT ON VIEW public.payments_public IS
  'Masked, viewer-safe projection of public.payments. CNIC and full client name are obscured; cheque numbers, memo, remarks, account, safe_cash_amount and posted_by are excluded entirely.';
COMMENT ON VIEW public.clients_public IS
  'Masked, viewer-safe projection of public.clients. Name/CNIC/mobile/address are irreversibly obscured.';
