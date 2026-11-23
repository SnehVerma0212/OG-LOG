-- OG-LOG: require a new password after the first sign-in with an
-- administrator-issued initial password.
--
-- Additive: one column, one trigger and two restrictive policies. No existing
-- table, policy or function is changed or dropped. Review before applying.
--
-- How it works:
--   * profiles.password_change_required is true for every account created
--     from now on (the existing sign-up trigger inserts the profile with the
--     column default). Accounts that already exist are NOT flagged.
--   * Signed-in users can read their own flag but never write it: the
--     existing column grant on profiles covers display_name only.
--   * The flag is cleared only by Supabase Auth itself, when the account's
--     password hash actually changes (set-new-password screen, Settings, or a
--     password-reset link). A client cannot clear it any other way.
--   * While the flag is set, Row Level Security hides and refuses all case and
--     attachment rows for that user (restrictive policies, ANDed with the
--     existing owner policies). Photo files follow, because the Storage
--     policies require a visible attachment record. So the requirement holds
--     even for someone calling the API directly with the initial password.
--   * To force a new password again later (e.g. after an administrator resets
--     it), set the flag back to true for that user in the SQL editor.

alter table public.profiles add column password_change_required boolean not null default false;
-- Existing rows keep false; every profile created from now on starts true.
alter table public.profiles alter column password_change_required set default true;

comment on column public.profiles.password_change_required is
  'True until the user replaces the administrator-issued initial password. Cleared only by a password change in Supabase Auth.';

-- ---------------------------------------------------------------------------
-- Cleared when Supabase Auth stores a different password hash. The WHEN
-- clause ignores updates that rewrite the row without changing the password.
-- ---------------------------------------------------------------------------
create function private.handle_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set password_change_required = false
  where id = new.id and password_change_required;
  return null;
end;
$$;

revoke all on function private.handle_password_change() from public;

create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.handle_password_change();

-- ---------------------------------------------------------------------------
-- Restrictive policies: in addition to the existing owner policies, a row is
-- reachable only when the caller has a profile whose password change is done.
-- (A missing profile also blocks access.)
-- ---------------------------------------------------------------------------
create policy "Cases: password change completed" on public.cases
  as restrictive
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and not p.password_change_required
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and not p.password_change_required
  ));

create policy "Attachments: password change completed" on public.case_attachments
  as restrictive
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and not p.password_change_required
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and not p.password_change_required
  ));
