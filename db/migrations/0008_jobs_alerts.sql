-- Background jobs run as the app role and need the list of tenants before any tenant is set.
-- This returns ids only, nothing else.
create function list_tenants() returns table (id uuid)
language sql security definer set search_path = public as $$ select id from tenants $$;
grant execute on function list_tenants() to vetflow_app;

-- One open alert per kind and reference. Re-running a job does not create duplicates.
create unique index alerts_open_unique on alerts (tenant_id, kind, ref) where resolved_at is null and ref is not null;
