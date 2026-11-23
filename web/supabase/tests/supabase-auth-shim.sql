-- TEST-ONLY stand-in for the parts of a Supabase database the migrations rely
-- on. Never apply this to a real project: Supabase already provides all of it.
--
-- What it reproduces:
--   * the API roles: anon, authenticated, and service_role (which bypasses RLS);
--   * auth.users and auth.uid(), which reads the caller's user ID from the
--     request JWT claims exactly as Supabase's own auth.uid() does;
--   * Supabase's default privileges, which grant every new public table to the
--     API roles, so tests prove the migration's explicit REVOKEs take effect;
--   * the storage.buckets and storage.objects tables that Storage policies
--     apply to, with Supabase's grants and RLS enabled.
-- What it does not reproduce: Supabase Auth itself, JWT signature checks,
-- the PostgREST API layer, and the Storage API (which enforces bucket size and
-- type limits and stores the files).

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  last_sign_in_at timestamptz,
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

-- auth.jwt(), as Supabase defines it: the request's JWT claims.
create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- MFA factors (only the columns used). As on Supabase (checked on the local
-- Supabase stack, Postgres 17.11): RLS on, and signed-in users may NOT read it.
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  factor_type text not null default 'totp',
  status text not null check (status in ('unverified', 'verified'))
);
alter table auth.mfa_factors enable row level security;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Storage: only the columns the photo policies and tests use.
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
