// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { failure, SUPABASE_DEFAULTS, TestDatabase, type Query } from './harness';

// First-login password change (migration 20261102120000), enforced by
// PostgreSQL: the flag, who can change it, and Row Level Security while it is
// set. Supabase Auth itself (which writes the password hash) is simulated by
// updating auth.users as the database owner. Synthetic data only.

let db: TestDatabase;

const flag = async (userId: string) =>
  (await db.admin<{ required: boolean }>('select password_change_required as required from public.profiles where id = $1', [userId]))[0]
    ?.required;

const createCase = (query: Query) =>
  query<{ id: string }>("insert into public.cases (surgery_date, procedure) values ('2026-10-15', 'Synthetic procedure') returning id");

describe.each(SUPABASE_DEFAULTS)('initial password change with %s Supabase defaults', (defaults) => {
  let newDoctor: string;

  beforeEach(async () => {
    db = await TestDatabase.create(defaults);
    newDoctor = await db.createUser('new-doctor@example.test', { initialPasswordPending: true });
  });

  afterEach(async () => {
    await db.close();
  });

  it('flags every newly created account, and lets the user read but not clear their own flag', async () => {
    expect(await flag(newDoctor)).toBe(true);
    expect(await db.asUser(newDoctor, (query) => query('select password_change_required from public.profiles'))).toEqual([
      { password_change_required: true },
    ]);
    const attempt = await failure(
      db.asUser(newDoctor, (query) => query('update public.profiles set password_change_required = false where id = $1', [newDoctor])),
    );
    expect(attempt.code).toBe('42501');
    expect(await flag(newDoctor)).toBe(true);
  });

  it('blocks all case and attachment access while the initial password is in use', async () => {
    // A case created by the database owner stands in for any existing data.
    const [existing] = await db.admin<{ id: string }>(
      "insert into public.cases (owner_id, surgery_date, procedure) values ($1, '2026-10-01', 'Synthetic procedure') returning id",
      [newDoctor],
    );
    await db.asUser(newDoctor, async (query) => {
      expect(await query('select id from public.cases')).toEqual([]);
      expect(await query('update public.cases set diagnosis = $1 returning id', ['x'])).toEqual([]);
      expect(await query('delete from public.cases returning id')).toEqual([]);
      expect(await query('select id from public.case_attachments')).toEqual([]);
    });
    expect((await failure(db.asUser(newDoctor, createCase))).code).toBe('42501');
    const attach = await failure(
      db.asUser(newDoctor, (query) => {
        const id = crypto.randomUUID();
        return query(
          `insert into public.case_attachments (id, case_id, category, storage_path, mime_type, byte_size)
           values ($1, $2, 'ot', $3, 'image/jpeg', 10)`,
          [id, existing!.id, `${newDoctor}/${existing!.id}/${id}`],
        );
      }),
    );
    expect(attach.code).toBe('42501');
    expect(await db.admin('select id from public.cases where id = $1', [existing!.id])).toHaveLength(1);
  });

  it('clears the flag only when the password hash changes, then allows normal access', async () => {
    // Auth rewriting the row without a new password (e.g. on sign-in) changes nothing.
    await db.admin('update auth.users set last_sign_in_at = now(), encrypted_password = encrypted_password where id = $1', [newDoctor]);
    expect(await flag(newDoctor)).toBe(true);

    await db.setPassword(newDoctor, 'a-new-hash');
    expect(await flag(newDoctor)).toBe(false);
    const [created] = await db.asUser(newDoctor, createCase);
    expect(await db.asUser(newDoctor, (query) => query('select id from public.cases'))).toEqual([{ id: created!.id }]);

    // Later password changes leave it cleared.
    await db.setPassword(newDoctor, 'another-hash');
    expect(await flag(newDoctor)).toBe(false);
  });

  it('affects only the flagged user, and an administrator can require a new password again', async () => {
    const established = await db.createUser('established@example.test');
    expect(await flag(established)).toBe(false);
    await db.asUser(established, createCase);
    expect(await db.asUser(established, (query) => query('select id from public.cases'))).toHaveLength(1);

    await db.admin('update public.profiles set password_change_required = true where id = $1', [established]);
    expect(await db.asUser(established, (query) => query('select id from public.cases'))).toEqual([]);
    await db.setPassword(established, 'reset-hash');
    expect(await db.asUser(established, (query) => query('select id from public.cases'))).toHaveLength(1);
  });

  it('keeps flags private to each user', async () => {
    const other = await db.createUser('other@example.test');
    expect(await db.asUser(other, (query) => query('select id from public.profiles where id = $1', [newDoctor]))).toEqual([]);
    await db.asUser(other, (query) => query('update public.profiles set display_name = $1 where id = $2', ['x', newDoctor]));
    expect(await flag(newDoctor)).toBe(true);
  });

  it('blocks a user whose profile is missing (fails closed)', async () => {
    const orphan = await db.createUser('orphan@example.test');
    await db.admin('delete from public.profiles where id = $1', [orphan]);
    expect((await failure(db.asUser(orphan, createCase))).code).toBe('42501');
  });
});
