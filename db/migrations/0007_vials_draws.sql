create table vial_draws (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  vial_id uuid not null references open_vials(id),
  ml numeric(10,3) not null check (ml > 0),
  animal_id uuid references animals(id),
  prescription_id uuid references prescriptions(id),
  user_id uuid references users(id),
  at timestamptz not null default now()
);
create index vial_draws_vial on vial_draws (tenant_id, vial_id, at);

alter table open_vials add column discard_reason text;
alter table open_vials add column discarded_ml numeric(10,3);

-- Every new tenant table gets row-level security and the app role's privileges.
-- Re-use this block in later migrations that add tables.
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
    execute format('grant select, insert, update, delete on %I to vetflow_app', t);
  end loop;
end $$;
