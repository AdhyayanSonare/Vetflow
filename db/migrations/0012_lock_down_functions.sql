-- Security review follow-up. By default PostgreSQL lets PUBLIC execute any function. The lookup
-- functions run as their owner and read across tenants (auth_lookup returns password hashes), so only
-- the application role may call them. This matters on hosted databases that expose other roles (for
-- example Supabase's anon role through its Data API).
revoke execute on function auth_lookup(text) from public;
revoke execute on function session_lookup(text) from public;
revoke execute on function reset_lookup(text) from public;
revoke execute on function list_tenants() from public;
revoke execute on function apply_stock_movement(uuid,text,uuid,uuid,numeric,uuid,uuid,uuid,text,text,text,boolean) from public;
revoke execute on function reconcile_balances(uuid) from public;
grant execute on function auth_lookup(text), session_lookup(text), reset_lookup(text), list_tenants(),
  apply_stock_movement(uuid,text,uuid,uuid,numeric,uuid,uuid,uuid,text,text,text,boolean), reconcile_balances(uuid) to vetflow_app;

-- The ledger is written only by apply_stock_movement (a definer function), never by the application role directly.
revoke insert on stock_ledger from vetflow_app;
-- The migration history is not the application's business.
revoke all on schema_migrations from vetflow_app;
