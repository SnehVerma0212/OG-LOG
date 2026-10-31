// @vitest-environment node
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readIntegrationConfig } from './config';

// Two-user authorization tests against a REAL Supabase development project,
// through the same Data API (PostgREST) and Auth the website will use.
// Run with `npm run test:integration` after following DEVELOPMENT.md.
// Every row written is fictional and marked with the ITEST prefix, and is
// deleted again by its owner at the end. No secret key is used: user A and
// user B sign in with the publishable key like real browsers.

// Vitest exposes `test.env` (OGLOG_IT_* only; see vite.config.ts) here.
const result = readIntegrationConfig(import.meta.env as Record<string, string | undefined>);
const runId = `ITEST-${Date.now().toString(36).toUpperCase()}`;
const PROCEDURE = 'ITEST synthetic procedure';

describe('Supabase integration: two-user isolation', () => {
  if (!result.ok) {
    it.skip(`skipped: ${result.reason}`, () => undefined);
    return;
  }
  const { config } = result;

  const newClient = () =>
    createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

  let anon: SupabaseClient;
  let a: SupabaseClient;
  let b: SupabaseClient;
  let userA = '';
  let userB = '';
  let originalNameA: string | null = null;

  async function signIn(credentials: { email: string; password: string }) {
    const client = newClient();
    const { data, error } = await client.auth.signInWithPassword(credentials);
    if (error || !data.user) {
      throw new Error(`Sign-in failed for a test user (${error?.code ?? 'no user'}). Check DEVELOPMENT.md step 4.`);
    }
    return { client, id: data.user.id };
  }

  async function createCase(client: SupabaseClient, values: Record<string, unknown> = {}) {
    const { data, error } = await client
      .from('cases')
      .insert({ surgery_date: '2026-10-15', procedure: PROCEDURE, ...values })
      .select('id, owner_id, reference, procedure')
      .single();
    if (error) {
      throw new Error(`createCase failed: ${error.code} ${error.message}`);
    }
    return data as { id: string; owner_id: string; reference: string | null; procedure: string };
  }

  function expectCode(error: PostgrestError | null, codes: string[]) {
    expect(error, 'expected the request to be rejected').not.toBeNull();
    expect(codes).toContain(error!.code);
  }

  beforeAll(async () => {
    anon = newClient();
    ({ client: a, id: userA } = await signIn(config.userA));
    ({ client: b, id: userB } = await signIn(config.userB));
    const { data } = await a.from('profiles').select('display_name').eq('id', userA).maybeSingle();
    originalNameA = (data as { display_name: string | null } | null)?.display_name ?? null;
  });

  afterAll(async () => {
    // Each user removes only their own synthetic rows (RLS limits them anyway).
    for (const client of [a, b]) {
      await client?.from('cases').delete().like('procedure', 'ITEST synthetic%');
    }
    await a?.from('profiles').update({ display_name: originalNameA }).eq('id', userA);
    await Promise.all([a?.auth.signOut(), b?.auth.signOut()]);
  });

  it('signs in two distinct users, and the database takes the owner from the session', async () => {
    expect(userA).not.toBe(userB);
    const created = await createCase(a);
    expect(created.owner_id).toBe(userA);
  });

  it('created a profile for each user via the auth.users trigger, visible only to its owner', async () => {
    const { data: own } = await a.from('profiles').select('id');
    expect(own).toEqual([{ id: userA }]);
    const { data: other } = await b.from('profiles').select('id').eq('id', userA);
    expect(other).toEqual([]);
  });

  it('B cannot read, list or count A’s cases', async () => {
    const mine = await createCase(a, { diagnosis: `${runId} hidden` });
    const byId = await b.from('cases').select('id').eq('id', mine.id);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);

    const listed = await b.from('cases').select('owner_id');
    expect(listed.error).toBeNull();
    expect((listed.data ?? []).every((row) => (row as { owner_id: string }).owner_id === userB)).toBe(true);

    const searched = await b.from('cases').select('id').ilike('diagnosis', `%${runId}%`);
    expect(searched.data).toEqual([]);
  });

  it('B cannot update or delete A’s case (with or without returning rows)', async () => {
    const mine = await createCase(a, { diagnosis: 'Original' });

    const returned = await b.from('cases').update({ diagnosis: 'Tampered' }).eq('id', mine.id).select('id');
    expect(returned.data).toEqual([]);
    await b.from('cases').update({ diagnosis: 'Tampered' }).eq('id', mine.id); // return=minimal
    await b.from('cases').delete().eq('id', mine.id);

    const check = await a.from('cases').select('diagnosis').eq('id', mine.id).single();
    expect(check.data).toEqual({ diagnosis: 'Original' });
  });

  it('B cannot create a case owned by A', async () => {
    const { error } = await b.from('cases').insert({ owner_id: userA, surgery_date: '2026-10-15', procedure: PROCEDURE });
    expectCode(error, ['42501']);
  });

  it('A cannot reassign their case to B', async () => {
    const mine = await createCase(a);
    const { error } = await a.from('cases').update({ owner_id: userB }).eq('id', mine.id);
    expectCode(error, ['42501']);
    const check = await a.from('cases').select('owner_id').eq('id', mine.id).single();
    expect(check.data).toEqual({ owner_id: userA });
  });

  it('enforces reference uniqueness per owner, not across owners', async () => {
    const reference = `${runId}-REF`;
    await createCase(a, { reference });
    const duplicate = await a.from('cases').insert({ reference: reference.toLowerCase(), surgery_date: '2026-10-15', procedure: PROCEDURE });
    expectCode(duplicate.error, ['23505']);
    const otherOwner = await createCase(b, { reference });
    expect(otherOwner.reference).toBe(reference);
  });

  it('B cannot attach a record to A’s case, and A’s own attachments start pending', async () => {
    const mine = await createCase(a);
    const attachment = (owner: string) => {
      const id = crypto.randomUUID();
      return {
        id,
        owner_id: owner,
        case_id: mine.id,
        category: 'ot',
        storage_path: `${owner}/${mine.id}/${id}`,
        mime_type: 'image/jpeg',
        byte_size: 1024,
        status: 'verified',
      };
    };

    expectCode((await b.from('case_attachments').insert(attachment(userB))).error, ['23503']);
    expectCode((await b.from('case_attachments').insert(attachment(userA))).error, ['42501']);

    const own = await a.from('case_attachments').insert(attachment(userA)).select('id, status').single();
    expect(own.error).toBeNull();
    expect((own.data as { status: string }).status).toBe('pending');

    const edit = await a.from('case_attachments').update({ status: 'verified' }).eq('id', (own.data as { id: string }).id);
    expectCode(edit.error, ['42501']);
  });

  it('gives anonymous visitors no access to private tables', async () => {
    for (const table of ['cases', 'case_attachments', 'profiles']) {
      const { data, error } = await anon.from(table).select('*').limit(1);
      expect(data ?? []).toEqual([]);
      expectCode(error, ['42501']);
    }
  });

  it('does not expose the private schema or its functions through the Data API', async () => {
    const privateSchema = await a.schema('private').rpc('handle_new_user');
    expect(privateSchema.data).toBeNull();
    expect(privateSchema.error).not.toBeNull();
    const inPublic = await a.rpc('handle_new_user');
    expect(inPublic.data).toBeNull();
    expect(inPublic.error).not.toBeNull();
  });

  it('lets each user rename only their own profile', async () => {
    const own = await a.from('profiles').update({ display_name: 'ITEST A' }).eq('id', userA).select('display_name');
    expect(own.data).toEqual([{ display_name: 'ITEST A' }]);
    const other = await b.from('profiles').update({ display_name: 'ITEST hijack' }).eq('id', userA).select('id');
    expect(other.data).toEqual([]);
  });
});
