
CREATE OR REPLACE FUNCTION public.explain_ai_tool_call_log(p_status text DEFAULT 'all'::text, p_retry text DEFAULT 'all'::text, p_tool_name text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_sort_key text DEFAULT 'time'::text, p_sort_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS SETOF text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sql text;
  v_where text := 'TRUE';
  v_order_col text;
  v_ascending text;
  v_pat text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  p_limit  := GREATEST(1, LEAST(COALESCE(p_limit, 25), 200));
  p_offset := GREATEST(0, COALESCE(p_offset, 0));

  IF p_status = 'success' THEN
    v_where := v_where || ' AND success = TRUE AND in_flight = FALSE';
  ELSIF p_status = 'tool-error' THEN
    v_where := v_where || ' AND success = FALSE AND in_flight = FALSE'
                       || ' AND (gateway_status IS NULL OR gateway_status < 400)';
  ELSIF p_status = 'gateway-error' THEN
    v_where := v_where || ' AND gateway_status >= 400';
  ELSIF p_status = 'all-errors' THEN
    -- Union of tool-error + gateway-error: any terminal row that is
    -- either a non-success OR carries an HTTP >= 400 gateway status.
    v_where := v_where || ' AND in_flight = FALSE'
                       || ' AND (success = FALSE OR gateway_status >= 400)';
  ELSIF p_status = 'in-flight' THEN
    v_where := v_where || ' AND in_flight = TRUE';
  END IF;

  IF p_retry = 'non-primary' THEN
    v_where := v_where || ' AND retry_strategy IS NOT NULL AND retry_strategy <> ''primary''';
  ELSIF p_retry <> 'all' THEN
    v_where := v_where || format(' AND retry_strategy = %L', p_retry);
  END IF;

  IF p_tool_name <> 'all' THEN
    v_where := v_where || format(' AND tool_name = %L', p_tool_name);
  END IF;

  IF length(coalesce(p_search, '')) > 0 THEN
    v_pat := '%' || replace(replace(replace(p_search, ',', ' '), '(', ' '), ')', ' ') || '%';
    v_where := v_where || format(
      ' AND (tool_name ILIKE %L OR error_message ILIKE %L OR retry_strategy ILIKE %L OR gateway_model ILIKE %L)',
      v_pat, v_pat, v_pat, v_pat
    );
  END IF;

  v_order_col := CASE p_sort_key
    WHEN 'status' THEN 'success'
    WHEN 'tool'   THEN 'tool_name'
    ELSE               'created_at'
  END;
  v_ascending := CASE lower(p_sort_dir) WHEN 'asc' THEN 'ASC' ELSE 'DESC' END;

  v_sql := format(
    'SELECT id, created_at, request_id, round, tool_name, tool_args, tool_result,
            success, error_message, duration_ms, gateway_status, gateway_model, retry_strategy,
            in_flight, completed_at
       FROM public.ai_tool_call_log
       WHERE %s
       ORDER BY %I %s NULLS LAST%s, id DESC
       LIMIT %s OFFSET %s',
    v_where,
    v_order_col, v_ascending,
    CASE WHEN v_order_col = 'created_at' THEN '' ELSE ', created_at DESC' END,
    p_limit, p_offset
  );

  RETURN QUERY EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) ' || v_sql;
END;
$function$;
