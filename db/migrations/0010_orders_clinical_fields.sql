-- Purchase orders with partial receipts, the receipt-to-order link, and the clinical fields
-- that voice extraction fills in.

create sequence po_seq;

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  number text not null default ('PO-' || lpad(nextval('po_seq')::text, 6, '0')),
  supplier_id uuid not null references suppliers(id),
  store_id uuid not null references stores(id),
  status text not null default 'draft' check (status in ('draft','sent','partially_received','received','cancelled')),
  expected_date date,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, number)
);

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  item_id uuid not null references items(id),
  ordered_qty numeric(14,3) not null check (ordered_qty > 0),
  unit_cost_paise bigint not null default 0 check (unit_cost_paise >= 0),
  received_qty numeric(14,3) not null default 0 check (received_qty >= 0)
);
create index po_lines_po on purchase_order_lines (tenant_id, po_id);

alter table purchase_receipts add column po_id uuid references purchase_orders(id);
alter table receipt_lines add column po_line_id uuid references purchase_order_lines(id);

alter table prescription_lines add column instructions text;

alter table consultations add column duration_text text;
alter table consultations add column follow_up_note text;
alter table consultations add column source text not null default 'manual' check (source in ('manual','voice'));

-- Row-level security for the new tables.
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to vetflow_app', t);
  end loop;
end $$;
grant usage, select on sequence po_seq to vetflow_app;

-- Hosted databases (Supabase) can enable row-level security automatically without forcing it.
-- Make sure every tenant table is forced, and has the tenant policy. No privileges are granted here,
-- so the append-only ledger and audit log stay append-only.
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
  end loop;
end $$;
