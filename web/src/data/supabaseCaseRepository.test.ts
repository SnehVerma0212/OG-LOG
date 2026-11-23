import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { CaseInput } from '@og-log/domain/cases';

import {
  CaseNotFoundError,
  CaseSaveError,
  CaseValidationError,
  ConcurrentUpdateError,
  DuplicateReferenceError,
  SessionExpiredError,
} from './caseRepository';
import type { CaseRow } from './caseRows';
import { SupabaseCaseRepository } from './supabaseCaseRepository';

// Unit tests of request building and error mapping only. A recording stand-in
// replaces the Data API; authorization is tested against real PostgreSQL
// (supabase/tests) and real Supabase (supabase/integration).

interface Response {
  data?: unknown;
  error?: { code: string; message: string } | null;
  status?: number;
}

function fakeClient(responses: Response[]) {
  const requests: { table: string; ops: [string, unknown[]][] }[] = [];
  const client = {
    from(table: string) {
      const request = { table, ops: [] as [string, unknown[]][] };
      requests.push(request);
      const response = { data: null, error: null, status: 200, ...(responses.shift() ?? {}) };
      const builder: object = new Proxy(
        {},
        {
          get(_target, property) {
            if (property === 'then') {
              return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve(response).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              request.ops.push([String(property), args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, requests };
}

const ID = '7d3c2f4e-1b2a-4c3d-8e9f-0a1b2c3d4e5f';

function row(overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    id: ID,
    owner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    reference: null,
    surgery_date: '2026-10-15',
    procedure: 'Synthetic procedure',
    diagnosis: '',
    role: null,
    status: 'draft',
    preop: {},
    ot: {},
    postop: {},
    preop_updated_at: '2026-10-15T09:00:00.000001+00:00',
    ot_updated_at: '2026-10-15T09:00:00.000001+00:00',
    postop_updated_at: '2026-10-15T09:00:00.000001+00:00',
    created_at: '2026-10-15T09:00:00.000001+00:00',
    updated_at: '2026-10-15T09:00:00.000001+00:00',
    ...overrides,
  };
}

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    reference: '',
    surgeryDate: '2026-10-15',
    procedure: 'Synthetic procedure',
    diagnosis: '',
    role: null,
    status: 'draft',
    sections: { preop: {}, ot: {}, postop: {} },
    ...overrides,
  };
}

const op = (request: { ops: [string, unknown[]][] }, name: string) => request.ops.find(([method]) => method === name)?.[1];

describe('SupabaseCaseRepository', () => {
  it('says plainly that it stores data in the development database', () => {
    const repository = new SupabaseCaseRepository(fakeClient([]).client);
    expect(repository.kind).toBe('database');
    expect(repository.storageDescription).toMatch(/development database/);
  });

  it('treats IDs that cannot exist as not found, without a request', async () => {
    const { client, requests } = fakeClient([]);
    const repository = new SupabaseCaseRepository(client);
    expect(await repository.getCase('not-a-uuid')).toBeNull();
    expect(await repository.getCase("1' or '1'='1")).toBeNull();
    await expect(repository.updateCase('nope', input())).rejects.toBeInstanceOf(CaseNotFoundError);
    expect(await repository.deleteCase('nope')).toBe(false);
    expect(requests).toEqual([]);
  });

  it('reports a case the database does not return (missing, or another user’s) as not found', async () => {
    const { client } = fakeClient([{ data: null }]);
    expect(await new SupabaseCaseRepository(client).getCase(ID)).toBeNull();
  });

  it('creates a case without sending an owner or timestamps, using the caller’s ID', async () => {
    const { client, requests } = fakeClient([{ data: row({ reference: 'R-1' }) }]);
    const created = await new SupabaseCaseRepository(client).createCase(input({ reference: ' R-1 ' }), { id: ID });
    const [sent] = op(requests[0]!, 'insert') as [Record<string, unknown>];
    expect(Object.keys(sent).sort()).toEqual(['diagnosis', 'id', 'ot', 'postop', 'preop', 'procedure', 'reference', 'role', 'status', 'surgery_date']);
    expect(sent.reference).toBe('R-1');
    expect(created).toMatchObject({ id: ID, reference: 'R-1', updatedAt: '2026-10-15T09:00:00.000001+00:00' });
  });

  it('returns the existing case when a retried create finds it already saved', async () => {
    const { client, requests } = fakeClient([
      { error: { code: '23505', message: 'duplicate key value violates unique constraint "cases_pkey"' }, status: 409 },
      { data: row() },
    ]);
    const created = await new SupabaseCaseRepository(client).createCase(input(), { id: ID });
    expect(created.id).toBe(ID);
    expect(requests.map((request) => request.ops[0]![0])).toEqual(['insert', 'select']);
  });

  it('maps a duplicate reference to DuplicateReferenceError', async () => {
    const { client } = fakeClient([
      { error: { code: '23505', message: 'duplicate key value violates unique constraint "cases_owner_reference_key"' }, status: 409 },
    ]);
    await expect(new SupabaseCaseRepository(client).createCase(input({ reference: 'R-1' }))).rejects.toBeInstanceOf(DuplicateReferenceError);
  });

  it('validates before sending, including the database length limits', async () => {
    const { client, requests } = fakeClient([]);
    const repository = new SupabaseCaseRepository(client);
    await expect(repository.createCase(input({ procedure: '' }))).rejects.toBeInstanceOf(CaseValidationError);
    await expect(repository.createCase(input({ procedure: 'x'.repeat(301) }))).rejects.toMatchObject({
      errors: { procedure: 'Keep the procedure to 300 characters or fewer.' },
    });
    await expect(repository.createCase(input({ sections: { preop: { notes: 'x'.repeat(40000) }, ot: {}, postop: {} } }))).rejects.toBeInstanceOf(
      CaseSaveError,
    );
    expect(requests).toEqual([]);
  });

  it('maps a database CHECK rejection to a message the user can act on', async () => {
    const { client } = fakeClient([{ error: { code: '23514', message: 'violates check constraint' }, status: 400 }]);
    await expect(new SupabaseCaseRepository(client).createCase(input())).rejects.toBeInstanceOf(CaseSaveError);
  });

  it('refuses an update when the case changed since it was loaded', async () => {
    const { client, requests } = fakeClient([{ data: null }, { data: row({ updated_at: '2026-10-16T10:00:00+00:00' }) }]);
    await expect(
      new SupabaseCaseRepository(client).updateCase(ID, input(), { expectedUpdatedAt: '2026-10-15T09:00:00.000001+00:00' }),
    ).rejects.toBeInstanceOf(ConcurrentUpdateError);
    const filters = requests[0]!.ops.filter(([method]) => method === 'eq').map(([, args]) => args);
    expect(filters).toEqual([
      ['id', ID],
      ['updated_at', '2026-10-15T09:00:00.000001+00:00'],
    ]);
    const [sent] = op(requests[0]!, 'update') as [Record<string, unknown>];
    expect(sent).not.toHaveProperty('owner_id');
    expect(sent).not.toHaveProperty('updated_at');
  });

  it('reports an update of a missing case as not found', async () => {
    const { client } = fakeClient([{ data: null }, { data: null }]);
    await expect(
      new SupabaseCaseRepository(client).updateCase(ID, input(), { expectedUpdatedAt: '2026-10-15T09:00:00+00:00' }),
    ).rejects.toBeInstanceOf(CaseNotFoundError);
  });

  it('signals an expired session and asks the app to sign out', async () => {
    const onExpired = vi.fn();
    const { client } = fakeClient([{ error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 }]);
    await expect(new SupabaseCaseRepository(client, onExpired).listCases()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('never shows raw database messages', async () => {
    const { client } = fakeClient([{ error: { code: 'XX000', message: 'internal detail: relation secret' }, status: 500 }]);
    await expect(new SupabaseCaseRepository(client).listCases()).rejects.toThrow('Database request failed (XX000).');
  });

  it('loads every page of summaries, and shares one load between parallel reads', async () => {
    const page = Array.from({ length: 1000 }, (_, index) =>
      row({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, status: index % 2 ? 'draft' : 'completed' }),
    );
    const { client, requests } = fakeClient([{ data: page }, { data: [row()] }]);
    const repository = new SupabaseCaseRepository(client);
    const [cases, drafts, stats] = await Promise.all([
      repository.listCases({ limit: 5 }),
      repository.countCases({ status: 'draft' }),
      repository.getStats(new Date(2026, 9, 20)),
    ]);
    expect(cases).toHaveLength(5);
    expect(drafts).toBe(501);
    expect(stats.total).toBe(1001);
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => op(request, 'range'))).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});
