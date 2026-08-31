CREATE INDEX IF NOT EXISTS idx_rpc_auth_denied_page_path
  ON public.rpc_authorization_denied_log (page_path, occurred_at DESC)
  WHERE page_path IS NOT NULL;

-- rpc_name index already exists as idx_rpc_auth_denied_rpc; ensure a plain
-- rpc_name index is present for equality lookups that don't order by time.
CREATE INDEX IF NOT EXISTS idx_rpc_auth_denied_rpc_name
  ON public.rpc_authorization_denied_log (rpc_name);