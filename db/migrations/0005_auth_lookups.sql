-- Session and reset-token lookups happen before the tenant is known. Each function
-- returns at most one row keyed by a secret hash, so it cannot be used to list other tenants.
create function session_lookup(p_id text)
returns table (tenant_id uuid, user_id uuid, csrf_token text, role text, name text, email text, active boolean)
language sql security definer set search_path = public as $$
  select s.tenant_id, s.user_id, s.csrf_token, u.role, u.name, u.email, u.active
  from sessions s join users u on u.id = s.user_id
  where s.id = p_id and s.expires_at > now()
$$;

create function reset_lookup(p_hash text)
returns table (tenant_id uuid, user_id uuid)
language sql security definer set search_path = public as $$
  select tenant_id, user_id from password_resets
  where token_hash = p_hash and used_at is null and expires_at > now()
$$;

grant execute on function session_lookup(text) to vetflow_app;
grant execute on function reset_lookup(text) to vetflow_app;
