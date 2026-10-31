import {
  hasErrors,
  normalizeCaseInput,
  SECTION_KEYS,
  validateCase,
  type CaseInput,
  type CaseRecord,
  type CaseSection,
  type CaseStatus,
  type CaseSummary,
  type CaseValidationErrors,
  type SectionFields,
  type SectionKey,
  type SurgicalRole,
} from '../domain/cases';
import { recentMonths, type DateRange } from '../domain/dates';
import type { Database, SqlExecutor, SqlParam } from './database';

// All values supplied by the user are bound as `?` parameters. SQL text in
// this file is built only from constant fragments.

export class CaseValidationError extends Error {
  constructor(readonly errors: CaseValidationErrors) {
    super('The case has fields that need attention.');
    this.name = 'CaseValidationError';
  }
}

export class DuplicateReferenceError extends Error {
  constructor(readonly reference: string) {
    super(`Another case already uses the reference "${reference}".`);
    this.name = 'DuplicateReferenceError';
  }
}

export class CaseNotFoundError extends Error {
  constructor(readonly id: string) {
    super('This case no longer exists. It may have been deleted.');
    this.name = 'CaseNotFoundError';
  }
}

export interface RepositoryOptions {
  now?: () => Date;
}

export interface CreateCaseOptions extends RepositoryOptions {
  generateId: () => string;
}

interface CaseRow {
  id: string;
  reference: string | null;
  surgery_date: string;
  procedure: string;
  diagnosis: string;
  role: SurgicalRole | null;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
}

interface SectionRow {
  section: SectionKey;
  fields: string;
  created_at: string;
  updated_at: string;
}

const CASE_COLUMNS = 'id, reference, surgery_date, procedure, diagnosis, role, status, created_at, updated_at';

export async function createCase(db: Database, input: CaseInput, options: CreateCaseOptions): Promise<CaseRecord> {
  const data = validated(input);
  const id = options.generateId();
  const timestamp = (options.now?.() ?? new Date()).toISOString();

  await db.transaction(async (tx) => {
    await assertReferenceAvailable(tx, data.reference, null);
    await tx.runAsync(
      `INSERT INTO cases (${CASE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.reference, data.surgeryDate, data.procedure, data.diagnosis, data.role, data.status, timestamp, timestamp],
    );
    for (const section of SECTION_KEYS) {
      await tx.runAsync(
        'INSERT INTO case_sections (case_id, section, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, section, JSON.stringify(data.sections[section]), timestamp, timestamp],
      );
    }
  }).catch(mapConstraintError(data.reference));

  return requireCase(db, id);
}

export async function updateCase(
  db: Database,
  id: string,
  input: CaseInput,
  options: RepositoryOptions = {},
): Promise<CaseRecord> {
  const data = validated(input);
  const timestamp = (options.now?.() ?? new Date()).toISOString();

  await db.transaction(async (tx) => {
    const existing = await tx.getFirstAsync<{ id: string }>('SELECT id FROM cases WHERE id = ?', [id]);
    if (!existing) {
      throw new CaseNotFoundError(id);
    }
    await assertReferenceAvailable(tx, data.reference, id);
    await tx.runAsync(
      `UPDATE cases
       SET reference = ?, surgery_date = ?, procedure = ?, diagnosis = ?, role = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [data.reference, data.surgeryDate, data.procedure, data.diagnosis, data.role, data.status, timestamp, id],
    );

    // Each section keeps its own timestamp, which only moves when that section changes.
    const sectionRows = await tx.getAllAsync<SectionRow>(
      'SELECT section, fields, created_at, updated_at FROM case_sections WHERE case_id = ?',
      [id],
    );
    for (const section of SECTION_KEYS) {
      const fields = JSON.stringify(data.sections[section]);
      const row = sectionRows.find((item) => item.section === section);
      if (!row) {
        await tx.runAsync(
          'INSERT INTO case_sections (case_id, section, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [id, section, fields, timestamp, timestamp],
        );
      } else if (row.fields !== fields) {
        await tx.runAsync('UPDATE case_sections SET fields = ?, updated_at = ? WHERE case_id = ? AND section = ?', [
          fields,
          timestamp,
          id,
          section,
        ]);
      }
    }
  }).catch(mapConstraintError(data.reference));

  return requireCase(db, id);
}

export async function getCase(db: SqlExecutor, id: string): Promise<CaseRecord | null> {
  const row = await db.getFirstAsync<CaseRow>(`SELECT ${CASE_COLUMNS} FROM cases WHERE id = ?`, [id]);
  if (!row) {
    return null;
  }
  const sectionRows = await db.getAllAsync<SectionRow>(
    'SELECT section, fields, created_at, updated_at FROM case_sections WHERE case_id = ?',
    [id],
  );
  const summary = toSummary(row);
  const sections = {} as Record<SectionKey, CaseSection>;
  for (const section of SECTION_KEYS) {
    const sectionRow = sectionRows.find((item) => item.section === section);
    sections[section] = sectionRow
      ? { fields: parseFields(sectionRow.fields), createdAt: sectionRow.created_at, updatedAt: sectionRow.updated_at }
      : { fields: {}, createdAt: summary.createdAt, updatedAt: summary.createdAt };
  }
  return { ...summary, sections };
}

// Deletes the case and its sections together. Sections are removed explicitly
// because SQLite only enforces ON DELETE CASCADE when foreign keys are enabled
// on the connection, and expo-sqlite runs exclusive transactions on a separate one.
export async function deleteCase(db: Database, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.runAsync('DELETE FROM case_sections WHERE case_id = ?', [id]);
    const result = await tx.runAsync('DELETE FROM cases WHERE id = ?', [id]);
    return result.changes > 0;
  });
}

export interface CaseListFilters {
  search?: string;
  status?: CaseStatus;
  procedure?: string;
  dateRange?: DateRange | null;
  sort?: 'surgeryDate' | 'recentlyUpdated';
  limit?: number;
}

export async function listCases(db: SqlExecutor, filters: CaseListFilters = {}): Promise<CaseSummary[]> {
  const conditions: string[] = [];
  const params: SqlParam[] = [];

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push("(procedure LIKE ? ESCAPE '\\' OR diagnosis LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.procedure) {
    conditions.push('procedure = ? COLLATE NOCASE');
    params.push(filters.procedure);
  }
  if (filters.dateRange) {
    conditions.push('surgery_date >= ? AND surgery_date <= ?');
    params.push(filters.dateRange.from, filters.dateRange.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const order =
    filters.sort === 'recentlyUpdated'
      ? 'ORDER BY updated_at DESC, id'
      : 'ORDER BY surgery_date DESC, updated_at DESC, id';
  let limit = '';
  if (filters.limit !== undefined) {
    limit = 'LIMIT ?';
    params.push(Math.max(0, Math.floor(filters.limit)));
  }

  const rows = await db.getAllAsync<CaseRow>(`SELECT ${CASE_COLUMNS} FROM cases ${where} ${order} ${limit}`, params);
  return rows.map(toSummary);
}

export async function countCases(db: SqlExecutor): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM cases', []);
  return row?.count ?? 0;
}

export interface ProcedureCount {
  procedure: string;
  count: number;
}

// Distinct procedure names (case-insensitive), most frequent first.
export async function listProcedures(db: SqlExecutor): Promise<ProcedureCount[]> {
  return db.getAllAsync<ProcedureCount>(
    `SELECT MIN(procedure) AS procedure, COUNT(*) AS count
     FROM cases
     GROUP BY procedure COLLATE NOCASE
     ORDER BY count DESC, procedure COLLATE NOCASE`,
    [],
  );
}

export async function isReferenceAvailable(db: SqlExecutor, reference: string, excludeId: string | null = null) {
  const trimmed = reference.trim();
  if (!trimmed) {
    return true;
  }
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM cases WHERE reference = ? COLLATE NOCASE AND id IS NOT ? LIMIT 1',
    [trimmed, excludeId],
  );
  return row === null;
}

export interface CaseStats {
  total: number;
  thisMonth: number;
  thisYear: number;
  drafts: number;
  completed: number;
  byRole: Record<SurgicalRole, number>;
  topProcedures: ProcedureCount[];
  monthly: { month: string; count: number }[];
}

export async function getCaseStats(db: SqlExecutor, today: Date = new Date()): Promise<CaseStats> {
  const months = recentMonths(today);
  const thisMonth = months[months.length - 1];
  const thisYear = String(today.getFullYear());

  const totals = await db.getFirstAsync<{ total: number; month: number; year: number; drafts: number; completed: number }>(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(substr(surgery_date, 1, 7) = ?), 0) AS month,
       COALESCE(SUM(substr(surgery_date, 1, 4) = ?), 0) AS year,
       COALESCE(SUM(status = 'draft'), 0) AS drafts,
       COALESCE(SUM(status = 'completed'), 0) AS completed
     FROM cases`,
    [thisMonth, thisYear],
  );

  const roleRows = await db.getAllAsync<{ role: SurgicalRole; count: number }>(
    'SELECT role, COUNT(*) AS count FROM cases WHERE role IS NOT NULL GROUP BY role',
    [],
  );
  const byRole: Record<SurgicalRole, number> = { primary: 0, assistant: 0, supervisor: 0, observer: 0 };
  for (const row of roleRows) {
    byRole[row.role] = row.count;
  }

  const monthRows = await db.getAllAsync<{ month: string; count: number }>(
    `SELECT substr(surgery_date, 1, 7) AS month, COUNT(*) AS count
     FROM cases
     WHERE surgery_date >= ? AND surgery_date < ?
     GROUP BY month`,
    [`${months[0]}-01`, `${thisMonth}-32`],
  );

  return {
    total: totals?.total ?? 0,
    thisMonth: totals?.month ?? 0,
    thisYear: totals?.year ?? 0,
    drafts: totals?.drafts ?? 0,
    completed: totals?.completed ?? 0,
    byRole,
    topProcedures: (await listProcedures(db)).slice(0, 5),
    monthly: months.map((month) => ({ month, count: monthRows.find((row) => row.month === month)?.count ?? 0 })),
  };
}

function validated(input: CaseInput) {
  const errors = validateCase(input);
  if (hasErrors(errors)) {
    throw new CaseValidationError(errors);
  }
  return normalizeCaseInput(input);
}

async function assertReferenceAvailable(tx: SqlExecutor, reference: string | null, excludeId: string | null) {
  if (reference !== null && !(await isReferenceAvailable(tx, reference, excludeId))) {
    throw new DuplicateReferenceError(reference);
  }
}

// The unique index is a backstop in case two saves race past the check above.
function mapConstraintError(reference: string | null) {
  return (error: unknown): never => {
    if (reference !== null && error instanceof Error && /UNIQUE constraint failed: cases\.reference/.test(error.message)) {
      throw new DuplicateReferenceError(reference);
    }
    throw error;
  };
}

async function requireCase(db: SqlExecutor, id: string): Promise<CaseRecord> {
  const record = await getCase(db, id);
  if (!record) {
    throw new CaseNotFoundError(id);
  }
  return record;
}

function toSummary(row: CaseRow): CaseSummary {
  return {
    id: row.id,
    reference: row.reference,
    surgeryDate: row.surgery_date,
    procedure: row.procedure,
    diagnosis: row.diagnosis,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Section JSON is written only by this file, but stay defensive when reading it.
function parseFields(json: string): SectionFields {
  try {
    const value: unknown = JSON.parse(json);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const fields: SectionFields = {};
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string') {
          fields[key] = item;
        }
      }
      return fields;
    }
  } catch {
    // Fall through to an empty section rather than crashing the editor.
  }
  return {};
}

// Makes `%`, `_` and `\` match literally inside a LIKE pattern.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
