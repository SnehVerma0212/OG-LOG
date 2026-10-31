-- TEST-ONLY stand-in for the parts of a Supabase database the migrations rely
-- on. Never apply this to a real project: Supabase already provides all of it.
--
-- What it reproduces:
--   * the API roles: anon, authenticated, and service_role (which bypasses RLS);
--   * auth.users and auth.uid(), which reads the caller's user ID from the
--     request JWT claims exactly as Supabase's own auth.uid() does;
--   * Supabase's default privileges, which grant every new public table to the
--     API roles, so tests prove the migration's explicit REVOKEs take effect.
-- What it does not reproduce: Supabase Auth itself, JWT signature checks,
-- the PostgREST API layer, and Storage.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
