// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DIAGNOSIS_MAX_LENGTH,
  PROCEDURE_MAX_LENGTH,
  SECTION_MAX_BYTES,
  databaseLimitErrors,
  sectionByteSize,
} from '../../src/data/caseLimits';
import { TestDatabase } from './harness';

// The website checks the database limits before saving. These tests compare
// its measurements with PostgreSQL's own, so the two cannot drift apart.

let db: TestDatabase;

beforeAll(async () => {
  db = await TestDatabase.create();
});

afterAll(async () => {
  await db.close();
});

const postgresBytes = async (fields: Record<string, string>) => {
  const [row] = await db.admin<{ bytes: number }>('select octet_length($1::jsonb::text) as bytes', [JSON.stringify(fields)]);
  return Number(row!.bytes);
};

describe('website checks of the database limits', () => {
  it.each<Record<string, string>>([
    {},
    { a: 'b' },
    { indication: 'Synthetic text', asaGrade: 'ASA II', notes: 'Line one\nLine two\t"quoted" \\ backslash' },
    { émoji: 'Ünïcödé 😀 текст 中文', control: '\u0001\u001f' },
    { long: 'x'.repeat(SECTION_MAX_BYTES - 11) },
  ])('measures section %# exactly as PostgreSQL does', async (fields) => {
    expect(sectionByteSize(fields)).toBe(await postgresBytes(fields));
  });

  it('counts characters, not UTF-16 units, as PostgreSQL does', () => {
    const emoji = '😀'.repeat(PROCEDURE_MAX_LENGTH);
    expect(emoji.length).toBe(PROCEDURE_MAX_LENGTH * 2);
    expect(databaseLimitErrors({ ...base(), procedure: emoji })).toEqual({});
    expect(databaseLimitErrors({ ...base(), procedure: `${emoji}x` }).procedure).toBeDefined();
    expect(databaseLimitErrors({ ...base(), diagnosis: 'd'.repeat(DIAGNOSIS_MAX_LENGTH + 1) }).diagnosis).toBeDefined();
  });

  it('agrees with the database at the exact procedure limit', async () => {
    const userId = await db.createUser('limits@example.test');
    const insert = (procedure: string) =>
      db.asUser(userId, (query) => query("insert into public.cases (surgery_date, procedure) values ('2026-10-15', $1)", [procedure]));
    const atLimit = '😀'.repeat(PROCEDURE_MAX_LENGTH);
    await insert(atLimit);
    await expect(insert(`${atLimit}x`)).rejects.toMatchObject({ code: '23514' });
  });
});

function base() {
  return {
    reference: '',
    surgeryDate: '2026-10-15',
    procedure: 'Synthetic procedure',
    diagnosis: '',
    role: null,
    status: 'draft' as const,
    sections: { preop: {}, ot: {}, postop: {} },
  };
}
