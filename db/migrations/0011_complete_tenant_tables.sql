-- Hosted databases (Supabase) can enable row-level security on a new table automatically. When that
-- happens the earlier "tables without RLS" steps skip the table, so it ends up with no tenant policy and
-- no privileges for the app role (vial_draws was affected). This makes every tenant table complete.
-- It is safe to run on any database: it only adds what is missing.
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_isolation') then
      execute format(
        'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    end if;
    -- The ledger and audit log are append-only, and balances change only through apply_stock_movement.
    if t not in ('stock_ledger', 'audit_log', 'stock_balances') then
      execute format('grant select, insert, update, delete on %I to vetflow_app', t);
    end if;
  end loop;
end $$;

grant select, insert on stock_ledger to vetflow_app;
grant select, insert on audit_log to vetflow_app;
grant select on stock_balances to vetflow_app;
grant usage, select on all sequences in schema public to vetflow_app;
