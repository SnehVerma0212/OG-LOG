import { countCases, createCase, getCase, listCases } from '../src/db/caseRepository';
import type { Database } from '../src/db/database';
import { saveCase } from '../src/db/saveCase';
import { caseInput } from '../test-utils/fixtures';
import { openTestDatabase, testClock, testIds, type TestDatabase } from '../test-utils/nodeDatabase';

let db: TestDatabase;
let generateId: () => string;
let now: () => Date;

beforeEach(async () => {
  db = await openTestDatabase();
  generateId = testIds();
  now = testClock();
});

afterEach(() => db.close());

const getDb = () => Promise.resolve<Database>(db);

describe('saveCase', () => {
  it('creates a new draft that the case list shows as a draft', async () => {
    const outcome = await saveCase(getDb, { caseId: null, input: caseInput(), generateId, now });

    expect(outcome.ok).toBe(true);
    const cases = await listCases(db);
    expect(cases).toHaveLength(1);
    expect(cases[0].status).toBe('draft');
  });

  it('updates an existing case instead of creating another', async () => {
    const existing = await createCase(db, caseInput(), { generateId, now });
    const outcome = await saveCase(getDb, {
      caseId: existing.id,
      input: caseInput({ diagnosis: 'Updated diagnosis' }),
      generateId,
      now,
    });

    expect(outcome).toMatchObject({ ok: true, record: { id: existing.id, diagnosis: 'Updated diagnosis' } });
    expect(await countCases(db)).toBe(1);
  });

  it('reports validation errors without opening the database', async () => {
    const getDbSpy = jest.fn(getDb);
    const outcome = await saveCase(getDbSpy, { caseId: null, input: caseInput({ procedure: ' ' }), generateId, now });

    expect(outcome).toEqual({ ok: false, kind: 'validation', errors: { procedure: 'Enter the procedure name.' } });
    expect(getDbSpy).not.toHaveBeenCalled();
    expect(await countCases(db)).toBe(0);
  });

  it('reports a duplicate reference and writes nothing', async () => {
    await createCase(db, caseInput({ reference: 'GS-001' }), { generateId, now });
    const outcome = await saveCase(getDb, { caseId: null, input: caseInput({ reference: 'gs-001' }), generateId, now });

    expect(outcome).toEqual({ ok: false, kind: 'duplicateReference' });
    expect(await countCases(db)).toBe(1);
  });

  it('reports a case that no longer exists', async () => {
    const outcome = await saveCase(getDb, { caseId: 'deleted-id', input: caseInput(), generateId, now });
    expect(outcome).toEqual({ ok: false, kind: 'notFound' });
  });

  it('reports database errors instead of throwing', async () => {
    const openFails = await saveCase(() => Promise.reject(new Error('disk I/O error')), {
      caseId: null,
      input: caseInput(),
      generateId,
      now,
    });
    expect(openFails).toEqual({ ok: false, kind: 'error', message: 'disk I/O error' });

    const failingWrites: Database = {
      ...db,
      transaction: (task) =>
        db.transaction((tx) => task({ ...tx, runAsync: () => Promise.reject(new Error('database is locked')) })),
    };
    const writeFails = await saveCase(() => Promise.resolve(failingWrites), {
      caseId: null,
      input: caseInput(),
      generateId,
      now,
    });
    expect(writeFails).toEqual({ ok: false, kind: 'error', message: 'database is locked' });
    expect(await countCases(db)).toBe(0);
  });

  it('leaves an existing case unchanged when its update fails', async () => {
    const existing = await createCase(db, caseInput({ procedure: 'Original' }), { generateId, now });
    const failingWrites: Database = {
      ...db,
      transaction: (task) =>
        db.transaction((tx) =>
          task({
            ...tx,
            runAsync: (sql, params) =>
              sql.includes('UPDATE case_sections') ? Promise.reject(new Error('simulated failure')) : tx.runAsync(sql, params),
          }),
        ),
    };
    const outcome = await saveCase(() => Promise.resolve(failingWrites), {
      caseId: existing.id,
      input: caseInput({ procedure: 'Changed', sections: { preop: { indication: 'New' }, ot: {}, postop: {} } }),
      generateId,
      now,
    });

    expect(outcome.ok).toBe(false);
    expect((await getCase(db, existing.id))?.procedure).toBe('Original');
  });
});
