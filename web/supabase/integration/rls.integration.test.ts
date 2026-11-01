// @vitest-environment node
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRunId, runCleanupSteps, throwIfError, type CleanupStep } from './cleanup';
import { readIntegrationConfig } from './config';

// Two-user authorization tests against a REAL Supabase development project,
// through the same Data API (PostgREST) and Auth the website will use.
// Run with `npm run test:integration` after following DEVELOPMENT.md.
// Every row written is fictional and its procedure starts with this run's
// unique marker; cleanup deletes only those rows (each user deletes their own),
// then verifies nothing from this run remains. No secret key is used: user A
// and user B sign in with the publishable key like real browsers.

// Vitest exposes `test.env` (OGLOG_IT_* only; see vite.config.ts) here.
const result = readIntegrationConfig(import.meta.env as Record<string, string | undefined>);
const runId = createRunId();
const PROCEDURE = `${runId} synthetic procedure`;
const SURGERY_DATE = '2026-10-15';

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
  let a: SupabaseClient | undefined;
  let b: SupabaseClient | undefined;
  let userA = '';
  let userB = '';
  // undefined until read; cleanup never overwrites a name it did not read.
  let originalNameA: string | null | undefined;
  // Everything this run created or tried to create, for the post-cleanup check.
  const createdCaseIds = new Set<string>();
  const attemptedAttachmentIds = new Set<string>();

  // Typed accessors for use inside tests (beforeAll has signed both users in).
  const asA = () => a!;
  const asB = () => b!;

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
      .insert({ surgery_date: SURGERY_DATE, procedure: PROCEDURE, ...values })
      .select('id, owner_id, reference, procedure, diagnosis, status')
      .single();
    if (error) {
      throw new Error(`createCase failed: ${error.code} ${error.message}`);
    }
    const row = data as { id: string; owner_id: string; reference: string | null; procedure: string; diagnosis: string; status: string };
    createdCaseIds.add(row.id);
    return row;
  }

  // For inserts that are expected to be rejected (still carries the run marker).
  function insertCase(client: SupabaseClient, values: Record<string, unknown>) {
    return client.from('cases').insert({ surgery_date: SURGERY_DATE, procedure: PROCEDURE, ...values });
  }

  function attachmentFor(owner: string, caseId: string) {
    const id = crypto.randomUUID();
    attemptedAttachmentIds.add(id);
    return {
      id,
      owner_id: owner,
      case_id: caseId,
      category: 'ot',
      storage_path: `${owner}/${caseId}/${id}`,
      mime_type: 'image/jpeg',
      byte_size: 1024,
      status: 'verified',
    };
  }

  function expectCode(error: PostgrestError | null, codes: string[]) {
    expect(error, 'expected the request to be rejected').not.toBeNull();
    expect(codes).toContain(error!.code);
  }

  beforeAll(async () => {
    anon = newClient();
    ({ client: a, id: userA } = await signIn(config.userA));
    ({ client: b, id: userB } = await signIn(config.userB));
    const profile = await a.from('profiles').select('display_name').eq('id', userA).single();
    throwIfError(profile, 'Reading user A’s profile');
    originalNameA = (profile.data as { display_name: string | null }).display_name;
  });

  afterAll(async () => {
    const users = [
      { label: 'A', client: a },
      { label: 'B', client: b },
    ].filter((user): user is { label: string; client: SupabaseClient } => user.client !== undefined);
    const caseIds = [...createdCaseIds];
    const attachmentIds = [...attemptedAttachmentIds];
    const steps: CleanupStep[] = [];

    for (const { label, client } of users) {
      steps.push({
        name: `delete user ${label}'s cases from this run`,
        run: async () => throwIfError(await client.from('cases').delete().like('procedure', `${runId}%`), 'Delete'),
      });
    }
    // Each user can see all of their own rows, and every row this run could
    // have written is owned by A or B, so together these checks cover the run.
    for (const { label, client } of users) {
      steps.push({
        name: `verify no cases from this run remain for user ${label}`,
        run: async () => {
          const byMarker = await client.from('cases').select('id').like('procedure', `${runId}%`);
          throwIfError(byMarker, 'Marker check');
          const byId = caseIds.length > 0 ? await client.from('cases').select('id').in('id', caseIds) : { data: [], error: null };
          throwIfError(byId, 'ID check');
          const remaining = new Set([...(byMarker.data ?? []), ...(byId.data ?? [])].map((row) => (row as { id: string }).id));
          if (remaining.size > 0) {
            throw new Error(`${remaining.size} case(s) from this run remain`);
          }
        },
      });
      steps.push({
        name: `verify no attachment records from this run remain for user ${label}`,
        run: async () => {
          if (attachmentIds.length === 0 && caseIds.length === 0) {
            return;
          }
          const filters = [
            attachmentIds.length > 0 ? `id.in.(${attachmentIds.join(',')})` : null,
            caseIds.length > 0 ? `case_id.in.(${caseIds.join(',')})` : null,
          ].filter((filter): filter is string => filter !== null);
          const remaining = await client.from('case_attachments').select('id').or(filters.join(','));
          throwIfError(remaining, 'Attachment check');
          if ((remaining.data ?? []).length > 0) {
            throw new Error(`${remaining.data!.length} attachment record(s) from this run remain`);
          }
        },
      });
    }
    if (a && originalNameA !== undefined) {
      const client = a;
      steps.push({
        name: "restore user A's display name",
        run: async () => {
          throwIfError(await client.from('profiles').update({ display_name: originalNameA }).eq('id', userA), 'Restore');
          const check = await client.from('profiles').select('display_name').eq('id', userA).single();
          throwIfError(check, 'Restore check');
          if ((check.data as { display_name: string | null }).display_name !== originalNameA) {
            throw new Error('display name was not restored');
          }
        },
      });
    }
    // Last, so the checks above still have sessions. Revokes only this session.
    for (const { label, client } of users) {
      steps.push({
        name: `sign out user ${label}`,
        run: async () => throwIfError(await client.auth.signOut({ scope: 'local' }), 'Sign-out'),
      });
    }

    await runCleanupSteps(steps);
  });

  it('signs in two distinct users, and the database takes the owner from the session', async () => {
    expect(userA).not.toBe(userB);
    const created = await createCase(asA());
    expect(created.owner_id).toBe(userA);
  });

  it('created a profile for each user via the auth.users trigger, visible only to its owner', async () => {
    const { data: own } = await asA().from('profiles').select('id');
    expect(own).toEqual([{ id: userA }]);
    const { data: other } = await asB().from('profiles').select('id').eq('id', userA);
    expect(other).toEqual([]);
  });

  it('B cannot read, list, count or search A’s cases', async () => {
    const mine = await createCase(asA(), { diagnosis: `${runId} hidden` });
    const byId = await asB().from('cases').select('id').eq('id', mine.id);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);

    const listed = await asB().from('cases').select('owner_id');
    expect(listed.error).toBeNull();
    expect((listed.data ?? []).every((row) => (row as { owner_id: string }).owner_id === userB)).toBe(true);

    const counted = await asB().from('cases').select('id', { count: 'exact', head: true }).eq('id', mine.id);
    expect(counted.error).toBeNull();
    expect(counted.count).toBe(0);

    // Filtered out by RLS (empty, no error), not rejected by a missing grant.
    const searched = await asB().from('cases').select('id').ilike('diagnosis', `%${runId}%`);
    expect(searched.error).toBeNull();
    expect(searched.data).toEqual([]);

    // A's own search finds it, so the empty result above is not a bad query.
    const ownSearch = await asA().from('cases').select('id').ilike('diagnosis', `%${runId}%`);
    expect(ownSearch.error).toBeNull();
    expect(ownSearch.data).toEqual([{ id: mine.id }]);
  });

  it('B cannot update or delete A’s case (with or without returning rows)', async () => {
    const mine = await createCase(asA(), { diagnosis: 'Original' });

    const returned = await asB().from('cases').update({ diagnosis: 'Tampered' }).eq('id', mine.id).select('id');
    expect(returned.error).toBeNull();
    expect(returned.data).toEqual([]);
    expect((await asB().from('cases').update({ diagnosis: 'Tampered' }).eq('id', mine.id)).error).toBeNull(); // return=minimal
    expect((await asB().from('cases').delete().eq('id', mine.id)).error).toBeNull();

    const check = await asA().from('cases').select('diagnosis').eq('id', mine.id).single();
    expect(check.error).toBeNull();
    expect(check.data).toEqual({ diagnosis: 'Original' });
  });

  it('B cannot create a case owned by A', async () => {
    const { error } = await insertCase(asB(), { owner_id: userA });
    expectCode(error, ['42501']);
  });

  it('A cannot reassign their case to B', async () => {
    const mine = await createCase(asA());
    const { error } = await asA().from('cases').update({ owner_id: userB }).eq('id', mine.id);
    expectCode(error, ['42501']);
    const check = await asA().from('cases').select('owner_id').eq('id', mine.id).single();
    expect(check.data).toEqual({ owner_id: userA });
  });

  it('enforces reference uniqueness per owner, not across owners', async () => {
    const reference = `${runId}-REF`;
    await createCase(asA(), { reference });
    const duplicate = await insertCase(asA(), { reference: reference.toLowerCase() });
    expectCode(duplicate.error, ['23505']);
    const otherOwner = await createCase(asB(), { reference });
    expect(otherOwner.reference).toBe(reference);
  });

  it('B cannot attach a record to A’s case, and A’s own attachments start pending', async () => {
    const mine = await createCase(asA());

    expectCode((await asB().from('case_attachments').insert(attachmentFor(userB, mine.id))).error, ['23503']);
    expectCode((await asB().from('case_attachments').insert(attachmentFor(userA, mine.id))).error, ['42501']);

    const own = await asA().from('case_attachments').insert(attachmentFor(userA, mine.id)).select('id, status').single();
    expect(own.error).toBeNull();
    expect((own.data as { status: string }).status).toBe('pending');

    const edit = await asA().from('case_attachments').update({ status: 'verified' }).eq('id', (own.data as { id: string }).id);
    expectCode(edit.error, ['42501']);
  });

  it('B cannot read or delete A’s attachment metadata', async () => {
    const mine = await createCase(asA());
    const own = await asA().from('case_attachments').insert(attachmentFor(userA, mine.id)).select('id').single();
    expect(own.error).toBeNull();
    const id = (own.data as { id: string }).id;

    // Reads: RLS filters A's row out (empty, no error). A 42501 here would mean
    // the SELECT grant is missing, which is a different (unexpected) state.
    const byId = await asB().from('case_attachments').select('id').eq('id', id);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);
    const counted = await asB().from('case_attachments').select('id', { count: 'exact', head: true }).eq('id', id);
    expect(counted.error).toBeNull();
    expect(counted.count).toBe(0);
    const listed = await asB().from('case_attachments').select('owner_id');
    expect(listed.error).toBeNull();
    expect((listed.data ?? []).every((row) => (row as { owner_id: string }).owner_id === userB)).toBe(true);

    // Deletes: B holds the DELETE grant, so RLS makes these match no rows.
    const deletedReturning = await asB().from('case_attachments').delete().eq('id', id).select('id');
    expect(deletedReturning.error).toBeNull();
    expect(deletedReturning.data).toEqual([]);
    expect((await asB().from('case_attachments').delete().eq('id', id)).error).toBeNull(); // return=minimal

    const still = await asA().from('case_attachments').select('id, owner_id, case_id, status').eq('id', id);
    expect(still.error).toBeNull();
    expect(still.data).toEqual([{ id, owner_id: userA, case_id: mine.id, status: 'pending' }]);
  });

  it('enforces the procedure and diagnosis length limits', async () => {
    const procedureOfLength = (length: number) => `${PROCEDURE} `.padEnd(length, 'x');

    const longest = await createCase(asA(), { procedure: procedureOfLength(300) });
    expect(longest.procedure).toHaveLength(300);
    expectCode((await insertCase(asA(), { procedure: procedureOfLength(301) })).error, ['23514']);

    const longestDiagnosis = await createCase(asA(), { diagnosis: 'd'.repeat(1000) });
    expect(longestDiagnosis.diagnosis).toHaveLength(1000);
    expectCode((await insertCase(asA(), { diagnosis: 'd'.repeat(1001) })).error, ['23514']);
  });

  it('requires a diagnosis and a role before a case is completed', async () => {
    expectCode((await insertCase(asA(), { status: 'completed', role: 'primary' })).error, ['23514']);
    expectCode((await insertCase(asA(), { status: 'completed', role: 'primary', diagnosis: '   ' })).error, ['23514']);
    expectCode((await insertCase(asA(), { status: 'completed', diagnosis: 'Synthetic diagnosis' })).error, ['23514']);

    const completed = await createCase(asA(), { status: 'completed', role: 'primary', diagnosis: 'Synthetic diagnosis' });
    expect(completed.status).toBe('completed');

    // Completing an existing draft is checked too.
    const draft = await createCase(asA());
    expectCode((await asA().from('cases').update({ status: 'completed' }).eq('id', draft.id)).error, ['23514']);
    const check = await asA().from('cases').select('status').eq('id', draft.id).single();
    expect(check.data).toEqual({ status: 'draft' });
  });

  it('gives anonymous visitors no access to private tables', async () => {
    for (const table of ['cases', 'case_attachments', 'profiles']) {
      const { data, error } = await anon.from(table).select('*').limit(1);
      expect(data ?? []).toEqual([]);
      expectCode(error, ['42501']);
    }
  });

  it('does not expose the private schema or its functions through the Data API', async () => {
    // PGRST106: the schema is not in the project's exposed schemas.
    const privateSchema = await asA().schema('private').rpc('handle_new_user');
    expect(privateSchema.data).toBeNull();
    expectCode(privateSchema.error, ['PGRST106']);
    // PGRST202: no such function in an exposed schema.
    const inPublic = await asA().rpc('handle_new_user');
    expect(inPublic.data).toBeNull();
    expectCode(inPublic.error, ['PGRST202']);
  });

  it('lets each user rename only their own profile', async () => {
    const name = `${runId} A`;
    const own = await asA().from('profiles').update({ display_name: name }).eq('id', userA).select('display_name');
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ display_name: name }]);

    const other = await asB().from('profiles').update({ display_name: `${runId} hijack` }).eq('id', userA).select('id');
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);
    expect((await asB().from('profiles').update({ display_name: `${runId} hijack` }).eq('id', userA)).error).toBeNull();

    const check = await asA().from('profiles').select('display_name').eq('id', userA).single();
    expect(check.error).toBeNull();
    expect(check.data).toEqual({ display_name: name });
  });
});
