// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { failure, SUPABASE_DEFAULTS, TestDatabase, type Query } from './harness';

// Audit trail, account deletion and two-step enforcement (migration
// 20261103120000), enforced by PostgreSQL. Synthetic data only.

let db: TestDatabase;
let userA: string;
let userB: string;

const createCase = async (query: Query) =>
  (await query<{ id: string }>("insert into public.cases (surgery_date, procedure) values ('2026-10-15', 'Synthetic procedure') returning id"))[0]!.id;

async function attach(query: Query, owner: string, caseId: string) {
  const id = crypto.randomUUID();
  const path = `${owner}/${caseId}/${id}`;
  await query(
    `insert into public.case_attachments (id, case_id, category, storage_path, mime_type, byte_size) values ($1, $2, 'ot', $3, 'image/jpeg', 10)`,
    [id, caseId, path],
  );
  return { id, path };
}

const events = (userId: string) =>
  db.admin<{ action: string; record_id: string | null }>('select action, record_id from public.audit_events where owner_id = $1 order by id', [userId]);

const enrolMfa = (userId: string, status = 'verified') =>
  db.admin('insert into auth.mfa_factors (user_id, status) values ($1, $2)', [userId, status]);

describe.each(SUPABASE_DEFAULTS)('account security with %s Supabase defaults', (defaults) => {
  beforeEach(async () => {
    db = await TestDatabase.create(defaults);
    userA = await db.createUser('doctor-a@example.test');
    userB = await db.createUser('doctor-b@example.test');
  });

  afterEach(async () => {
    await db.close();
  });

  describe('audit trail', () => {
    it('records case, photo and password events with IDs and times only', async () => {
      const caseId = await db.asUser(userA, createCase);
      await db.asUser(userA, (query) => query("update public.cases set diagnosis = 'Synthetic' where id = $1", [caseId]));
      const photo = await db.asUser(userA, (query) => attach(query, userA, caseId));
      await db.asUser(userA, (query) => query('delete from public.case_attachments where id = $1', [photo.id]));
      await db.asUser(userA, (query) => query('delete from public.cases where id = $1', [caseId]));
      await db.setPassword(userA, 'another-hash');

      expect((await events(userA)).slice(1)).toEqual([
        { action: 'case.created', record_id: caseId },
        { action: 'case.updated', record_id: caseId },
        { action: 'photo.added', record_id: photo.id },
        { action: 'photo.removed', record_id: photo.id },
        { action: 'case.deleted', record_id: caseId },
        { action: 'password.changed', record_id: null },
      ]);
      const columns = await db.admin<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'audit_events' order by ordinal_position",
      );
      expect(columns.map((row) => row.column_name)).toEqual(['id', 'owner_id', 'occurred_at', 'action', 'record_id']);
    });

    it('lets each doctor read only their own events', async () => {
      await db.asUser(userA, createCase);
      expect(await db.asUser(userB, (query) => query('select id from public.audit_events where owner_id = $1', [userA]))).toEqual([]);
      expect((await db.asUser(userA, (query) => query('select action from public.audit_events'))).length).toBeGreaterThan(0);
    });

    it('cannot be forged, edited or erased by users', async () => {
      await db.asUser(userA, createCase);
      const before = await events(userA);
      for (const attempt of [
        (query: Query) => query("insert into public.audit_events (action) values ('case.created')"),
        (query: Query) => query("insert into public.audit_events (owner_id, action) values ($1, 'export.downloaded')", [userB]),
        (query: Query) => query("insert into public.audit_events (action, record_id) values ('export.downloaded', gen_random_uuid())"),
        (query: Query) => query("update public.audit_events set action = 'case.updated'"),
        (query: Query) => query('delete from public.audit_events'),
      ]) {
        expect((await failure(db.asUser(userA, attempt))).code).toBe('42501');
      }
      expect(await events(userA)).toEqual(before);
    });

    it('lets a doctor record their own export', async () => {
      await db.asUser(userA, (query) => query("insert into public.audit_events (action) values ('export.downloaded')"));
      expect((await events(userA)).at(-1)).toEqual({ action: 'export.downloaded', record_id: null });
    });
  });

  describe('account deletion', () => {
    it('deletes the caller’s account and all their records, and nothing of anyone else', async () => {
      const caseA = await db.asUser(userA, createCase);
      await db.asUser(userA, (query) => attach(query, userA, caseA));
      const caseB = await db.asUser(userB, createCase);

      await db.asUser(userA, (query) => query('select public.delete_my_account()'));

      for (const table of ['auth.users', 'public.profiles']) {
        expect(await db.admin(`select id from ${table} where id = $1`, [userA])).toEqual([]);
      }
      for (const table of ['public.cases', 'public.case_attachments', 'public.audit_events']) {
        expect(await db.admin(`select id from ${table} where owner_id = $1`, [userA])).toEqual([]);
      }
      expect(await db.admin('select id from public.cases where id = $1', [caseB])).toHaveLength(1);
      expect((await events(userB)).length).toBeGreaterThan(0);
    });

    it('refuses while photo files remain, so no file is left behind', async () => {
      const caseA = await db.asUser(userA, createCase);
      const photo = await db.asUser(userA, (query) => attach(query, userA, caseA));
      await db.admin("insert into storage.objects (bucket_id, name) values ('case-photos', $1)", [photo.path]);
      const refused = await failure(db.asUser(userA, (query) => query('select public.delete_my_account()')));
      expect(refused.code).toBe('P0001');
      expect(await db.admin('select id from auth.users where id = $1', [userA])).toHaveLength(1);
    });

    it('refuses for an account still using its initial password', async () => {
      const flagged = await db.createUser('new@example.test', { initialPasswordPending: true });
      expect((await failure(db.asUser(flagged, (query) => query('select public.delete_my_account()')))).code).toBe('42501');
      expect(await db.admin('select id from auth.users where id = $1', [flagged])).toHaveLength(1);
    });

    it('requires the second step when the doctor has enrolled it', async () => {
      await enrolMfa(userA);
      expect((await failure(db.asUser(userA, (query) => query('select public.delete_my_account()')))).code).toBe('42501');
      await db.asUserWithSecondStep(userA, (query) => query('select public.delete_my_account()'));
      expect(await db.admin('select id from auth.users where id = $1', [userA])).toEqual([]);
    });

    it('cannot be called by anonymous visitors (refused before the function runs)', async () => {
      const refused = await failure(db.asAnon((query) => query('select public.delete_my_account()')));
      expect(refused.code).toBe('42501');
      expect(refused.message).toMatch(/permission denied for function/);
    });

    it('still lets an administrator delete a user with records in the dashboard', async () => {
      const caseA = await db.asUser(userA, createCase);
      await db.asUser(userA, (query) => attach(query, userA, caseA));
      await db.admin('delete from auth.users where id = $1', [userA]);
      expect(await db.admin('select id from public.cases where owner_id = $1', [userA])).toEqual([]);
    });
  });

  describe('two-step verification', () => {
    it('blocks case, photo and audit access without the second step once a factor is verified', async () => {
      const caseA = await db.asUser(userA, createCase);
      await db.asUser(userA, (query) => attach(query, userA, caseA));
      await enrolMfa(userA);

      await db.asUser(userA, async (query) => {
        expect(await query('select id from public.cases')).toEqual([]);
        expect(await query('select id from public.case_attachments')).toEqual([]);
        expect(await query('select id from public.audit_events')).toEqual([]);
        expect(await query("update public.cases set diagnosis = 'x' returning id")).toEqual([]);
      });
      expect((await failure(db.asUser(userA, createCase))).code).toBe('42501');

      await db.asUserWithSecondStep(userA, async (query) => {
        expect(await query('select id from public.cases')).toEqual([{ id: caseA }]);
        expect(await query('select id from public.case_attachments')).toHaveLength(1);
      });
      await db.asUserWithSecondStep(userA, createCase);
    });

    it('does not affect doctors without a verified factor', async () => {
      await enrolMfa(userA, 'unverified');
      await db.asUser(userA, createCase);
      expect(await db.asUser(userA, (query) => query('select id from public.cases'))).toHaveLength(1);
      expect(await db.asUser(userB, (query) => query('select id from public.cases'))).toEqual([]);
    });

    it('never lets a second step reach another doctor’s records', async () => {
      await db.asUser(userA, createCase);
      expect(await db.asUserWithSecondStep(userB, (query) => query('select id from public.cases'))).toEqual([]);
    });
  });
});
