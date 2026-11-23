// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { failure, SUPABASE_DEFAULTS, TestDatabase, type Query } from './harness';

// Storage policies for case photos (migration 20261101120000), enforced by
// PostgreSQL on storage.objects exactly as the Storage API runs them: as the
// `authenticated` role with the caller's JWT claims. The Storage API itself
// (file bytes, size and type limits, signed URLs) is not part of PGlite; the
// real-Supabase integration suite covers it. Synthetic data only.

const BUCKET = 'case-photos';

let db: TestDatabase;
let userA: string;
let userB: string;
let caseA: string;
let pathA: string;

async function createCase(query: Query) {
  const [row] = await query<{ id: string }>(
    "insert into public.cases (surgery_date, procedure) values ('2026-10-15', 'Synthetic procedure') returning id",
  );
  return row!.id;
}

async function attach(query: Query, ownerId: string, caseId: string, attachmentId: string = crypto.randomUUID()) {
  const path = `${ownerId}/${caseId}/${attachmentId}`;
  await query(
    `insert into public.case_attachments (id, case_id, category, storage_path, mime_type, byte_size)
     values ($1, $2, 'preop', $3, 'image/jpeg', 1024)`,
    [attachmentId, caseId, path],
  );
  return { id: attachmentId, path };
}

// Like the Storage API's insert of a new object (no RETURNING needed).
const upload = (query: Query, name: string, bucket = BUCKET) =>
  query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]);

const objectNames = () =>
  db.admin<{ name: string }>('select name from storage.objects order by name').then((rows) => rows.map((row) => row.name));

describe.each(SUPABASE_DEFAULTS)('case photo storage with %s Supabase defaults', (defaults) => {
  beforeEach(async () => {
    db = await TestDatabase.create(defaults);
    userA = await db.createUser('doctor-a@example.test');
    userB = await db.createUser('doctor-b@example.test');
    caseA = await db.asUser(userA, (query) => createCase(query));
    pathA = (await db.asUser(userA, (query) => attach(query, userA, caseA))).path;
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates a private bucket limited to 10 MB JPEG, PNG and WebP images', async () => {
    expect(await db.admin('select id, public, file_size_limit::text as file_size_limit, allowed_mime_types from storage.buckets')).toEqual([
      { id: BUCKET, public: false, file_size_limit: '10485760', allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] },
    ]);
  });

  it('lets the owner upload, read and delete a file at a path they registered', async () => {
    await db.asUser(userA, (query) => upload(query, pathA));
    expect(await db.asUser(userA, (query) => query('select name from storage.objects'))).toEqual([{ name: pathA }]);
    expect(await db.asUser(userA, (query) => query('delete from storage.objects where name = $1 returning name', [pathA]))).toEqual([
      { name: pathA },
    ]);
    expect(await objectNames()).toEqual([]);
  });

  it('refuses uploads to paths without a matching record of the caller', async () => {
    // Own folder and own case, but no attachment record for this path.
    const unregistered = `${userA}/${caseA}/${crypto.randomUUID()}`;
    expect((await failure(db.asUser(userA, (query) => upload(query, unregistered)))).code).toBe('42501');
    // A path outside the owner/case/attachment layout.
    expect((await failure(db.asUser(userA, (query) => upload(query, 'loose-file.jpg')))).code).toBe('42501');
    // The right path in a different bucket.
    await db.admin("insert into storage.buckets (id, name) values ('other', 'other')");
    expect((await failure(db.asUser(userA, (query) => upload(query, pathA, 'other')))).code).toBe('42501');
    expect(await objectNames()).toEqual([]);
  });

  it('stops B uploading to, reading, overwriting or deleting A’s photo', async () => {
    await db.asUser(userA, (query) => upload(query, pathA));

    // Writing to A's registered path (e.g. by changing IDs in a request).
    expect((await failure(db.asUser(userB, (query) => upload(query, pathA)))).code).toBe('42501');

    await db.asUser(userB, async (query) => {
      expect(await query('select name from storage.objects')).toEqual([]);
      expect(await query('select name from storage.objects where name = $1', [pathA])).toEqual([]);
      expect(await query('delete from storage.objects returning name')).toEqual([]);
      await query('delete from storage.objects where name = $1', [pathA]);
      // Unfiltered and without RETURNING, only the DELETE policy applies.
      await query('delete from storage.objects');
      expect(await query("update storage.objects set metadata = '{}'::jsonb returning name")).toEqual([]);
    });
    expect(await objectNames()).toEqual([pathA]);
  });

  it('stops B registering a record for A’s case or path, so B can never upload there', async () => {
    const caseB = await db.asUser(userB, (query) => createCase(query));
    // B's record pointing at A's case, or naming A's folder, is rejected.
    expect((await failure(db.asUser(userB, (query) => attach(query, userB, caseA)))).code).toBe('23503');
    expect((await failure(db.asUser(userB, (query) => attach(query, userA, caseB)))).code).toBe('23514');
    // B's own photos work normally and stay invisible to A.
    const own = await db.asUser(userB, (query) => attach(query, userB, caseB));
    await db.asUser(userB, (query) => upload(query, own.path));
    expect(await db.asUser(userA, (query) => query('select name from storage.objects where name = $1', [own.path]))).toEqual([]);
  });

  it('never lets anyone overwrite or rename a file, including the owner', async () => {
    await db.asUser(userA, (query) => upload(query, pathA));
    const renamed = `${userA}/${caseA}/${crypto.randomUUID()}`;
    await db.asUser(userA, (query) => attach(query, userA, caseA, renamed.split('/')[2]));
    await db.asUser(userA, async (query) => {
      expect(await query("update storage.objects set metadata = '{}'::jsonb where name = $1 returning name", [pathA])).toEqual([]);
      expect(await query('update storage.objects set name = $1 where name = $2 returning name', [renamed, pathA])).toEqual([]);
    });
    expect(await db.admin('select name, metadata from storage.objects')).toEqual([{ name: pathA, metadata: null }]);
  });

  it('gives anonymous visitors no access', async () => {
    await db.asUser(userA, (query) => upload(query, pathA));
    await db.asAnon(async (query) => {
      expect(await query('select name from storage.objects')).toEqual([]);
      expect(await query('delete from storage.objects returning name')).toEqual([]);
      await query('delete from storage.objects');
    });
    expect((await failure(db.asAnon((query) => upload(query, pathA)))).code).toBe('42501');
    expect(await objectNames()).toEqual([pathA]);
  });

  it('hides a file once its record is gone, which is why files are deleted first', async () => {
    await db.asUser(userA, (query) => upload(query, pathA));
    await db.asUser(userA, (query) => query('delete from public.case_attachments where storage_path = $1', [pathA]));
    await db.asUser(userA, async (query) => {
      expect(await query('select name from storage.objects')).toEqual([]);
      expect(await query('delete from storage.objects where name = $1 returning name', [pathA])).toEqual([]);
    });
    // Only trusted server-side cleanup (service role) could still remove it.
    expect(await db.asServiceRole((query) => query('delete from storage.objects where name = $1 returning name', [pathA]))).toEqual([
      { name: pathA },
    ]);
  });
});
