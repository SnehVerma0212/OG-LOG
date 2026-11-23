-- OG-LOG: audit trail, self-service account deletion, and two-step
-- verification (MFA) enforcement.
--
-- Additive: one table, functions, triggers and policies. No existing table,
-- policy or function is changed or dropped. Review before applying.

-- ---------------------------------------------------------------------------
-- 1. Audit trail: what happened to a doctor's records, and when. Only the
--    action, the record ID and the time are stored, never clinical text.
--    Rows are written by triggers (and, for exports, by the user's own
--    insert); nobody can edit or delete them through the API. They are
--    deleted together with the account.
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  action text not null check (action in (
    'case.created', 'case.updated', 'case.deleted',
    'photo.added', 'photo.removed',
    'password.changed', 'export.downloaded'
  )),
  record_id uuid
);

comment on table public.audit_events is 'Append-only activity log per doctor. IDs and times only; no clinical content.';

create index audit_events_owner_time_idx on public.audit_events (owner_id, occurred_at desc);

revoke all on table public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
-- Users may only add their own "export downloaded" entries.
grant insert (action) on public.audit_events to authenticated;
grant select, insert, delete on public.audit_events to service_role;

alter table public.audit_events enable row level security;

create policy "Audit: read own" on public.audit_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Audit: record own export" on public.audit_events
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and action = 'export.downloaded' and record_id is null);

-- Writes one event, unless the owner's account is being deleted right now
-- (then the event would refer to a user that no longer exists).
create function private.record_audit_event(owner uuid, event text, record uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users where id = owner) then
    insert into public.audit_events (owner_id, action, record_id) values (owner, event, record);
  end if;
end;
$$;

revoke all on function private.record_audit_event(uuid, text, uuid) from public;

create function private.audit_cases()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_audit_event(new.owner_id, 'case.created', new.id);
  elsif tg_op = 'UPDATE' then
    perform private.record_audit_event(new.owner_id, 'case.updated', new.id);
  else
    perform private.record_audit_event(old.owner_id, 'case.deleted', old.id);
  end if;
  return null;
end;
$$;

create function private.audit_attachments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_audit_event(new.owner_id, 'photo.added', new.id);
  else
    perform private.record_audit_event(old.owner_id, 'photo.removed', old.id);
  end if;
  return null;
end;
$$;

create function private.audit_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_audit_event(new.id, 'password.changed', null);
  return null;
end;
$$;

revoke all on function private.audit_cases(), private.audit_attachments(), private.audit_password_change() from public;

create trigger cases_audit
  after insert or update or delete on public.cases
  for each row execute function private.audit_cases();

create trigger case_attachments_audit
  after insert or delete on public.case_attachments
  for each row execute function private.audit_attachments();

create trigger on_auth_user_password_audited
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.audit_password_change();

-- ---------------------------------------------------------------------------
-- 2. Two-step verification. A doctor who has enrolled an authenticator app
--    (a verified MFA factor) can reach case data only from a session that has
--    completed the second step (assurance level aal2). Doctors without a
--    factor are unaffected. Restrictive: ANDed with all existing policies.
--
--    Signed-in users cannot read auth.mfa_factors on Supabase, so the check is
--    one SECURITY DEFINER function that answers only about the caller. It
--    lives in its own schema, which the Data API does not expose.
-- ---------------------------------------------------------------------------
create schema if not exists access_checks;
revoke all on schema access_checks from public;
grant usage on schema access_checks to authenticated;

create function access_checks.second_step_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    )
$$;

revoke all on function access_checks.second_step_satisfied() from public;
grant execute on function access_checks.second_step_satisfied() to authenticated;

create policy "Cases: second step when enrolled" on public.cases
  as restrictive
  for all to authenticated
  using ((select access_checks.second_step_satisfied()))
  with check ((select access_checks.second_step_satisfied()));

create policy "Attachments: second step when enrolled" on public.case_attachments
  as restrictive
  for all to authenticated
  using ((select access_checks.second_step_satisfied()))
  with check ((select access_checks.second_step_satisfied()));

create policy "Audit: second step when enrolled" on public.audit_events
  as restrictive
  for all to authenticated
  using ((select access_checks.second_step_satisfied()))
  with check ((select access_checks.second_step_satisfied()));

-- ---------------------------------------------------------------------------
-- 3. Self-service account deletion. Deletes the caller's Auth user; profile,
--    cases, attachment records and audit events follow by cascade. Photo
--    FILES must be removed first through the Storage API (deleting Storage
--    rows in SQL would leave the files behind), so this refuses while any
--    remain. Also refused while an initial password is still in use, so a
--    shared or leaked initial password cannot be used to destroy an account.
-- ---------------------------------------------------------------------------
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to delete your account.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = caller and not password_change_required) then
    raise exception 'Set your own password before deleting the account.' using errcode = '42501';
  end if;
  if not access_checks.second_step_satisfied() then
    raise exception 'Complete two-step verification before deleting the account.' using errcode = '42501';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'case-photos' and name like caller::text || '/%'
  ) then
    raise exception 'Photo files remain. Remove all photos before deleting the account.' using errcode = 'P0001';
  end if;
  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
