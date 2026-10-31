// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';

import { validateCase } from '@og-log/domain/cases';

import { CASE_WRITE_COLUMNS, fromCaseRow, toCaseWrite, type CaseRow } from '../../src/data/caseRows';
import { sampleCases } from '../../src/data/sampleCases';
import { TestDatabase } from './harness';

// Checks that the shared domain model and the database schema agree: every
// valid synthetic case satisfies the database constraints and reads back
// unchanged through the row mapping, under RLS as its owner.

let db: TestDatabase;
let userA: string;

beforeEach(async () => {
  db = await TestDatabase.create();
  userA = await db.createUser('doctor-a@example.test');
});

afterEach(async () => {
  await db.close();
});

const SELECT_ROW = `
  select id, owner_id, reference, surgery_date::text as surgery_date, procedure, diagnosis, role, status,
         preop, ot, postop,
         to_json(preop_updated_at) #>> '{}' as preop_updated_at,
         to_json(ot_updated_at) #>> '{}' as ot_updated_at,
         to_json(postop_updated_at) #>> '{}' as postop_updated_at,
         to_json(created_at) #>> '{}' as created_at,
         to_json(updated_at) #>> '{}' as updated_at
  from public.cases`;

it('stores and reads back every sample case through the row mapping', async () => {
  const samples = sampleCases(new Date(2026, 9, 31));
  await db.asUser(userA, async (query) => {
    for (const input of samples) {
      expect(validateCase(input)).toEqual({});
      const write = toCaseWrite(input);
      const values = CASE_WRITE_COLUMNS.map((column) => write[column]);
      const placeholders = CASE_WRITE_COLUMNS.map((_, index) => `$${index + 1}`);
      await query(`insert into public.cases (${CASE_WRITE_COLUMNS.join(', ')}) values (${placeholders.join(', ')})`, values);
    }
  });

  const rows = await db.asUser(userA, (query) => query<CaseRow>(`${SELECT_ROW} order by reference`));
  expect(rows).toHaveLength(samples.length);
  for (const [index, row] of rows.entries()) {
    const record = fromCaseRow(row);
    const input = samples[index]!;
    expect(record).toMatchObject({
      reference: input.reference,
      surgeryDate: input.surgeryDate,
      procedure: input.procedure,
      diagnosis: input.diagnosis,
      role: input.role,
      status: input.status,
    });
    expect(record.sections.preop.fields).toEqual(toCaseWrite(input).preop);
    expect(record.sections.ot.updatedAt).toBe(row.ot_updated_at);
    expect(record).not.toHaveProperty('owner_id');
  }
});

it('never sends owner or timestamp columns from the browser', () => {
  const columns: string[] = [...CASE_WRITE_COLUMNS];
  expect(columns).not.toContain('owner_id');
  expect(columns).not.toContain('id');
  expect(columns.some((column) => column.endsWith('_at'))).toBe(false);
});

it('normalises input the same way as the app before writing', () => {
  const write = toCaseWrite({
    reference: '  ',
    surgeryDate: ' 2026-10-01 ',
    procedure: ' Synthetic ',
    diagnosis: '',
    role: null,
    status: 'draft',
    sections: { preop: { indication: ' x ', empty: '  ' }, ot: {}, postop: {} },
  });
  expect(write).toMatchObject({ reference: null, surgery_date: '2026-10-01', procedure: 'Synthetic' });
  expect(write.preop).toEqual({ indication: 'x' });
});
