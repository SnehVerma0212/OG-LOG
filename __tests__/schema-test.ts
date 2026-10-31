import { migrate, SCHEMA_VERSION } from '../src/db/schema';
import { openRawTestDatabase } from '../test-utils/nodeDatabase';

async function userVersion(db: ReturnType<typeof openRawTestDatabase>) {
  return (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version;
}

describe('schema migrations', () => {
  it('creates the schema on a new database', async () => {
    const db = openRawTestDatabase();
    expect(await userVersion(db)).toBe(0);

    await migrate(db);

    expect(await userVersion(db)).toBe(SCHEMA_VERSION);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    expect(tables.map((table) => table.name)).toEqual(['case_sections', 'cases']);
    db.close();
  });

  it('is safe to run on every launch', async () => {
    const db = openRawTestDatabase();
    await migrate(db);
    await migrate(db);
    expect(await userVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('refuses a database created by a newer app version', async () => {
    const db = openRawTestDatabase();
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toThrow(/Update the app/);
    db.close();
  });

  it('enforces status and role values in the database itself', async () => {
    const db = openRawTestDatabase();
    await migrate(db);
    const insert = (status: string, role: string | null) =>
      db.runAsync(
        `INSERT INTO cases (id, surgery_date, procedure, role, status, created_at, updated_at)
         VALUES (?, '2026-10-01', 'Test', ?, ?, 'now', 'now')`,
        [`${status}-${role}`, role, status],
      );
    await expect(insert('archived', null)).rejects.toThrow(/CHECK constraint/);
    await expect(insert('draft', 'surgeon')).rejects.toThrow(/CHECK constraint/);
    await expect(insert('draft', null)).resolves.toEqual({ changes: 1 });
    db.close();
  });
});
