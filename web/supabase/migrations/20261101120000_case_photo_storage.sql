-- OG-LOG: private Storage bucket for case photos, and who may use its files.
--
-- Additive: creates one bucket and three policies; changes no table and no
-- existing policy. Review before applying, and store synthetic images only.
--
-- Model: a photo is one public.case_attachments record (owner, case, section)
-- plus one Storage object whose name is that record's storage_path,
-- '<owner>/<case>/<attachment>'. The table's constraints already guarantee the
-- path matches the record's owner and case, and that the case is the owner's.
-- These policies let a signed-in user read, upload or delete an object only
-- when an attachment record with exactly that path exists AND belongs to them.
-- So nobody can reach another user's files by changing a case ID, attachment
-- ID or path, and no file can exist without a record. The app therefore
-- creates the record before uploading, and deletes the file before the record.
-- There is no UPDATE policy: files can never be overwritten, moved or renamed.

-- ---------------------------------------------------------------------------
-- Bucket: private (no public URLs), 10 MB per file, three image types. The
-- Storage API enforces the size and type limits on every upload. If a bucket
-- with this ID already exists, it is made private with these limits.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('case-photos', 'case-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Policies on storage.objects (RLS is already enabled there by Supabase).
-- The subquery runs as the caller, so the attachment table's own RLS applies too.
-- ---------------------------------------------------------------------------
create policy "Case photos: read own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'case-photos'
    and exists (
      select 1 from public.case_attachments a
      where a.storage_path = storage.objects.name and a.owner_id = (select auth.uid())
    )
  );

create policy "Case photos: upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'case-photos'
    and exists (
      select 1 from public.case_attachments a
      where a.storage_path = storage.objects.name and a.owner_id = (select auth.uid())
    )
  );

create policy "Case photos: delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'case-photos'
    and exists (
      select 1 from public.case_attachments a
      where a.storage_path = storage.objects.name and a.owner_id = (select auth.uid())
    )
  );
