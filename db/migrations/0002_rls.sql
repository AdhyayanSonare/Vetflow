-- Row-level security on every tenant-owned table.
-- The app role is not a superuser and does not own the tables, so policies always apply.
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and tb.table_type = 'BASE TABLE'
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  end loop;
end $$;

alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenant_self on tenants
  using (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Login looks a user up by email before the tenant is known. This SECURITY DEFINER
-- function is the only cross-tenant read, and it returns at most one user row.
create function auth_lookup(p_email text)
returns table (id uuid, tenant_id uuid, password_hash text, active boolean, failed_logins int, locked_until timestamptz)
language sql security definer set search_path = public as $$
  select id, tenant_id, password_hash, active, failed_logins, locked_until
  from users where lower(email) = lower(p_email) limit 1
$$;
