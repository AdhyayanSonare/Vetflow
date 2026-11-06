-- Application role: no superuser, no BYPASSRLS, not an owner, so RLS always applies.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'vetflow_app') then
    create role vetflow_app login nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

grant usage on schema public to vetflow_app;
grant select, insert, update, delete on all tables in schema public to vetflow_app;
grant usage, select on all sequences in schema public to vetflow_app;
grant execute on function auth_lookup(text) to vetflow_app;

-- The ledger and audit log never allow update or delete, even before the trigger fires.
revoke update, delete on stock_ledger from vetflow_app;
revoke update, delete on audit_log from vetflow_app;
