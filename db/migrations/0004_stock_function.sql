-- The one function that changes stock. It writes the ledger row and the balance together,
-- in the caller's transaction. Application code never updates stock_balances directly.

-- A balance may go below zero only through an audited override, so the plain check is replaced
-- by the function's own rule (which blocks negative stock unless the override rules are met).
alter table stock_balances drop constraint stock_balances_quantity_check;

create function apply_stock_movement(
  p_tenant uuid, p_type text, p_item uuid, p_batch uuid, p_qty numeric,
  p_from uuid, p_to uuid, p_user uuid, p_reason text, p_reference text,
  p_key text, p_override boolean default false
) returns bigint
language plpgsql as $$
declare
  v_ledger_id bigint;
  v_existing bigint;
  v_expiry date;
  v_batch_item uuid;
  v_role text;
  v_allow boolean;
  v_bal numeric;
  v_needs_from boolean;
  v_needs_to boolean;
begin
  if p_tenant is distinct from nullif(current_setting('app.tenant_id', true), '')::uuid then
    raise exception 'tenant mismatch' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be positive'; end if;
  if p_key is null or length(p_key) = 0 then raise exception 'idempotency key required'; end if;

  -- Direction rules per movement type.
  v_needs_from := p_type in ('issue','dispense','transfer_out','return_to_store','return_to_supplier',
                             'damage','expiry_writeoff');
  v_needs_to   := p_type in ('opening','receipt','transfer_in','return_to_store');
  if p_type = 'count_adjustment' then
    if (p_from is null) = (p_to is null) then
      raise exception 'count_adjustment needs exactly one of from or to store';
    end if;
  else
    if v_needs_from and p_from is null then raise exception '% needs a from store', p_type; end if;
    if v_needs_to and p_to is null then raise exception '% needs a to store', p_type; end if;
    if not v_needs_from and p_from is not null then raise exception '% must not have a from store', p_type; end if;
    if not v_needs_to and p_to is not null then raise exception '% must not have a to store', p_type; end if;
  end if;
  if p_type in ('damage','expiry_writeoff','return_to_supplier','count_adjustment')
     and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception '% needs a reason', p_type;
  end if;

  -- This function runs as its owner (it must write balances), which bypasses RLS,
  -- so every lookup below is filtered by tenant explicitly.
  select expiry_date, item_id into v_expiry, v_batch_item from batches where id = p_batch and tenant_id = p_tenant;
  if not found then raise exception 'unknown batch'; end if;
  if v_batch_item <> p_item then raise exception 'batch does not belong to item'; end if;
  if (p_from is not null and not exists (select 1 from stores where id = p_from and tenant_id = p_tenant))
     or (p_to is not null and not exists (select 1 from stores where id = p_to and tenant_id = p_tenant)) then
    raise exception 'unknown store';
  end if;
  if p_user is not null and not exists (select 1 from users where id = p_user and tenant_id = p_tenant) then
    raise exception 'unknown user';
  end if;

  -- Expired stock can only leave through write-off, damage, supplier return or a count.
  if p_from is not null and v_expiry < current_date
     and p_type in ('issue','dispense','transfer_out','return_to_store') then
    raise exception 'batch is expired' using errcode = 'P0001', hint = 'expired';
  end if;

  if p_override then
    select role into v_role from users where id = p_user and tenant_id = p_tenant;
    select allow_negative_override into v_allow from tenant_settings where tenant_id = p_tenant;
    if v_role is null or v_role not in ('admin','inventory_manager') then
      raise exception 'override not permitted for this role' using errcode = '42501';
    end if;
    if not coalesce(v_allow, false) then raise exception 'override is disabled for this tenant' using errcode = '42501'; end if;
    if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'override needs a reason'; end if;
  end if;

  -- Idempotency: the same key returns the original row and changes nothing.
  insert into stock_ledger (tenant_id, item_id, batch_id, type, quantity, from_store_id, to_store_id,
                            user_id, reason, reference, idempotency_key, override)
  values (p_tenant, p_item, p_batch, p_type, p_qty, p_from, p_to, p_user, p_reason, p_reference, p_key, p_override)
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into v_ledger_id;
  if v_ledger_id is null then
    select id into v_existing from stock_ledger where tenant_id = p_tenant and idempotency_key = p_key;
    return v_existing;
  end if;

  -- Lock balance rows in a fixed order (by store id) so opposing moves cannot deadlock.
  if p_from is not null and p_to is not null and p_to < p_from then
    insert into stock_balances (tenant_id, item_id, batch_id, store_id, quantity)
      values (p_tenant, p_item, p_batch, p_to, 0) on conflict (batch_id, store_id) do nothing;
    perform 1 from stock_balances where batch_id = p_batch and store_id = p_to for update;
  end if;

  if p_from is not null then
    insert into stock_balances (tenant_id, item_id, batch_id, store_id, quantity)
      values (p_tenant, p_item, p_batch, p_from, 0) on conflict (batch_id, store_id) do nothing;
    select quantity into v_bal from stock_balances where batch_id = p_batch and store_id = p_from for update;
    if v_bal < p_qty and not p_override then
      raise exception 'insufficient stock' using errcode = 'P0001', hint = 'insufficient';
    end if;
    update stock_balances set quantity = quantity - p_qty where batch_id = p_batch and store_id = p_from;
  end if;

  if p_to is not null then
    insert into stock_balances (tenant_id, item_id, batch_id, store_id, quantity)
      values (p_tenant, p_item, p_batch, p_to, p_qty)
      on conflict (batch_id, store_id) do update set quantity = stock_balances.quantity + excluded.quantity;
  end if;

  if p_override then
    insert into audit_log (tenant_id, user_id, action, entity, entity_id, after, reason)
    values (p_tenant, p_user, 'stock.override', 'stock_ledger', v_ledger_id::text,
            jsonb_build_object('type', p_type, 'item', p_item, 'batch', p_batch, 'qty', p_qty, 'from', p_from, 'to', p_to),
            p_reason);
  end if;

  return v_ledger_id;
end $$;

-- Balances recomputed from the ledger alone. Used by the nightly check and the reports.
create view ledger_balances with (security_invoker = true) as
select tenant_id, item_id, batch_id, store_id, sum(delta) as quantity from (
  select tenant_id, item_id, batch_id, to_store_id as store_id, quantity as delta
    from stock_ledger where to_store_id is not null
  union all
  select tenant_id, item_id, batch_id, from_store_id, -quantity
    from stock_ledger where from_store_id is not null
) m group by tenant_id, item_id, batch_id, store_id;

-- Differences between stored balances and the ledger. An empty result means they agree.
create function reconcile_balances(p_tenant uuid)
returns table (item_id uuid, batch_id uuid, store_id uuid, stored numeric, from_ledger numeric)
language sql as $$
  select coalesce(b.item_id, l.item_id), coalesce(b.batch_id, l.batch_id), coalesce(b.store_id, l.store_id),
         coalesce(b.quantity, 0), coalesce(l.quantity, 0)
  from stock_balances b
  full join ledger_balances l on l.batch_id = b.batch_id and l.store_id = b.store_id
  where coalesce(b.tenant_id, l.tenant_id) = p_tenant
    and coalesce(b.quantity, 0) <> coalesce(l.quantity, 0)
$$;

grant execute on function apply_stock_movement(uuid,text,uuid,uuid,numeric,uuid,uuid,uuid,text,text,text,boolean) to vetflow_app;
grant execute on function reconcile_balances(uuid) to vetflow_app;
grant select on ledger_balances to vetflow_app;

-- Application code must go through the function: direct writes to balances are removed.
revoke insert, update, delete on stock_balances from vetflow_app;
alter function apply_stock_movement(uuid,text,uuid,uuid,numeric,uuid,uuid,uuid,text,text,text,boolean) security definer;
alter function apply_stock_movement(uuid,text,uuid,uuid,numeric,uuid,uuid,uuid,text,text,text,boolean) set search_path = public;
