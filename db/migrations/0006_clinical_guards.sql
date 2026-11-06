-- Transfers move stock through an in-transit store, so goods in a van belong to no branch.
alter table stores drop constraint stores_kind_check;
alter table stores add constraint stores_kind_check check (kind in ('central','branch','department','transit'));

-- An approved prescription needs the approver and the time recorded.
alter table prescriptions add constraint prescriptions_approval_check
  check (status <> 'approved' or (approved_by is not null and approved_at is not null));

-- Approved prescriptions are frozen: lines cannot be added, changed or removed.
create function guard_prescription_lines() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from prescriptions where id = coalesce(new.prescription_id, old.prescription_id);
  if st is not null and st <> 'draft' then
    raise exception 'prescription is % and cannot be edited', st using errcode = 'P0001', hint = 'locked';
  end if;
  return coalesce(new, old);
end $$;
create trigger prescription_lines_guard before insert or update or delete on prescription_lines
  for each row execute function guard_prescription_lines();

-- An approved prescription may only be cancelled, never moved back to draft or re-pointed.
create function guard_prescription() returns trigger language plpgsql as $$
begin
  if old.status = 'approved' and (new.status not in ('approved','cancelled')
      or new.consultation_id <> old.consultation_id or new.animal_id <> old.animal_id
      or new.approved_by is distinct from old.approved_by) then
    raise exception 'an approved prescription cannot be changed' using errcode = 'P0001', hint = 'locked';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled prescription cannot be reopened' using errcode = 'P0001', hint = 'locked';
  end if;
  return new;
end $$;
create trigger prescriptions_guard before update on prescriptions
  for each row execute function guard_prescription();
