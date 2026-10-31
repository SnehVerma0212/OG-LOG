import { describe, expect, it } from 'vitest';

import type { CaseInput } from '@og-log/domain/cases';

import { CaseNotFoundError, CaseValidationError, DuplicateReferenceError } from './caseRepository';
import { InMemoryCaseRepository } from './inMemoryCaseRepository';
import { sampleCases } from './sampleCases';

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    reference: '',
    surgeryDate: '2026-10-15',
    procedure: 'Test procedure',
    diagnosis: 'Test diagnosis',
    role: 'primary',
    status: 'draft',
    sections: { preop: {}, ot: {}, postop: {} },
    ...overrides,
  };
}

function clock(start = '2026-10-20T09:00:00.000Z') {
  let time = new Date(start).getTime();
  return () => {
    const value = new Date(time);
    time += 60_000;
    return value;
  };
}

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

const repo = (seed: CaseInput[] = []) => new InMemoryCaseRepository(seed, { now: clock(), generateId: ids() });

describe('InMemoryCaseRepository', () => {
  it('says plainly that it is temporary sample storage', () => {
    expect(repo().storageDescription).toMatch(/lost when the page reloads/);
  });

  it('creates, reads, updates and deletes a case', async () => {
    const repository = repo();
    const created = await repository.createCase(input({ reference: ' R-1 ', sections: { preop: { asaGrade: ' ASA II ' }, ot: {}, postop: {} } }));
    expect(created).toMatchObject({ id: 'id-1', reference: 'R-1', status: 'draft' });
    expect(created.sections.preop.fields).toEqual({ asaGrade: 'ASA II' });
    expect(await repository.getCase('id-1')).toEqual(created);

    const updated = await repository.updateCase('id-1', input({ reference: 'R-1', procedure: 'Changed', status: 'completed' }));
    expect(updated).toMatchObject({ id: 'id-1', procedure: 'Changed', status: 'completed', createdAt: created.createdAt });
    expect(updated.updatedAt > created.updatedAt).toBe(true);
    expect(await repository.countCases()).toBe(1);

    expect(await repository.deleteCase('id-1')).toBe(true);
    expect(await repository.getCase('id-1')).toBeNull();
    expect(await repository.deleteCase('id-1')).toBe(false);
  });

  it('applies the shared validation rules', async () => {
    const repository = repo();
    await expect(repository.createCase(input({ procedure: ' ' }))).rejects.toBeInstanceOf(CaseValidationError);
    await expect(repository.createCase(input({ surgeryDate: '2026-02-30' }))).rejects.toBeInstanceOf(CaseValidationError);
    await expect(repository.createCase(input({ status: 'completed', role: null }))).rejects.toBeInstanceOf(CaseValidationError);
    expect(await repository.countCases()).toBe(0);
  });

  it('keeps references unique, ignoring case and spaces', async () => {
    const repository = repo();
    const first = await repository.createCase(input({ reference: 'GS-001' }));
    await expect(repository.createCase(input({ reference: ' gs-001 ' }))).rejects.toBeInstanceOf(DuplicateReferenceError);
    await expect(repository.updateCase(first.id, input({ reference: 'gs-001' }))).resolves.toMatchObject({ reference: 'gs-001' });
    await repository.createCase(input({ reference: '' }));
    await repository.createCase(input({ reference: '' }));
    expect(await repository.countCases()).toBe(3);
  });

  it('only moves the timestamp of a section that changed', async () => {
    const repository = repo();
    const created = await repository.createCase(input({ sections: { preop: { indication: 'A' }, ot: {}, postop: {} } }));
    const updated = await repository.updateCase(
      created.id,
      input({ sections: { preop: { indication: 'A' }, ot: { findings: 'B' }, postop: {} } }),
    );
    expect(updated.sections.preop.updatedAt).toBe(created.sections.preop.updatedAt);
    expect(updated.sections.ot.updatedAt > created.sections.ot.updatedAt).toBe(true);
  });

  it('reports a case that no longer exists', async () => {
    await expect(repo().updateCase('missing', input())).rejects.toBeInstanceOf(CaseNotFoundError);
  });

  it('never shares objects with callers', async () => {
    const repository = repo();
    const created = await repository.createCase(input());
    created.procedure = 'mutated';
    created.sections.preop.fields.x = 'mutated';
    const reread = await repository.getCase(created.id);
    expect(reread?.procedure).toBe('Test procedure');
    expect(reread?.sections.preop.fields).toEqual({});
  });

  it('searches, filters, sorts and pages', async () => {
    const repository = repo([
      input({ reference: 'A-1', procedure: 'Appendicectomy', diagnosis: 'Acute appendicitis', surgeryDate: '2026-10-01' }),
      input({ reference: 'H-1', procedure: 'Hernia repair', surgeryDate: '2026-09-01', status: 'completed' }),
      input({ procedure: 'appendicectomy', diagnosis: 'Recurrent pain 100%', surgeryDate: '2025-12-30' }),
    ]);
    const names = async (filters: Parameters<typeof repository.listCases>[0]) =>
      (await repository.listCases(filters)).map((item) => item.procedure);

    expect(await names({})).toEqual(['Appendicectomy', 'Hernia repair', 'appendicectomy']);
    expect(await names({ search: 'HERNIA' })).toEqual(['Hernia repair']);
    expect(await names({ search: 'h-1' })).toEqual(['Hernia repair']);
    expect(await names({ search: '100%' })).toEqual(['appendicectomy']);
    expect(await names({ status: 'completed' })).toEqual(['Hernia repair']);
    expect(await names({ procedure: 'APPENDICECTOMY' })).toEqual(['Appendicectomy', 'appendicectomy']);
    expect(await names({ dateRange: { from: '2026-01-01', to: '2026-12-31' } })).toEqual(['Appendicectomy', 'Hernia repair']);
    expect(await names({ limit: 1, offset: 1 })).toEqual(['Hernia repair']);
    expect(await names({ sort: 'recentlyUpdated', limit: 1 })).toEqual(['appendicectomy']);
    expect(await repository.countCases({ search: 'appendic' })).toBe(2);
    expect(await repository.listProcedures()).toEqual([
      { procedure: 'Appendicectomy', count: 2 },
      { procedure: 'Hernia repair', count: 1 },
    ]);
    const [summary] = await repository.listCases({ limit: 1 });
    expect(summary).not.toHaveProperty('sections');
  });

  it('calculates statistics only from saved cases', async () => {
    const today = new Date(2026, 9, 22);
    const empty = await repo().getStats(today);
    expect(empty).toMatchObject({ total: 0, thisMonth: 0, drafts: 0, topProcedures: [] });
    expect(empty.monthly).toHaveLength(6);

    const repository = repo([
      input({ surgeryDate: '2026-10-01', role: 'primary' }),
      input({ surgeryDate: '2026-10-20', role: 'assistant', status: 'completed' }),
      input({ surgeryDate: '2026-06-11', role: null, diagnosis: '' }),
      input({ surgeryDate: '2025-10-20', procedure: 'Other' }),
    ]);
    const stats = await repository.getStats(today);
    expect(stats).toMatchObject({ total: 4, thisMonth: 2, thisYear: 3, drafts: 3, completed: 1 });
    expect(stats.byRole).toEqual({ primary: 2, assistant: 1, supervisor: 0, observer: 0 });
    expect(stats.topProcedures[0]).toEqual({ procedure: 'Test procedure', count: 3 });
    expect(stats.monthly.at(-1)).toEqual({ month: '2026-10', count: 2 });
  });

  it('seeds only clearly labelled synthetic sample cases', async () => {
    const samples = sampleCases(new Date(2026, 9, 22));
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.reference).toMatch(/^SAMPLE-\d{3}$/);
    }
    const repository = repo(samples);
    expect(await repository.countCases()).toBe(samples.length);
  });
});
