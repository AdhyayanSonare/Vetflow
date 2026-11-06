-- Vetflow schema v1: tenancy, accounts, audit, clinical, inventory.
-- Applied migrations are immutable. Fix forward with a new file.
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid not null references branches(id),
  name text not null,
  unique (branch_id, name)
);

-- A store is any stock location: central store, branch store or department store.
create table stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  department_id uuid references departments(id),
  kind text not null check (kind in ('central','branch','department')),
  name text not null,
  active boolean not null default true,
  unique (tenant_id, name)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  email text not null,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('admin','inventory_manager','pharmacist','vet','viewer')),
  active boolean not null default true,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);
create unique index users_email_global on users (lower(email));

create table user_branches (
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  primary key (user_id, branch_id)
);

create table sessions (
  id text primary key,
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id) on delete cascade,
  csrf_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table password_resets (
  token_hash text primary key,
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table tenant_settings (
  tenant_id uuid primary key references tenants(id),
  voice_enabled boolean not null default true,
  barcode_enabled boolean not null default false,
  allow_negative_override boolean not null default false,
  expiry_alert_days int[] not null default '{90,60,30}',
  transcript_retention_days int not null default 365,
  keep_audio boolean not null default false,
  asr_default_language text not null default 'en'
);

create table subscriptions (
  tenant_id uuid primary key references tenants(id),
  plan text not null default 'standard',
  billing_period text not null default 'monthly' check (billing_period in ('monthly','quarterly')),
  next_invoice_date date
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  filename text not null,
  content_type text not null,
  size_bytes int not null,
  data bytea not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  number text not null,
  period_start date not null,
  period_end date not null,
  amount_paise bigint not null check (amount_paise >= 0),
  pdf_attachment_id uuid references attachments(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, number)
);

create table audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id),
  at timestamptz not null default now(),
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text
);
create index audit_tenant_at on audit_log (tenant_id, at desc);

-- Clinical ---------------------------------------------------------------
create table owners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now()
);

create sequence animal_seq;
create table animals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  owner_id uuid not null references owners(id),
  code text not null default ('VET-' || to_char(now(),'YYYY') || '-' || lpad(nextval('animal_seq')::text, 5, '0')),
  name text not null,
  species text not null,
  breed text,
  sex text,
  dob date,
  weight_kg numeric(7,2),
  colour text,
  microchip text,
  allergies text,
  conditions text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index animals_name_trgm on animals using gin (name gin_trgm_ops);

create table consultations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  branch_id uuid references branches(id),
  animal_id uuid not null references animals(id),
  vet_id uuid not null references users(id),
  status text not null default 'draft' check (status in ('draft','completed')),
  complaint text,
  history text,
  temperature_f numeric(4,1),
  examination text,
  diagnosis text,
  treatment_plan text,
  follow_up_date date,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index consultations_animal on consultations (tenant_id, animal_id, started_at desc);

create table transcripts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  consultation_id uuid not null references consultations(id) on delete cascade,
  language text not null,
  provider text not null,
  text text not null,
  segments jsonb,
  confidence real,
  created_at timestamptz not null default now()
);

create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  consultation_id uuid not null references consultations(id),
  animal_id uuid not null references animals(id),
  status text not null default 'draft' check (status in ('draft','approved','cancelled')),
  source text not null default 'manual' check (source in ('manual','voice')),
  approved_by uuid references users(id),
  approved_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table prescription_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  prescription_id uuid not null references prescriptions(id) on delete cascade,
  item_id uuid,
  drug_text text not null,
  dose text, route text, frequency text, duration text,
  quantity numeric(14,3),
  unmatched boolean not null default false
);

-- Inventory ----------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  unique (tenant_id, name)
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  contact_name text, phone text, email text, address text,
  gstin text,
  payment_terms text,
  outstanding_paise bigint not null default 0,
  active boolean not null default true,
  unique (tenant_id, name)
);

create sequence item_seq;
create table items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  code text not null default ('ITM-' || lpad(nextval('item_seq')::text, 6, '0')),
  category_id uuid references categories(id),
  generic_name text not null,
  brand_name text,
  strength text,
  unit text not null,
  manufacturer text,
  default_supplier_id uuid references suppliers(id),
  min_qty numeric(14,3) not null default 0,
  reorder_qty numeric(14,3) not null default 0,
  storage_location text,
  barcode text,
  multi_dose boolean not null default false,
  dose_volume_ml numeric(10,3),
  beyond_use_days int,
  controlled boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index items_generic_trgm on items using gin (generic_name gin_trgm_ops);
create index items_brand_trgm on items using gin (brand_name gin_trgm_ops);
create unique index items_barcode_uq on items (tenant_id, barcode) where barcode is not null;

create table batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  item_id uuid not null references items(id),
  batch_no text not null,
  expiry_date date not null,
  mfg_date date,
  unit_cost_paise bigint not null default 0 check (unit_cost_paise >= 0),
  supplier_id uuid references suppliers(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, item_id, batch_no, expiry_date)
);

create table purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  supplier_id uuid not null references suppliers(id),
  store_id uuid not null references stores(id),
  invoice_no text,
  invoice_date date,
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  tax_paise bigint not null default 0,
  discount_paise bigint not null default 0,
  attachment_id uuid references attachments(id),
  created_by uuid references users(id),
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  receipt_id uuid not null references purchase_receipts(id) on delete cascade,
  item_id uuid not null references items(id),
  batch_no text not null,
  expiry_date date not null,
  mfg_date date,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost_paise bigint not null check (unit_cost_paise >= 0)
);

create table stock_balances (
  tenant_id uuid not null references tenants(id),
  item_id uuid not null references items(id),
  batch_id uuid not null references batches(id),
  store_id uuid not null references stores(id),
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  primary key (batch_id, store_id)
);
create index balances_item on stock_balances (tenant_id, item_id, store_id);

-- quantity is always positive. The type and the from/to stores give the direction.
create table stock_ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id),
  at timestamptz not null default now(),
  item_id uuid not null references items(id),
  batch_id uuid not null references batches(id),
  type text not null check (type in (
    'opening','receipt','issue','dispense','transfer_out','transfer_in','return_to_store',
    'return_to_supplier','damage','expiry_writeoff','count_adjustment')),
  quantity numeric(14,3) not null check (quantity <> 0),
  from_store_id uuid references stores(id),
  to_store_id uuid references stores(id),
  user_id uuid references users(id),
  reason text,
  reference text,
  idempotency_key text not null,
  override boolean not null default false,
  unique (tenant_id, idempotency_key)
);
create index ledger_lookup on stock_ledger (tenant_id, item_id, batch_id, at);
create index ledger_stores on stock_ledger (tenant_id, from_store_id, to_store_id, at);

create table dispenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  prescription_id uuid references prescriptions(id),
  animal_id uuid references animals(id),
  counter_reason text,
  department_id uuid references departments(id),
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  created_by uuid references users(id),
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  check (prescription_id is not null or counter_reason is not null)
);

create table dispense_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  dispense_id uuid not null references dispenses(id) on delete cascade,
  item_id uuid not null references items(id),
  batch_id uuid references batches(id),
  quantity numeric(14,3) not null check (quantity > 0)
);

create table transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  from_store_id uuid not null references stores(id),
  to_store_id uuid not null references stores(id),
  status text not null default 'draft' check (status in ('draft','dispatched','received','cancelled')),
  created_by uuid references users(id),
  dispatched_at timestamptz,
  received_at timestamptz,
  received_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (from_store_id <> to_store_id)
);

create table transfer_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  transfer_id uuid not null references transfers(id) on delete cascade,
  item_id uuid not null references items(id),
  batch_id uuid not null references batches(id),
  sent_qty numeric(14,3) not null check (sent_qty > 0),
  received_qty numeric(14,3),
  discrepancy_reason text
);

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  status text not null default 'open' check (status in ('open','posted')),
  created_by uuid references users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create table count_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  count_id uuid not null references stock_counts(id) on delete cascade,
  item_id uuid not null references items(id),
  batch_id uuid not null references batches(id),
  system_qty numeric(14,3) not null,
  counted_qty numeric(14,3) not null,
  reason text
);

create table open_vials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  item_id uuid not null references items(id),
  batch_id uuid not null references batches(id),
  store_id uuid not null references stores(id),
  opened_at timestamptz not null default now(),
  beyond_use_at timestamptz not null,
  volume_ml numeric(10,3) not null,
  remaining_ml numeric(10,3) not null check (remaining_ml >= 0),
  status text not null default 'open' check (status in ('open','empty','discarded'))
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  kind text not null,
  severity text not null default 'info',
  message text not null,
  ref text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- The ledger and audit log are append-only for every role.
create function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger ledger_no_update before update or delete on stock_ledger
  for each row execute function forbid_mutation();
create trigger audit_no_update before update or delete on audit_log
  for each row execute function forbid_mutation();
