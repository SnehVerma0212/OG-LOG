import {
  CaseNotFoundError,
  CaseValidationError,
  countCases,
  createCase,
  deleteCase,
  DuplicateReferenceError,
  getCase,
  getCaseStats,
  isReferenceAvailable,
  listCases,
  listProcedures,
  updateCase,
} from '../src/db/caseRepository';
import type { Database } from '../src/db/database';
import { caseInput } from '../test-utils/fixtures';
import { nodeBuiltin, openTestDatabase, testClock, testIds, type TestDatabase } from '../test-utils/nodeDatabase';

let db: TestDatabase;
let generateId: () => string;
let now: () => Date;

beforeEach(async () => {
  db = await openTestDatabase();
  generateId = testIds();
  now = testClock();
});

afterEach(() => db.close());

const create = (overrides: Parameters<typeof caseInput>[0] = {}) => createCase(db, caseInput(overrides), { generateId, now });

describe('createCase / getCase', () => {
  it('stores a case with a UUID, timestamps and three sections', async () => {
    const { randomUUID } = nodeBuiltin<{ randomUUID: () => string }>('node:crypto');
    const created = await createCase(
      db,
      caseInput({ reference: ' 2026-001 ', sections: { preop: { asaGrade: 'ASA II' }, ot: {}, postop: {} } }),
      { generateId: randomUUID, now },
    );

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(created.reference).toBe('2026-001');
    expect(created.status).toBe('draft');
    expect(created.createdAt).toBe('2026-10-22T09:00:00.000Z');
    expect(created.updatedAt).toBe(created.createdAt);
    expect(created.sections.preop.fields).toEqual({ asaGrade: 'ASA II' });
    expect(created.sections.ot.fields).toEqual({});
    expect(await getCase(db, created.id)).toEqual(created);
  });

  it('returns null for an unknown id', async () => {
    expect(await getCase(db, 'missing')).toBeNull();
  });

  it('rejects invalid input without writing anything', async () => {
    await expect(create({ surgeryDate: '2026-02-30' })).rejects.toBeInstanceOf(CaseValidationError);
    await expect(create({ procedure: '' })).rejects.toBeInstanceOf(CaseValidationError);
    await expect(create({ status: 'completed', role: null })).rejects.toBeInstanceOf(CaseValidationError);
    expect(await countCases(db)).toBe(0);
  });

  it('rolls back the whole case if a section insert fails', async () => {
    const failing: Database = {
      ...db,
      transaction: (task) =>
        db.transaction((tx) =>
          task({
            ...tx,
            runAsync: (sql, params) =>
              sql.includes("INSERT INTO case_sections") && params[1] === 'ot'
                ? Promise.reject(new Error('simulated failure'))
                : tx.runAsync(sql, params),
          }),
        ),
    };
    await expect(createCase(failing, caseInput(), { generateId, now })).rejects.toThrow('simulated failure');
    expect(await countCases(db)).toBe(0);
    expect(await db.getFirstAsync('SELECT * FROM case_sections', [])).toBeNull();
  });
});

describe('updateCase', () => {
  it('updates the existing case instead of inserting a duplicate', async () => {
    const created = await create();
    const updated = await updateCase(db, created.id, caseInput({ procedure: 'Open cholecystectomy' }), { now });

    expect(updated.id).toBe(created.id);
    expect(updated.procedure).toBe('Open cholecystectomy');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt > created.updatedAt).toBe(true);
    expect(await countCases(db)).toBe(1);
  });

  it('only moves the timestamp of the section that changed', async () => {
    const created = await create({ sections: { preop: { indication: 'Biliary colic' }, ot: {}, postop: {} } });
    const updated = await updateCase(
      db,
      created.id,
      caseInput({ sections: { preop: { indication: 'Biliary colic' }, ot: { findings: 'Inflamed gallbladder' }, postop: {} } }),
      { now },
    );

    expect(updated.sections.preop.updatedAt).toBe(created.sections.preop.updatedAt);
    expect(updated.sections.postop.updatedAt).toBe(created.sections.postop.updatedAt);
    expect(updated.sections.ot.updatedAt > created.sections.ot.updatedAt).toBe(true);
    expect(updated.sections.ot.fields).toEqual({ findings: 'Inflamed gallbladder' });
  });

  it('keeps draft and completed status distinct', async () => {
    const created = await create();
    const stillDraft = await updateCase(db, created.id, caseInput({ diagnosis: 'Updated' }), { now });
    expect(stillDraft.status).toBe('draft');

    const completed = await updateCase(db, created.id, caseInput({ status: 'completed' }), { now });
    expect(completed.status).toBe('completed');

    const reopened = await updateCase(db, created.id, caseInput({ status: 'draft' }), { now });
    expect(reopened.status).toBe('draft');
  });

  it('fails clearly when the case was deleted', async () => {
    await expect(updateCase(db, 'missing', caseInput(), { now })).rejects.toBeInstanceOf(CaseNotFoundError);
  });
});

describe('case references', () => {
  it('rejects a duplicate reference, ignoring case and spaces', async () => {
    await create({ reference: 'GS-001' });
    await expect(create({ reference: ' gs-001 ' })).rejects.toBeInstanceOf(DuplicateReferenceError);
    expect(await countCases(db)).toBe(1);
  });

  it('rejects changing a case to another case’s reference', async () => {
    await create({ reference: 'GS-001' });
    const second = await create({ reference: 'GS-002' });
    await expect(updateCase(db, second.id, caseInput({ reference: 'GS-001' }), { now })).rejects.toBeInstanceOf(
      DuplicateReferenceError,
    );
  });

  it('lets a case keep its own reference when edited', async () => {
    const created = await create({ reference: 'GS-001' });
    await expect(updateCase(db, created.id, caseInput({ reference: 'gs-001' }), { now })).resolves.toMatchObject({
      reference: 'gs-001',
    });
  });

  it('allows any number of cases without a reference', async () => {
    await create({ reference: '' });
    await create({ reference: '  ' });
    expect(await countCases(db)).toBe(2);
  });

  it('reports availability for the form', async () => {
    const created = await create({ reference: 'GS-001' });
    expect(await isReferenceAvailable(db, 'gs-001')).toBe(false);
    expect(await isReferenceAvailable(db, 'gs-001', created.id)).toBe(true);
    expect(await isReferenceAvailable(db, 'GS-002')).toBe(true);
    expect(await isReferenceAvailable(db, '')).toBe(true);
  });
});

describe('listCases search and filters', () => {
  beforeEach(async () => {
    await create({ reference: 'GS-001', procedure: 'Laparoscopic cholecystectomy', surgeryDate: '2026-10-15' });
    await create({
      reference: 'GS-002',
      procedure: 'Inguinal hernia repair',
      diagnosis: 'Right inguinal hernia',
      surgeryDate: '2026-09-02',
      status: 'completed',
    });
    await create({ procedure: 'Appendicectomy', diagnosis: 'Acute appendicitis 100%_match', surgeryDate: '2025-12-30' });
  });

  const procedures = async (filters: Parameters<typeof listCases>[1]) =>
    (await listCases(db, filters)).map((item) => item.procedure);

  it('lists newest surgery date first', async () => {
    expect(await procedures({})).toEqual(['Laparoscopic cholecystectomy', 'Inguinal hernia repair', 'Appendicectomy']);
  });

  it('searches procedure, diagnosis and reference case-insensitively', async () => {
    expect(await procedures({ search: 'HERNIA' })).toEqual(['Inguinal hernia repair']);
    expect(await procedures({ search: 'appendicitis' })).toEqual(['Appendicectomy']);
    expect(await procedures({ search: 'gs-001' })).toEqual(['Laparoscopic cholecystectomy']);
    expect(await procedures({ search: '   ' })).toHaveLength(3);
  });

  it('treats %, _ and quotes in search text literally', async () => {
    expect(await procedures({ search: '%' })).toEqual(['Appendicectomy']);
    expect(await procedures({ search: '_' })).toEqual(['Appendicectomy']);
    expect(await procedures({ search: "' OR 1=1 --" })).toEqual([]);
    expect(await countCases(db)).toBe(3);
  });

  it('filters by status, procedure and date range, alone or combined', async () => {
    expect(await procedures({ status: 'completed' })).toEqual(['Inguinal hernia repair']);
    expect(await procedures({ status: 'draft' })).toHaveLength(2);
    expect(await procedures({ procedure: 'APPENDICECTOMY' })).toEqual(['Appendicectomy']);
    expect(await procedures({ dateRange: { from: '2026-01-01', to: '2026-12-31' } })).toEqual([
      'Laparoscopic cholecystectomy',
      'Inguinal hernia repair',
    ]);
    expect(await procedures({ dateRange: { from: '2026-10-15', to: '2026-10-15' } })).toEqual([
      'Laparoscopic cholecystectomy',
    ]);
    expect(await procedures({ status: 'draft', dateRange: { from: '2026-01-01', to: '2026-12-31' }, search: 'chole' })).toEqual([
      'Laparoscopic cholecystectomy',
    ]);
  });

  it('sorts by most recently updated and limits results', async () => {
    const recent = await listCases(db, { sort: 'recentlyUpdated', limit: 2 });
    expect(recent.map((item) => item.procedure)).toEqual(['Appendicectomy', 'Inguinal hernia repair']);
  });

  it('lists distinct procedures, grouping different capitalisation', async () => {
    await create({ procedure: 'appendicectomy' });
    expect(await listProcedures(db)).toEqual([
      { procedure: 'Appendicectomy', count: 2 },
      { procedure: 'Inguinal hernia repair', count: 1 },
      { procedure: 'Laparoscopic cholecystectomy', count: 1 },
    ]);
  });
});

describe('getCaseStats', () => {
  it('returns zeros for an empty logbook', async () => {
    const stats = await getCaseStats(db, new Date(2026, 9, 22));
    expect(stats).toMatchObject({ total: 0, thisMonth: 0, thisYear: 0, drafts: 0, completed: 0, topProcedures: [] });
    expect(stats.monthly).toHaveLength(6);
    expect(stats.monthly.every((month) => month.count === 0)).toBe(true);
  });

  it('counts only saved cases', async () => {
    await create({ surgeryDate: '2026-10-01', role: 'primary' });
    await create({ surgeryDate: '2026-10-20', role: 'assistant', status: 'completed' });
    await create({ surgeryDate: '2026-06-11', role: null, diagnosis: '' });
    await create({ surgeryDate: '2025-10-20', procedure: 'Appendicectomy', role: 'primary' });

    const stats = await getCaseStats(db, new Date(2026, 9, 22));
    expect(stats.total).toBe(4);
    expect(stats.thisMonth).toBe(2);
    expect(stats.thisYear).toBe(3);
    expect(stats.drafts).toBe(3);
    expect(stats.completed).toBe(1);
    expect(stats.byRole).toEqual({ primary: 2, assistant: 1, supervisor: 0, observer: 0 });
    expect(stats.topProcedures[0]).toEqual({ procedure: 'Laparoscopic cholecystectomy', count: 3 });
    expect(stats.monthly).toEqual([
      { month: '2026-05', count: 0 },
      { month: '2026-06', count: 1 },
      { month: '2026-07', count: 0 },
      { month: '2026-08', count: 0 },
      { month: '2026-09', count: 0 },
      { month: '2026-10', count: 2 },
    ]);
  });
});

describe('deleteCase', () => {
  it('removes the case and all of its sections', async () => {
    const keep = await create({ reference: 'KEEP' });
    const remove = await create({ reference: 'REMOVE', sections: { preop: { indication: 'x' }, ot: {}, postop: {} } });

    expect(await deleteCase(db, remove.id)).toBe(true);

    expect(await getCase(db, remove.id)).toBeNull();
    const orphans = await db.getAllAsync('SELECT * FROM case_sections WHERE case_id = ?', [remove.id]);
    expect(orphans).toEqual([]);
    expect(await getCase(db, keep.id)).not.toBeNull();
    expect(await isReferenceAvailable(db, 'REMOVE')).toBe(true);
  });

  it('reports when there was nothing to delete', async () => {
    expect(await deleteCase(db, 'missing')).toBe(false);
  });
});
