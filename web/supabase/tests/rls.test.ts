// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { failure, SUPABASE_DEFAULTS, TestDatabase, type Query } from './harness';

// Authorization tests against real PostgreSQL with Row Level Security. Every
// "as A" / "as B" call runs as the `authenticated` role with that user's JWT
// claims, as Supabase's Data API would. Synthetic data only.

let db: TestDatabase;
let userA: string;
let userB: string;


const CASE_COLUMNS = 'id, owner_id, reference, procedure, status';

async function createCase(query: Query, values: Record<string, unknown> = {}) {
  const row = {
    surgery_date: '2026-10-15',
    procedure: 'Synthetic procedure',
    ...values,
  };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const [created] = await query<{ id: string; owner_id: string; reference: string | null }>(
    `insert into public.cases (${columns.join(', ')}) values (${placeholders.join(', ')}) returning ${CASE_COLUMNS}`,
    Object.values(row),
  );
  return created!;
}

async function attach(query: Query, values: { caseId: string; ownerId: string; id?: string }) {
  const id = values.id ?? crypto.randomUUID();
  const [row] = await query<{ id: string; status: string }>(
    `insert into public.case_attachments (id, owner_id, case_id, category, storage_path, mime_type, byte_size, status)
     values ($1, $2, $3, 'ot', $4, 'image/jpeg', 1024, 'verified') returning id, status`,
    [id, values.ownerId, values.caseId, `${values.ownerId}/${values.caseId}/${id}`],
  );
  return row!;
}

// The whole suite runs once per Supabase project default (see harness.ts).
describe.each(SUPABASE_DEFAULTS)('with %s Supabase defaults', (defaults) => {
  beforeEach(async () => {
    db = await TestDatabase.create(defaults);
    userA = await db.createUser('doctor-a@example.test');
    userB = await db.createUser('doctor-b@example.test');
  });

  afterEach(async () => {
    await db.close();
  });

  describe('schema setup', () => {
    it('applies the migration on a Supabase-like database', () => {
      expect(db.migrationNames()).toEqual([
        '../migrations/20261031120000_case_logbook_schema.sql',
        '../migrations/20261101120000_case_photo_storage.sql',
        '../migrations/20261102120000_initial_password_change.sql',
        '../migrations/20261103120000_account_security.sql',
      ]);
    });

    it('enables Row Level Security on every user-data table', async () => {
      const tables = await db.admin<{ relname: string; relrowsecurity: boolean }>(
        `select relname, relrowsecurity from pg_class
         where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
      );
      expect(tables).toEqual([
        { relname: 'audit_events', relrowsecurity: true },
        { relname: 'case_attachments', relrowsecurity: true },
        { relname: 'cases', relrowsecurity: true },
        { relname: 'profiles', relrowsecurity: true },
      ]);
    });

    it('creates a profile automatically for each new user', async () => {
      const profiles = await db.admin<{ id: string }>('select id from public.profiles order by created_at, id');
      expect(profiles.map((row) => row.id).sort()).toEqual([userA, userB].sort());
    });
  });

  describe('cases: isolation between doctors', () => {
    it('assigns the signed-in user as owner when none is given', async () => {
      const created = await db.asUser(userA, (query) => createCase(query));
      expect(created.owner_id).toBe(userA);
    });

    it('B cannot read or enumerate A’s cases', async () => {
      const a = await db.asUser(userA, (query) => createCase(query, { reference: 'A-001', diagnosis: 'Synthetic A' }));
      await db.asUser(userB, (query) => createCase(query, { reference: 'B-001' }));

      await db.asUser(userB, async (query) => {
        expect(await query(`select id from public.cases where id = $1`, [a.id])).toEqual([]);
        const all = await query<{ owner_id: string }>('select owner_id from public.cases');
        expect(all).toEqual([{ owner_id: userB }]);
        expect(await query(`select count(*)::int as n from public.cases`)).toEqual([{ n: 1 }]);
        expect(await query(`select id from public.cases where diagnosis ilike '%synthetic a%'`)).toEqual([]);
      });
    });

    it('B cannot update A’s case, and A’s data is unchanged', async () => {
      const a = await db.asUser(userA, (query) => createCase(query, { procedure: 'Original' }));

      const updated = await db.asUser(userB, (query) =>
        query(`update public.cases set procedure = 'Tampered' where id = $1 returning id`, [a.id]),
      );

      expect(updated).toEqual([]);
      expect(await db.admin('select procedure from public.cases where id = $1', [a.id])).toEqual([{ procedure: 'Original' }]);
    });

    it('B cannot delete A’s case', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      const deleted = await db.asUser(userB, (query) => query('delete from public.cases where id = $1 returning id', [a.id]));
      expect(deleted).toEqual([]);
      expect(await db.admin('select id from public.cases where id = $1', [a.id])).toHaveLength(1);
    });

    it('B cannot create a case owned by A, with or without reading it back', async () => {
      const withReturning = await failure(db.asUser(userB, (query) => createCase(query, { owner_id: userA })));
      expect(withReturning.code).toBe('42501');
      expect(withReturning.message).toMatch(/row-level security/);

      // The Data API can insert without RETURNING, which skips the SELECT policy.
      const withoutReturning = await failure(
        db.asUser(userB, (query) =>
          query(`insert into public.cases (owner_id, surgery_date, procedure) values ($1, '2026-10-15', 'Sneaky')`, [userA]),
        ),
      );
      expect(withoutReturning.code).toBe('42501');
      expect(await db.admin('select id from public.cases')).toEqual([]);
    });

    it('unfiltered updates and deletes by B touch only B’s own cases', async () => {
      const a = await db.asUser(userA, (query) => createCase(query, { procedure: 'A original' }));
      const b = await db.asUser(userB, (query) => createCase(query, { procedure: 'B original' }));

      // No WHERE clause and no RETURNING: only the UPDATE/DELETE policies apply.
      await db.asUser(userB, (query) => query(`update public.cases set procedure = 'Changed by B'`));
      expect(await db.admin('select procedure from public.cases where id = $1', [a.id])).toEqual([{ procedure: 'A original' }]);
      expect(await db.admin('select procedure from public.cases where id = $1', [b.id])).toEqual([{ procedure: 'Changed by B' }]);

      await db.asUser(userB, (query) => query('delete from public.cases'));
      expect(await db.admin<{ id: string }>('select id from public.cases')).toEqual([{ id: a.id }]);
    });

    it('A cannot reassign a case to B, even their own case', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      const result = await failure(
        db.asUser(userA, (query) => query('update public.cases set owner_id = $1 where id = $2', [userB, a.id])),
      );
      expect(result.code).toBe('42501');
      expect(await db.admin('select owner_id from public.cases where id = $1', [a.id])).toEqual([{ owner_id: userA }]);
    });

    it('even server-side code with the service role cannot move a case to another owner', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      const result = await failure(
        db.asServiceRole((query) => query('update public.cases set owner_id = $1 where id = $2', [userB, a.id])),
      );
      expect(result.code).toBe('42501');
      expect(result.message).toMatch(/another owner/);
    });

    it('A can update and delete their own case', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      await db.asUser(userA, async (query) => {
        expect(await query(`update public.cases set procedure = 'Changed' where id = $1 returning procedure`, [a.id])).toEqual([
          { procedure: 'Changed' },
        ]);
        expect(await query('delete from public.cases where id = $1 returning id', [a.id])).toEqual([{ id: a.id }]);
      });
    });

    it('has no table privileges for anonymous visitors', async () => {
      await db.asUser(userA, (query) => createCase(query));
      for (const table of ['cases', 'case_attachments', 'profiles']) {
        const read = await failure(db.asAnon((query) => query(`select * from public.${table}`)));
        expect(read.code).toBe('42501');
      }
      const write = await failure(db.asAnon((query) => createCase(query, { owner_id: userA })));
      expect(write.code).toBe('42501');
    });

    it('shows nothing to a signed-in role whose token has no user ID', async () => {
      await db.asUser(userA, (query) => createCase(query));
      await db.asAuthenticatedWithoutUser(async (query) => {
        expect(await query('select id from public.cases')).toEqual([]);
      });
      const insert = await failure(db.asAuthenticatedWithoutUser((query) => createCase(query)));
      expect(insert.code).toMatch(/^(23502|42501)$/);
    });

    it('does not let signed-in users bypass row checks with table-wide commands', async () => {
      await db.asUser(userA, (query) => createCase(query));
      const truncate = await failure(db.asUser(userB, (query) => query('truncate public.cases')));
      expect(truncate.code).toBe('42501');
      expect(await db.admin('select id from public.cases')).toHaveLength(1);
    });

    it('the service role bypasses RLS, so its key must never reach the browser', async () => {
      await db.asUser(userA, (query) => createCase(query));
      await db.asUser(userB, (query) => createCase(query));
      await db.asServiceRole(async (query) => {
        expect(await query('select id from public.cases')).toHaveLength(2);
      });
    });
  });

  describe('cases: reference uniqueness', () => {
    it('is unique per owner, ignoring case', async () => {
      await db.asUser(userA, (query) => createCase(query, { reference: 'GS-001' }));
      const duplicate = await failure(db.asUser(userA, (query) => createCase(query, { reference: 'gs-001' })));
      expect(duplicate.code).toBe('23505');
    });

    it('allows different owners to use the same reference', async () => {
      await db.asUser(userA, (query) => createCase(query, { reference: 'GS-001' }));
      const b = await db.asUser(userB, (query) => createCase(query, { reference: 'GS-001' }));
      expect(b.reference).toBe('GS-001');
    });

    it('allows any number of cases without a reference, but no blank or padded references', async () => {
      await db.asUser(userA, async (query) => {
        await createCase(query, { reference: null });
        await createCase(query, { reference: null });
      });
      for (const reference of ['', ' GS-002', 'x'.repeat(41)]) {
        const result = await failure(db.asUser(userA, (query) => createCase(query, { reference })));
        expect(result.code).toBe('23514');
      }
    });
  });

  describe('cases: integrity rules', () => {
    it('requires a diagnosis and role for completed cases, as the app does', async () => {
      const result = await failure(db.asUser(userA, (query) => createCase(query, { status: 'completed' })));
      expect(result.code).toBe('23514');
      const ok = await db.asUser(userA, (query) =>
        createCase(query, { status: 'completed', diagnosis: 'Synthetic diagnosis', role: 'primary' }),
      );
      expect(ok.id).toBeTruthy();
    });

    it('rejects invalid roles, statuses, blank procedures and malformed sections', async () => {
      for (const values of [
        { role: 'surgeon' },
        { status: 'archived' },
        { procedure: '   ' },
        { preop: JSON.stringify(['not', 'an', 'object']) },
        { ot: JSON.stringify({ duration: 75 }) },
        { postop: JSON.stringify({ notes: 'x'.repeat(40000) }) },
      ]) {
        const result = await failure(db.asUser(userA, (query) => createCase(query, values)));
        expect(result.code).toMatch(/^(23514|22P02)$/);
      }
    });

    it('sets timestamps on the server and moves only the changed section’s timestamp', async () => {
      const created = await db.asUser(userA, (query) =>
        createCase(query, { created_at: '2000-01-01T00:00:00Z', preop: JSON.stringify({ indication: 'A' }) }),
      );
      type Times = { created_at: string; updated_at: string; preop_updated_at: string; ot_updated_at: string };
      const read = async () =>
        (
          await db.admin<Times>(
            `select created_at::text, updated_at::text, preop_updated_at::text, ot_updated_at::text
             from public.cases where id = $1`,
            [created.id],
          )
        )[0]!;
      const before = await read();
      expect(before.created_at.startsWith('2000')).toBe(false);

      await db.asUser(userA, (query) =>
        query(`update public.cases set ot = '{"findings":"Synthetic"}', created_at = '2000-01-01' where id = $1`, [created.id]),
      );
      const after = await read();

      expect(after.created_at).toBe(before.created_at);
      expect(after.preop_updated_at).toBe(before.preop_updated_at);
      expect(after.ot_updated_at > before.ot_updated_at).toBe(true);
      expect(after.updated_at > before.updated_at).toBe(true);
    });
  });

  describe('case attachments', () => {
    it('lets A attach to their own case, always starting as pending', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      const attachment = await db.asUser(userA, (query) => attach(query, { caseId: a.id, ownerId: userA }));
      expect(attachment.status).toBe('pending');
    });

    it('B cannot attach a record to A’s case, whichever owner B claims', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));

      const asSelf = await failure(db.asUser(userB, (query) => attach(query, { caseId: a.id, ownerId: userB })));
      expect(asSelf.code).toBe('23503'); // the case is not B's: composite foreign key

      const asA = await failure(db.asUser(userB, (query) => attach(query, { caseId: a.id, ownerId: userA })));
      expect(asA.code).toBe('42501'); // cannot create rows owned by A: RLS

      expect(await db.admin('select id from public.case_attachments')).toEqual([]);
    });

    it('gives B the same error for A’s case as for a case that does not exist', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      const real = await failure(db.asUser(userB, (query) => attach(query, { caseId: a.id, ownerId: userB })));
      const missing = await failure(
        db.asUser(userB, (query) => attach(query, { caseId: crypto.randomUUID(), ownerId: userB })),
      );
      expect(real.code).toBe(missing.code);
    });

    it('B cannot read or delete A’s attachments', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      const attachment = await db.asUser(userA, (query) => attach(query, { caseId: a.id, ownerId: userA }));
      await db.asUser(userB, async (query) => {
        expect(await query('select id from public.case_attachments')).toEqual([]);
        expect(await query('delete from public.case_attachments where id = $1 returning id', [attachment.id])).toEqual([]);
        await query('delete from public.case_attachments'); // unfiltered, no RETURNING
      });
      expect(await db.admin('select id from public.case_attachments')).toHaveLength(1);
    });

    it('B cannot attach to A’s case even without reading the row back', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      const id = crypto.randomUUID();
      const result = await failure(
        db.asUser(userB, (query) =>
          query(
            `insert into public.case_attachments (id, owner_id, case_id, category, storage_path, mime_type, byte_size)
             values ($1, $2, $3, 'ot', $4, 'image/jpeg', 10)`,
            [id, userA, a.id, `${userA}/${a.id}/${id}`],
          ),
        ),
      );
      expect(result.code).toBe('42501');
      expect(await db.admin('select id from public.case_attachments')).toEqual([]);
    });

    it('users cannot edit attachment records, including marking them verified', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      const attachment = await db.asUser(userA, (query) => attach(query, { caseId: a.id, ownerId: userA }));
      const result = await failure(
        db.asUser(userA, (query) => query(`update public.case_attachments set status = 'verified' where id = $1`, [attachment.id])),
      );
      expect(result.code).toBe('42501');
    });

    it('requires the storage path to match owner, case and attachment', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      const result = await failure(
        db.asUser(userA, (query) =>
          query(
            `insert into public.case_attachments (owner_id, case_id, category, storage_path, mime_type, byte_size)
             values ($1, $2, 'ot', $3, 'image/jpeg', 10)`,
            [userA, a.id, `${userB}/${a.id}/elsewhere`],
          ),
        ),
      );
      expect(result.code).toBe('23514');
    });

    it('removes attachment records when their case is deleted', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      await db.asUser(userA, (query) => attach(query, { caseId: a.id, ownerId: userA }));
      await db.asUser(userA, (query) => query('delete from public.cases where id = $1', [a.id]));
      expect(await db.admin('select id from public.case_attachments')).toEqual([]);
    });
  });

  describe('profiles', () => {
    it('each user sees and edits only their own profile', async () => {
      await db.asUser(userA, async (query) => {
        expect(await query<{ id: string }>('select id from public.profiles')).toEqual([{ id: userA }]);
        expect(await query(`update public.profiles set display_name = 'Dr A' where id = $1 returning id`, [userB])).toEqual([]);
        expect(await query(`update public.profiles set display_name = 'Dr A' where id = $1 returning display_name`, [userA])).toEqual([
          { display_name: 'Dr A' },
        ]);
      });
    });

    it('an unfiltered profile update changes only the caller’s own profile', async () => {
      await db.asUser(userA, (query) => query(`update public.profiles set display_name = 'Overwritten'`));
      expect(await db.admin('select display_name from public.profiles where id = $1', [userB])).toEqual([
        { display_name: null },
      ]);
    });

    it('users cannot create, delete or re-key profiles', async () => {
      expect((await failure(db.asUser(userA, (query) => query('insert into public.profiles (id) values ($1)', [userA])))).code).toBe(
        '42501',
      );
      expect((await failure(db.asUser(userA, (query) => query('delete from public.profiles where id = $1', [userA])))).code).toBe(
        '42501',
      );
      expect(
        (await failure(db.asUser(userA, (query) => query('update public.profiles set id = $1 where id = $2', [userB, userA])))).code,
      ).toBe('42501');
    });
  });

  describe('account removal', () => {
    it('deleting an Auth user removes their profile, cases and attachments only', async () => {
      const a = await db.asUser(userA, (query) => createCase(query));
      await db.asUser(userA, (query) => attach(query, { caseId: a.id, ownerId: userA }));
      await db.asUser(userB, (query) => createCase(query));

      await db.admin('delete from auth.users where id = $1', [userA]);

      expect(await db.admin('select owner_id from public.cases')).toEqual([{ owner_id: userB }]);
      expect(await db.admin('select id from public.case_attachments')).toEqual([]);
      expect(await db.admin<{ id: string }>('select id from public.profiles')).toEqual([{ id: userB }]);
    });
  });

  describe('authentication claims', () => {
    it('fails closed for a malformed user ID instead of matching anything', async () => {
      await db.asUser(userA, (query) => createCase(query));
      const result = await failure(
        db.asAuthenticatedWithClaims({ sub: 'not-a-uuid' }, (query) => query('select id from public.cases')),
      );
      expect(result.code).toBe('22P02');
    });

    it('fails closed for an empty user ID', async () => {
      await db.asUser(userA, (query) => createCase(query));
      const result = await failure(db.asAuthenticatedWithClaims({ sub: '' }, (query) => query('select id from public.cases')));
      expect(result.code).toBe('22P02');
    });

    it('gives a token for a deleted user no data and no way to write', async () => {
      const ghost = await db.createUser('deleted-doctor@example.test');
      await db.admin('delete from auth.users where id = $1', [ghost]);
      await db.asUser(userA, (query) => createCase(query));
      await db.asUser(ghost, async (query) => {
        expect(await query('select id from public.cases')).toEqual([]);
        expect(await query('select id from public.profiles')).toEqual([]);
      });
      // Refused by Row Level Security (no profile, so the first-password
      // policy fails closed) before the foreign key to auth.users is checked.
      const insert = await failure(db.asUser(ghost, (query) => createCase(query)));
      expect(insert.code).toBe('42501');
      expect(await db.admin('select id from public.cases where owner_id = $1', [ghost])).toEqual([]);
    });
  });

  describe('private schema', () => {
    it('signed-in users and anonymous visitors cannot call private functions', async () => {
      for (const run of [db.asUser.bind(db, userA), db.asAnon.bind(db)]) {
        const result = await failure(run((query) => query('select private.handle_new_user()')));
        expect(result.code).toBe('42501');
        expect(result.message).toMatch(/schema private/);
      }
    });
  });

  describe('database length and size limits (for aligning app validation)', () => {
    it('allows a 300-character procedure and rejects 301', async () => {
      await db.asUser(userA, (query) => createCase(query, { procedure: 'p'.repeat(300) }));
      expect((await failure(db.asUser(userA, (query) => createCase(query, { procedure: 'p'.repeat(301) })))).code).toBe(
        '23514',
      );
    });

    it('allows a 1,000-character diagnosis and rejects 1,001', async () => {
      await db.asUser(userA, (query) => createCase(query, { diagnosis: 'd'.repeat(1000) }));
      expect((await failure(db.asUser(userA, (query) => createCase(query, { diagnosis: 'd'.repeat(1001) })))).code).toBe(
        '23514',
      );
    });

    it('counts characters, not bytes, for text limits', async () => {
      // 300 multi-byte characters (900 bytes in UTF-8) are still within the limit.
      await db.asUser(userA, (query) => createCase(query, { procedure: 'é'.repeat(300) }));
    });

    it('limits each section to 32,768 bytes of Postgres JSON text, including key and punctuation', async () => {
      // Postgres renders {"k": "<value>"}: 9 bytes plus the value.
      const fits = JSON.stringify({ k: 'v'.repeat(32768 - 9) });
      const tooBig = JSON.stringify({ k: 'v'.repeat(32768 - 8) });
      await db.asUser(userA, (query) => createCase(query, { preop: fits }));
      expect((await failure(db.asUser(userA, (query) => createCase(query, { preop: tooBig })))).code).toBe('23514');
    });
  });
});
