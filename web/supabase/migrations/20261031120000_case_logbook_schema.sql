-- OG-LOG: personal surgical logbook schema with per-doctor Row Level Security.
--
-- Non-destructive: this migration only creates new objects. It must be reviewed
-- before it is applied to any project, and only synthetic data may be stored
-- until security testing and legal/institutional review are complete.
--
-- Authorization model: every row belongs to exactly one Supabase Auth user
-- (owner_id). Row Level Security lets a signed-in user reach only their own
-- rows; anonymous visitors get no table privileges at all. The service-role
-- key bypasses RLS and must only ever be used server-side.

-- ---------------------------------------------------------------------------
-- Helper functions live in a schema the Data API does not expose, so they
-- cannot be called directly as RPC endpoints.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

-- True when `value` is a JSON object whose values are all strings: the shape of
-- a case section (field key -> free text), matching the app's SectionFields.
create function private.is_text_map(value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
     and not exists (
       select 1 from jsonb_each(value) as entry where jsonb_typeof(entry.value) <> 'string'
     )
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per Supabase Auth user. No email or patient data here.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One profile per authenticated doctor. Created automatically on sign-up.';

-- ---------------------------------------------------------------------------
-- cases: one surgical case, owned by one doctor. Mirrors the app's CaseRecord.
-- ---------------------------------------------------------------------------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- The doctor's own internal code: never a patient or hospital identifier.
  reference text check (
    reference is null
    or (char_length(reference) between 1 and 40 and reference = btrim(reference))
  ),
  surgery_date date not null,
  procedure text not null check (btrim(procedure) <> '' and char_length(procedure) <= 300),
  diagnosis text not null default '' check (char_length(diagnosis) <= 1000),
  role text check (role in ('primary', 'assistant', 'supervisor', 'observer')),
  status text not null default 'draft' check (status in ('draft', 'completed')),

  -- Sections: free-text fields keyed by name, preserved even if the form changes.
  preop jsonb not null default '{}'::jsonb,
  ot jsonb not null default '{}'::jsonb,
  postop jsonb not null default '{}'::jsonb,
  -- Each moves only when its own section changes (set by trigger). A section's
  -- creation time is the case's created_at.
  preop_updated_at timestamptz not null default now(),
  ot_updated_at timestamptz not null default now(),
  postop_updated_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Same rule as the app: a completed case needs a diagnosis and a role.
  constraint cases_completed_requires_details check (
    status <> 'completed' or (btrim(diagnosis) <> '' and role is not null)
  ),
  constraint cases_sections_are_text_maps check (
    private.is_text_map(preop) and private.is_text_map(ot) and private.is_text_map(postop)
  ),
  constraint cases_sections_size check (
    octet_length(preop::text) <= 32768 and octet_length(ot::text) <= 32768 and octet_length(postop::text) <= 32768
  ),
  -- Target of the composite foreign key from case_attachments.
  constraint cases_id_owner_key unique (id, owner_id)
);

comment on table public.cases is 'Surgical cases. Each row is private to its owner (RLS).';

-- A reference is unique within one doctor's logbook, ignoring case. Different
-- doctors may use the same reference.
create unique index cases_owner_reference_key on public.cases (owner_id, lower(reference))
  where reference is not null;
create index cases_owner_surgery_date_idx on public.cases (owner_id, surgery_date desc, updated_at desc);
create index cases_owner_updated_at_idx on public.cases (owner_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- case_attachments: metadata for future private photos. Files will live in a
-- private Storage bucket (a later phase); nothing is uploaded yet.
-- ---------------------------------------------------------------------------
create table public.case_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  case_id uuid not null,
  category text not null check (category in ('preop', 'ot', 'postop')),
  -- Object path in Storage; must be '<owner>/<case>/<attachment>'.
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 52428800),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  -- Only a trusted server-side check may move this past 'pending' (a later phase).
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Ownership consistency: the attachment's owner must be its case's owner.
  constraint case_attachments_case_owner_fkey foreign key (case_id, owner_id)
    references public.cases (id, owner_id) on delete cascade,
  constraint case_attachments_storage_path_matches check (
    storage_path = owner_id::text || '/' || case_id::text || '/' || id::text
  )
);

comment on table public.case_attachments is 'Attachment metadata for future private photos. Private to its owner (RLS).';

create index case_attachments_case_idx on public.case_attachments (case_id, owner_id);
create index case_attachments_owner_idx on public.case_attachments (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers: server-controlled timestamps and immutable ownership.
-- ---------------------------------------------------------------------------
create function private.cases_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Timestamps come from the server, not the browser.
    new.created_at := now();
    new.updated_at := now();
    new.preop_updated_at := now();
    new.ot_updated_at := now();
    new.postop_updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'A case ID cannot be changed.' using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'A case cannot be moved to another owner.' using errcode = '42501';
  end if;

  new.created_at := old.created_at;
  new.updated_at := now();
  new.preop_updated_at := case when new.preop is distinct from old.preop then now() else old.preop_updated_at end;
  new.ot_updated_at := case when new.ot is distinct from old.ot then now() else old.ot_updated_at end;
  new.postop_updated_at := case when new.postop is distinct from old.postop then now() else old.postop_updated_at end;
  return new;
end;
$$;

create trigger cases_before_write
  before insert or update on public.cases
  for each row execute function private.cases_before_write();

create function private.case_attachments_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    -- A signed-in user can never mark their own upload as verified.
    if current_user in ('authenticated', 'anon') then
      new.status := 'pending';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.case_id is distinct from old.case_id
     or new.storage_path is distinct from old.storage_path then
    raise exception 'An attachment''s identity, owner, case and storage path cannot be changed.'
      using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger case_attachments_before_write
  before insert or update on public.case_attachments
  for each row execute function private.case_attachments_before_write();

create function private.profiles_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'A profile ID cannot be changed.' using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function private.profiles_before_update();

-- Creates the profile when Supabase Auth creates a user. SECURITY DEFINER so it
-- can insert despite RLS; it inserts only the new user's own ID.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Privileges: deny by default, then grant only what each role needs. These
-- grants are a second layer; RLS below decides which rows are reachable.
-- ---------------------------------------------------------------------------
revoke all on table public.profiles, public.cases, public.case_attachments from anon, authenticated;

grant select, update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.cases to authenticated;
-- No UPDATE: attachments are replaced (insert + delete), never edited by users.
grant select, insert, delete on public.case_attachments to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.cases enable row level security;
alter table public.case_attachments enable row level security;

-- profiles: a user sees and edits only their own profile. No insert policy
-- (the trigger creates it) and no delete policy (account deletion will be a
-- server-side process).
create policy "Profiles: read own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "Profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- cases: full CRUD on your own cases only. USING hides other doctors' rows from
-- reads, updates and deletes; WITH CHECK stops creating or saving a row that
-- names anyone else as owner.
create policy "Cases: read own" on public.cases
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Cases: insert own" on public.cases
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Cases: update own" on public.cases
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Cases: delete own" on public.cases
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- case_attachments: read, add and remove your own. The composite foreign key
-- additionally guarantees the case belongs to the same owner, so a record can
-- never point at another doctor's case.
create policy "Attachments: read own" on public.case_attachments
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Attachments: insert own" on public.case_attachments
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Attachments: delete own" on public.case_attachments
  for delete to authenticated
  using (owner_id = (select auth.uid()));
