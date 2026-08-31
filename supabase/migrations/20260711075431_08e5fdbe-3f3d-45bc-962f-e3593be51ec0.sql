
CREATE OR REPLACE FUNCTION public.count_rows_by_company(
  _table_name text,
  _company_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _allowed constant text[] := ARRAY[
    'crm_leads',
    'bookings',
    'clients',
    'payments',
    'projects',
    'units',
    'hr_employees',
    'office_expenses',
    'maintenance_charges'
  ];
  _n bigint;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  IF _table_name IS NULL OR NOT (_table_name = ANY(_allowed)) THEN
    RAISE EXCEPTION 'Table % is not allowlisted for count_rows_by_company', _table_name;
  END IF;

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM public.%I WHERE company_id = $1',
    _table_name
  ) INTO _n USING _company_id;

  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.count_rows_by_company(text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.count_rows_by_company(text, uuid) TO authenticated;
