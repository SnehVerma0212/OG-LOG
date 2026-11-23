import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { syntheticImage } from '../test/syntheticImages';
import { PhotoError } from './photoStore';
import { SupabasePhotoStore, type ObjectUploader } from './supabasePhotoStore';

// Upload flow with a stand-in client and uploader: request shape, error
// messages and rollback. Real Storage policies are tested in supabase/tests
// and supabase/integration. Synthetic values only.

const USER = '11111111-1111-4111-8111-111111111111';
const CASE = '22222222-2222-4222-8222-222222222222';
const URL_VALUE = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY_VALUE = 'sb_publishable_FAKE';
const TOKEN = 'fake-access-token';

function fakeClient() {
  const inserted: Record<string, unknown>[] = [];
  const deletedIds: unknown[] = [];
  const removedPaths: string[][] = [];
  const builder = (table: string) => {
    let pending: Record<string, unknown> | null = null;
    const chain = {
      insert(row: Record<string, unknown>) {
        pending = row;
        inserted.push(row);
        return chain;
      },
      select: () => chain,
      single: async () => ({
        data: { ...pending, case_id: pending!.case_id, category: pending!.category, created_at: '2026-11-01T00:00:00+00:00' },
        error: null,
        status: 201,
      }),
      delete: () => ({
        eq: async (_column: string, value: unknown) => {
          deletedIds.push(value);
          return { error: null, status: 204 };
        },
      }),
      table,
    };
    return chain;
  };
  const client = {
    from: builder,
    auth: { getSession: async () => ({ data: { session: { access_token: TOKEN, user: { id: USER } } } }) },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removedPaths.push(paths);
          return { data: [], error: null };
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, inserted, deletedIds, removedPaths };
}

describe('SupabasePhotoStore uploads', () => {
  it('registers the record first, then uploads to the owner/case/photo path without overwrite', async () => {
    const { client, inserted } = fakeClient();
    const uploader = vi.fn<ObjectUploader>(async () => ({ status: 200, body: '{"Key":"case-photos/x"}' }));
    const store = new SupabasePhotoStore(client, URL_VALUE, KEY_VALUE, { uploader });

    const photo = await store.uploadPhoto(CASE, 'ot', syntheticImage('image/png'));

    const record = inserted[0]!;
    expect(record).toMatchObject({ case_id: CASE, category: 'ot', mime_type: 'image/png', storage_path: `${USER}/${CASE}/${record.id}` });
    expect(record).not.toHaveProperty('owner_id'); // The database assigns the owner.
    const [{ url, headers }] = uploader.mock.calls[0]!;
    expect(url).toBe(`${URL_VALUE}/storage/v1/object/case-photos/${USER}/${CASE}/${record.id}`);
    expect(headers).toMatchObject({ 'content-type': 'image/png', 'x-upsert': 'false', authorization: `Bearer ${TOKEN}` });
    expect(photo).toMatchObject({ id: record.id, caseId: CASE, section: 'ot' });
  });

  it('reports a missing bucket clearly and removes the record it created', async () => {
    const { client, inserted, deletedIds, removedPaths } = fakeClient();
    const uploader: ObjectUploader = async () => ({
      status: 400,
      body: JSON.stringify({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }),
    });
    const store = new SupabasePhotoStore(client, URL_VALUE, KEY_VALUE, { uploader });

    const error = await store.uploadPhoto(CASE, 'preop', syntheticImage('image/jpeg')).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PhotoError);
    expect((error as PhotoError).message).toMatch(/Photo storage is not set up on the server yet/);
    expect((error as PhotoError).stage).toBe('file');
    expect((error as PhotoError).message).not.toContain(TOKEN);
    expect((error as PhotoError).message).not.toContain(KEY_VALUE);

    const id = inserted[0]!.id;
    expect(removedPaths).toEqual([[`${USER}/${CASE}/${id}`]]);
    expect(deletedIds).toEqual([id]);
  });

  it('signs the user out when Storage rejects the session', async () => {
    const { client } = fakeClient();
    const onSessionExpired = vi.fn();
    const uploader: ObjectUploader = async () => ({ status: 400, body: JSON.stringify({ statusCode: '403', error: 'InvalidJWT', message: 'jwt expired' }) });
    const store = new SupabasePhotoStore(client, URL_VALUE, KEY_VALUE, { uploader, onSessionExpired });
    await expect(store.uploadPhoto(CASE, 'postop', syntheticImage('image/webp'))).rejects.toThrow('Your session has ended. Please sign in again.');
    expect(onSessionExpired).toHaveBeenCalled();
  });

  it('treats an interrupted upload as failed and rolls back', async () => {
    const { client, deletedIds } = fakeClient();
    const uploader: ObjectUploader = async () => {
      throw new Error('Upload was interrupted.');
    };
    const store = new SupabasePhotoStore(client, URL_VALUE, KEY_VALUE, { uploader });
    await expect(store.uploadPhoto(CASE, 'ot', syntheticImage('image/png'))).rejects.toThrow(
      'The upload did not finish. Check your connection and try again.',
    );
    expect(deletedIds).toHaveLength(1);
  });

  it('never contacts the server for a file the browser can tell is invalid', async () => {
    const { client, inserted } = fakeClient();
    const uploader = vi.fn<ObjectUploader>();
    const store = new SupabasePhotoStore(client, URL_VALUE, KEY_VALUE, { uploader });
    await expect(store.uploadPhoto(CASE, 'ot', new File(['%PDF'], 'x.pdf', { type: 'application/pdf' }))).rejects.toThrow(
      'Only JPEG, PNG and WebP photos can be added.',
    );
    expect(inserted).toEqual([]);
    expect(uploader).not.toHaveBeenCalled();
  });
});
