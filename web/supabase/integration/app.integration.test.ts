// @vitest-environment node
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CaseInput } from '@og-log/domain/cases';

import {
  CaseNotFoundError,
  ConcurrentUpdateError,
  DuplicateReferenceError,
} from '../../src/data/caseRepository';
import readXlsxFile from 'read-excel-file/universal';

import { buildExport } from '../../src/account/accountActions';
import { SupabaseAccountService } from '../../src/account/supabaseAccountService';
import { SupabaseCaseRepository } from '../../src/data/supabaseCaseRepository';
import { readZip } from '../../src/lib/zip';
import { fetchUploader, PHOTO_BUCKET, SupabasePhotoStore } from '../../src/photos/supabasePhotoStore';
import { jpegSegment, PNG_HEADER, syntheticImage, syntheticImageBytes } from '../../src/test/syntheticImages';
import { createRunId, runCleanupSteps, throwIfError, type CleanupStep } from './cleanup';
import { readIntegrationConfig } from './config';

// The website's own data layer (SupabaseCaseRepository, SupabasePhotoStore)
// against the REAL development project, signed in as synthetic users A and B
// with the publishable key. Every case carries this run's marker in its
// procedure and is removed (photos first) and verified gone afterwards.
// Photo tests run only once the private bucket migration has been applied;
// until then they are reported as skipped.

const result = readIntegrationConfig(import.meta.env as Record<string, string | undefined>);
const runId = createRunId();
const PROCEDURE = `${runId} synthetic procedure`;

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    reference: '',
    surgeryDate: '2026-10-15',
    procedure: PROCEDURE,
    diagnosis: '',
    role: null,
    status: 'draft',
    sections: { preop: {}, ot: { findings: 'Synthetic finding' }, postop: {} },
    ...overrides,
  };
}

// A tiny synthetic PNG-signature file: no real image content.
const syntheticPng = () => syntheticImage('image/png', 64, 'synthetic.png');

describe('Supabase integration: website data layer', () => {
  if (!result.ok) {
    it.skip(`skipped: ${result.reason}`, () => undefined);
    return;
  }
  const { config } = result;

  interface Session {
    client: SupabaseClient;
    id: string;
    cases: SupabaseCaseRepository;
    photos: SupabasePhotoStore;
  }
  let a: Session | undefined;
  let b: Session | undefined;
  let bucketReady = false;

  const asA = () => a!;
  const asB = () => b!;

  async function signIn(credentials: { email: string; password: string }): Promise<Session> {
    const client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.signInWithPassword(credentials);
    if (error || !data.user) {
      throw new Error(`Sign-in failed for a test user (${error?.code ?? 'no user'}). Check DEVELOPMENT.md step 4.`);
    }
    return {
      client,
      id: data.user.id,
      cases: new SupabaseCaseRepository(client),
      photos: new SupabasePhotoStore(client, config.url, config.publishableKey, { uploader: fetchUploader }),
    };
  }

  // Raw Storage upload as a given user, bypassing the app's own checks.
  async function rawUpload(session: Session, path: string, body: Blob, contentType: string, upsert = false) {
    const { data } = await session.client.auth.getSession();
    return fetchUploader({
      url: `${config.url}/storage/v1/object/${PHOTO_BUCKET}/${path}`,
      headers: {
        authorization: `Bearer ${data.session!.access_token}`,
        apikey: config.publishableKey,
        'content-type': contentType,
        'x-upsert': String(upsert),
      },
      body,
    });
  }

  beforeAll(async () => {
    a = await signIn(config.userA);
    b = await signIn(config.userB);
    bucketReady = await probeBucket(a);
  });

  // Listing a missing bucket is not an error, so the probe makes one real,
  // registered upload. Only an explicit "Bucket not found" skips the photo
  // tests; any other refusal lets them run and fail visibly.
  async function probeBucket(session: Session): Promise<boolean> {
    const probeCase = await session.cases.createCase(input());
    const id = crypto.randomUUID();
    const path = `${session.id}/${probeCase.id}/${id}`;
    throwIfError(
      await session.client.from('case_attachments').insert({
        id,
        case_id: probeCase.id,
        category: 'ot',
        storage_path: path,
        mime_type: 'image/png',
        byte_size: syntheticPng().size,
      }),
      'Registering the bucket probe',
    );
    const { data } = await session.client.auth.getSession();
    const response = await fetch(`${config.url}/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${data.session!.access_token}`,
        apikey: config.publishableKey,
        'content-type': 'image/png',
        'x-upsert': 'false',
      },
      body: syntheticPng(),
    });
    const text = await response.text();
    // The probe's file and case are removed by the cleanup below.
    return response.ok || !/bucket not found/i.test(text);
  }

  afterAll(async () => {
    const users = [
      { label: 'A', session: a },
      { label: 'B', session: b },
    ].filter((user): user is { label: string; session: Session } => user.session !== undefined);
    const steps: CleanupStep[] = [];
    const runCases = async (session: Session) => {
      const found = await session.client.from('cases').select('id').like('procedure', `${runId}%`);
      throwIfError(found, 'Listing this run’s cases');
      return (found.data ?? []).map((row) => (row as { id: string }).id);
    };

    for (const { label, session } of users) {
      steps.push({
        name: `remove user ${label}'s photos and cases from this run`,
        run: async () => {
          for (const caseId of await runCases(session)) {
            if (bucketReady) {
              await session.photos.deleteCasePhotos(caseId); // Throws if any file remains.
            }
          }
          throwIfError(await session.client.from('cases').delete().like('procedure', `${runId}%`), 'Delete');
          const left = await runCases(session);
          if (left.length > 0) {
            throw new Error(`${left.length} case(s) from this run remain`);
          }
        },
      });
    }
    for (const { label, session } of users) {
      steps.push({
        name: `sign out user ${label}`,
        run: async () => throwIfError(await session.client.auth.signOut({ scope: 'local' }), 'Sign-out'),
      });
    }
    await runCleanupSteps(steps);
  });

  describe('cases', () => {
    it('creates, reads, edits, lists, counts and deletes a case as its owner', async () => {
      const id = crypto.randomUUID();
      const created = await asA().cases.createCase(input(), { id });
      expect(created).toMatchObject({ id, procedure: PROCEDURE, status: 'draft' });
      expect(created.sections.ot.fields).toEqual({ findings: 'Synthetic finding' });

      const loaded = await asA().cases.getCase(id);
      expect(loaded).toEqual(created);

      const updated = await asA().cases.updateCase(id, input({ diagnosis: 'Synthetic diagnosis', role: 'assistant', status: 'completed' }), {
        expectedUpdatedAt: created.updatedAt,
      });
      expect(updated).toMatchObject({ status: 'completed', role: 'assistant', createdAt: created.createdAt });
      expect(updated.updatedAt > created.updatedAt).toBe(true);
      expect(updated.sections.ot.updatedAt).toBe(created.sections.ot.updatedAt); // Unchanged section keeps its time.

      const listed = await asA().cases.listCases({ search: runId });
      expect(listed.map((item) => item.id)).toContain(id);
      expect(await asA().cases.countCases({ search: runId, status: 'completed' })).toBeGreaterThanOrEqual(1);
      expect((await asA().cases.getStats()).total).toBeGreaterThanOrEqual(1);

      expect(await asA().cases.deleteCase(id)).toBe(true);
      expect(await asA().cases.getCase(id)).toBeNull();
      expect(await asA().cases.deleteCase(id)).toBe(false);
    });

    it('scopes every operation to the owner: B cannot see, list, edit or delete A’s case', async () => {
      const mine = await asA().cases.createCase(input({ diagnosis: `${runId} private` }));

      expect(await asB().cases.getCase(mine.id)).toBeNull();
      expect((await asB().cases.listCases({ search: runId })).map((item) => item.id)).not.toContain(mine.id);
      expect(await asB().cases.countCases({ search: `${runId} private` })).toBe(0);
      await expect(asB().cases.updateCase(mine.id, input({ diagnosis: 'Tampered' }))).rejects.toBeInstanceOf(CaseNotFoundError);
      expect(await asB().cases.deleteCase(mine.id)).toBe(false);

      expect((await asA().cases.getCase(mine.id))?.diagnosis).toBe(`${runId} private`);
    });

    it('refuses a stale edit instead of overwriting newer changes', async () => {
      const created = await asA().cases.createCase(input());
      await asA().cases.updateCase(created.id, input({ diagnosis: 'Newer' }), { expectedUpdatedAt: created.updatedAt });
      await expect(
        asA().cases.updateCase(created.id, input({ diagnosis: 'Stale' }), { expectedUpdatedAt: created.updatedAt }),
      ).rejects.toBeInstanceOf(ConcurrentUpdateError);
      expect((await asA().cases.getCase(created.id))?.diagnosis).toBe('Newer');
    });

    it('treats a repeated create with the same ID as one case', async () => {
      const id = crypto.randomUUID();
      await asA().cases.createCase(input(), { id });
      const again = await asA().cases.createCase(input(), { id });
      expect(again.id).toBe(id);
      const { data } = await asA().client.from('cases').select('id').eq('id', id);
      expect(data).toHaveLength(1);
    });

    it('reports a duplicate reference clearly', async () => {
      const reference = `${runId}-DUP`;
      await asA().cases.createCase(input({ reference }));
      await expect(asA().cases.createCase(input({ reference: reference.toLowerCase() }))).rejects.toBeInstanceOf(DuplicateReferenceError);
    });
  });

  describe('first-login password flag', () => {
    const NOT_APPLIED = 'password flag not set up yet (migration 20261102120000 not applied)';
    const readFlag = (session: Session, userId: string) =>
      session.client.from('profiles').select('password_change_required').eq('id', userId);

    it('lets each user read only their own flag, which existing accounts have cleared', async (context) => {
      const own = await readFlag(asA(), asA().id);
      context.skip(own.error?.code === '42703', NOT_APPLIED);
      expect(own.error).toBeNull();
      expect(own.data).toEqual([{ password_change_required: false }]);
      const other = await readFlag(asB(), asA().id);
      expect(other.error).toBeNull();
      expect(other.data).toEqual([]);
    });

    it('refuses any attempt by a user to set or clear the flag directly', async (context) => {
      const probe = await readFlag(asA(), asA().id);
      context.skip(probe.error?.code === '42703', NOT_APPLIED);
      for (const value of [true, false]) {
        const { error } = await asA().client.from('profiles').update({ password_change_required: value }).eq('id', asA().id);
        expect(error?.code).toBe('42501');
      }
      expect((await readFlag(asA(), asA().id)).data).toEqual([{ password_change_required: false }]);
    });
  });

  describe('activity log and account deletion (migration 20261103120000)', () => {
    const NOT_APPLIED = 'audit/account-security migration 20261103120000 not applied yet';
    const missing = (code: string | undefined) => code === 'PGRST205' || code === '42P01';

    it('records the owner’s case activity, visible only to the owner, and cannot be forged', async (context) => {
      const probe = await asA().client.from('audit_events').select('id').limit(1);
      context.skip(missing(probe.error?.code), NOT_APPLIED);
      const mine = await asA().cases.createCase(input());
      const own = await asA().client.from('audit_events').select('action, record_id').eq('record_id', mine.id);
      expect(own.error).toBeNull();
      expect(own.data).toEqual([{ action: 'case.created', record_id: mine.id }]);

      const other = await asB().client.from('audit_events').select('id').eq('record_id', mine.id);
      expect(other.error).toBeNull();
      expect(other.data).toEqual([]);

      const forged = await asA().client.from('audit_events').insert({ action: 'case.deleted', record_id: mine.id });
      expect(forged.error?.code).toBe('42501');
      const erased = await asA().client.from('audit_events').delete().eq('record_id', mine.id);
      expect(erased.error?.code).toBe('42501');
    });

    it('does not let anonymous visitors call account deletion', async (context) => {
      const probe = await asA().client.from('audit_events').select('id').limit(1);
      context.skip(missing(probe.error?.code), NOT_APPLIED);
      const anon = createClient(config.url, config.publishableKey, { auth: { persistSession: false } });
      const { error } = await anon.rpc('delete_my_account');
      expect(error).not.toBeNull();
      // (Successful self-deletion is tested locally only: running it here would delete a test account.)
    });
  });

  describe('photos in private Storage', () => {
    it('uploads a photo to the right case and section, shows it via a short-lived URL, and removes it', async (context) => {
      context.skip(!bucketReady, 'case-photos bucket not set up yet (migration 20261101120000 not applied)');
      const mine = await asA().cases.createCase(input());
      const progress: number[] = [];
      const photo = await asA().photos.uploadPhoto(mine.id, 'ot', syntheticPng(), (value) => progress.push(value));
      expect(photo).toMatchObject({ caseId: mine.id, section: 'ot', mimeType: 'image/png' });
      expect(progress.at(-1)).toBe(1);

      expect(await asA().photos.listPhotos(mine.id)).toEqual([photo]);
      const url = (await asA().photos.viewUrls([photo])).get(photo.id);
      expect(url).toMatch(/\/storage\/v1\/object\/sign\/case-photos\/.+token=/);
      const response = await fetch(url!);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer()).slice(0, 8)).toEqual(new Uint8Array(PNG_HEADER));

      await asA().photos.deletePhoto(photo);
      expect(await asA().photos.listPhotos(mine.id)).toEqual([]);
      const gone = await asA().client.storage.from(PHOTO_BUCKET).createSignedUrl(`${asA().id}/${mine.id}/${photo.id}`, 60);
      expect(gone.error).not.toBeNull();
    });

    it('stops B listing, viewing, downloading, overwriting or deleting A’s photo', async (context) => {
      context.skip(!bucketReady, 'case-photos bucket not set up yet (migration 20261101120000 not applied)');
      const mine = await asA().cases.createCase(input());
      const photo = await asA().photos.uploadPhoto(mine.id, 'preop', syntheticPng());
      const path = `${asA().id}/${mine.id}/${photo.id}`;
      const storageB = asB().client.storage.from(PHOTO_BUCKET);

      expect(await asB().photos.listPhotos(mine.id)).toEqual([]);
      expect((await storageB.createSignedUrl(path, 60)).error).not.toBeNull();
      expect((await storageB.download(path)).error).not.toBeNull();
      expect((await storageB.list(`${asA().id}/${mine.id}`)).data ?? []).toEqual([]);

      const overwrite = await rawUpload(asB(), path, syntheticPng(), 'image/png');
      expect(overwrite.status).toBeGreaterThanOrEqual(400);
      const upsert = await rawUpload(asB(), path, syntheticPng(), 'image/png', true);
      expect(upsert.status).toBeGreaterThanOrEqual(400);

      const removal = await storageB.remove([path]);
      expect(removal.data ?? []).toEqual([]);

      // Still intact for A.
      const url = (await asA().photos.viewUrls([photo])).get(photo.id);
      expect((await fetch(url!)).status).toBe(200);
    });

    it('refuses uploads without a matching record, and files of the wrong type', async (context) => {
      context.skip(!bucketReady, 'case-photos bucket not set up yet (migration 20261101120000 not applied)');
      const mine = await asA().cases.createCase(input());
      const unregistered = `${asA().id}/${mine.id}/${crypto.randomUUID()}`;
      expect((await rawUpload(asA(), unregistered, syntheticPng(), 'image/png')).status).toBeGreaterThanOrEqual(400);

      // A registered path, but a type the bucket does not allow.
      const id = crypto.randomUUID();
      const registered = `${asA().id}/${mine.id}/${id}`;
      throwIfError(
        await asA().client.from('case_attachments').insert({
          id,
          case_id: mine.id,
          category: 'postop',
          storage_path: registered,
          mime_type: 'image/png',
          byte_size: 10,
        }),
        'Registering a test record',
      );
      expect((await rawUpload(asA(), registered, new Blob(['synthetic text']), 'text/plain')).status).toBeGreaterThanOrEqual(400);
      expect((await asA().client.storage.from(PHOTO_BUCKET).list(`${asA().id}/${mine.id}`)).data ?? []).toEqual([]);
    });

    it('strips location and device metadata before the file reaches Storage', async (context) => {
      context.skip(!bucketReady, 'case-photos bucket not set up yet (migration 20261101120000 not applied)');
      const secret = 'GPS-SECRET 51.5N 0.12W PhoneModel';
      const exif = jpegSegment(0xe1, [...Array.from('Exif\0\0MM\0*\0\0\0\x08\0\0', (c) => c.charCodeAt(0)), ...Array.from(secret, (c) => c.charCodeAt(0))]);
      const comment = jpegSegment(0xfe, Array.from(secret, (c) => c.charCodeAt(0)));
      const original = new File([new Uint8Array(syntheticImageBytes('image/jpeg', 64, [...exif, ...comment]))], 'with-metadata.jpg', { type: 'image/jpeg' });
      expect(new TextDecoder('latin1').decode(new Uint8Array(await original.arrayBuffer()))).toContain('GPS-SECRET');

      const mine = await asA().cases.createCase(input());
      const photo = await asA().photos.uploadPhoto(mine.id, 'ot', original);
      const stored = new Uint8Array(await (await asA().photos.downloadPhoto(photo)).arrayBuffer());
      const text = new TextDecoder('latin1').decode(stored);
      expect(text).not.toContain('GPS-SECRET');
      expect(text).toContain('JFIF');
      expect(stored.length).toBe(photo.byteSize);
    });

    it('exports the owner’s cases and photo files, and nothing of other users', async (context) => {
      context.skip(!bucketReady, 'case-photos bucket not set up yet (migration 20261101120000 not applied)');
      const mine = await asA().cases.createCase(input({ diagnosis: `${runId} export` }));
      const photo = await asA().photos.uploadPhoto(mine.id, 'postop', syntheticPng());
      const exported = await asA().cases.exportCases();
      expect(exported.find((record) => record.id === mine.id)?.sections.ot.fields).toEqual({ findings: 'Synthetic finding' });
      expect((await asA().photos.listAllPhotos()).map((item) => item.id)).toContain(photo.id);
      expect((await asA().photos.downloadPhoto(photo)).size).toBe(photo.byteSize);

      expect((await asB().cases.exportCases()).map((record) => record.id)).not.toContain(mine.id);
      expect((await asB().photos.listAllPhotos()).map((item) => item.id)).not.toContain(photo.id);
      await expect(asB().photos.downloadPhoto(photo)).rejects.toThrow();

      // The Settings exports themselves. (A's ZIP is not built here: other tests
      // in this run may leave A a photo record without its file, and the
      // export rightly refuses to produce an incomplete archive.)
      const exportAs = (session: Session, includePhotos: boolean) =>
        buildExport(
          { repository: session.cases, photos: session.photos, account: new SupabaseAccountService(session.client) },
          { id: session.id, email: null },
          { includePhotos },
        );
      const cellsOf = async (workbook: Blob) => (await readXlsxFile(workbook)).flatMap((sheet) => sheet.data.flat()).map(String);
      const ownCells = await cellsOf((await exportAs(asA(), false)).blob);
      expect(ownCells).toContain(mine.id);
      expect(ownCells).toContain(photo.id);
      const otherEntries = readZip(new Uint8Array(await (await exportAs(asB(), true)).blob.arrayBuffer()));
      const otherWorkbook = otherEntries.find((entry) => entry.name.endsWith('.xlsx'))!;
      const otherCells = await cellsOf(new Blob([otherWorkbook.data as Uint8Array<ArrayBuffer>]));
      expect(otherCells.filter((value) => value === mine.id || value === photo.id)).toEqual([]);
      const otherZip = { names: otherEntries.map((entry) => entry.name) };
      expect(otherZip.names.join(' ')).not.toContain(mine.id);
    });

    it('removes a case’s photo files before the case is deleted', async (context) => {
      context.skip(!bucketReady, 'case-photos bucket not set up yet (migration 20261101120000 not applied)');
      const mine = await asA().cases.createCase(input());
      await asA().photos.uploadPhoto(mine.id, 'ot', syntheticPng());
      await asA().photos.uploadPhoto(mine.id, 'postop', syntheticPng());

      await asA().photos.deleteCasePhotos(mine.id);
      expect((await asA().client.storage.from(PHOTO_BUCKET).list(`${asA().id}/${mine.id}`)).data ?? []).toEqual([]);
      expect(await asA().cases.deleteCase(mine.id)).toBe(true);
      expect(await asA().photos.listPhotos(mine.id)).toEqual([]);
    });
  });
});
