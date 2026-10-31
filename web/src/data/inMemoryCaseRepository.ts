import {
  hasErrors,
  normalizeCaseInput,
  SECTION_KEYS,
  validateCase,
  type CaseInput,
  type CaseRecord,
  type CaseSummary,
  type SurgicalRole,
} from '@og-log/domain/cases';
import { recentMonths } from '@og-log/domain/dates';

import { generateId as defaultGenerateId } from '../lib/ids';
import {
  CaseNotFoundError,
  CaseValidationError,
  DuplicateReferenceError,
  type CaseListFilters,
  type CaseRepository,
  type CaseStats,
  type ProcedureCount,
} from './caseRepository';

// SAMPLE / DEMO ONLY. Keeps cases in this page's memory: nothing is sent
// anywhere, and everything is lost when the page reloads. It enforces the same
// validation, normalisation and reference rules as the mobile app so screens
// behave the way they will with a real repository.

interface Options {
  now?: () => Date;
  generateId?: () => string;
}

export class InMemoryCaseRepository implements CaseRepository {
  readonly storageDescription = 'Sample data held in this browser tab only. It is lost when the page reloads.';
  private readonly cases = new Map<string, CaseRecord>();
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(seed: CaseInput[] = [], options: Options = {}) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? defaultGenerateId;
    for (const input of seed) {
      this.create(input);
    }
  }

  async listCases(filters: CaseListFilters = {}): Promise<CaseSummary[]> {
    const matches = this.filter(filters).sort(
      filters.sort === 'recentlyUpdated' ? byRecentlyUpdated : bySurgeryDate,
    );
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const end = filters.limit === undefined ? undefined : offset + Math.max(0, Math.floor(filters.limit));
    return matches.slice(offset, end).map(toSummary);
  }

  async countCases(filters: Omit<CaseListFilters, 'offset' | 'limit' | 'sort'> = {}): Promise<number> {
    return this.filter(filters).length;
  }

  async listProcedures(): Promise<ProcedureCount[]> {
    return procedureCounts([...this.cases.values()]);
  }

  async getCase(id: string): Promise<CaseRecord | null> {
    const record = this.cases.get(id);
    return record ? copy(record) : null;
  }

  async createCase(input: CaseInput): Promise<CaseRecord> {
    return copy(this.create(input));
  }

  async updateCase(id: string, input: CaseInput): Promise<CaseRecord> {
    const existing = this.cases.get(id);
    if (!existing) {
      throw new CaseNotFoundError();
    }
    const data = validated(input);
    this.assertReferenceAvailable(data.reference, id);
    const timestamp = this.now().toISOString();
    const sections = { ...existing.sections };
    for (const key of SECTION_KEYS) {
      // Each section's timestamp only moves when that section changes.
      if (JSON.stringify(existing.sections[key].fields) !== JSON.stringify(data.sections[key])) {
        sections[key] = { ...existing.sections[key], fields: data.sections[key], updatedAt: timestamp };
      }
    }
    const updated: CaseRecord = {
      ...existing,
      reference: data.reference,
      surgeryDate: data.surgeryDate,
      procedure: data.procedure,
      diagnosis: data.diagnosis,
      role: data.role,
      status: data.status,
      updatedAt: timestamp,
      sections,
    };
    this.cases.set(id, copy(updated));
    return copy(updated);
  }

  async deleteCase(id: string): Promise<boolean> {
    return this.cases.delete(id);
  }

  async getStats(today: Date = this.now()): Promise<CaseStats> {
    const all = [...this.cases.values()];
    const months = recentMonths(today);
    const thisMonth = months[months.length - 1]!;
    const thisYear = String(today.getFullYear());
    const byRole: Record<SurgicalRole, number> = { primary: 0, assistant: 0, supervisor: 0, observer: 0 };
    for (const record of all) {
      if (record.role) {
        byRole[record.role] += 1;
      }
    }
    return {
      total: all.length,
      thisMonth: all.filter((record) => record.surgeryDate.startsWith(thisMonth)).length,
      thisYear: all.filter((record) => record.surgeryDate.startsWith(thisYear)).length,
      drafts: all.filter((record) => record.status === 'draft').length,
      completed: all.filter((record) => record.status === 'completed').length,
      byRole,
      topProcedures: procedureCounts(all).slice(0, 5),
      monthly: months.map((month) => ({
        month,
        count: all.filter((record) => record.surgeryDate.startsWith(month)).length,
      })),
    };
  }

  private create(input: CaseInput): CaseRecord {
    const data = validated(input);
    this.assertReferenceAvailable(data.reference, null);
    const timestamp = this.now().toISOString();
    const section = (key: (typeof SECTION_KEYS)[number]) => ({
      fields: data.sections[key],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const record: CaseRecord = {
      id: this.generateId(),
      reference: data.reference,
      surgeryDate: data.surgeryDate,
      procedure: data.procedure,
      diagnosis: data.diagnosis,
      role: data.role,
      status: data.status,
      createdAt: timestamp,
      updatedAt: timestamp,
      sections: { preop: section('preop'), ot: section('ot'), postop: section('postop') },
    };
    this.cases.set(record.id, copy(record));
    return record;
  }

  private filter(filters: Omit<CaseListFilters, 'offset' | 'limit' | 'sort'>): CaseRecord[] {
    const search = filters.search?.trim().toLowerCase();
    const procedure = filters.procedure?.toLowerCase();
    return [...this.cases.values()].filter((record) => {
      if (search) {
        const haystack = [record.procedure, record.diagnosis, record.reference ?? ''].map((value) => value.toLowerCase());
        if (!haystack.some((value) => value.includes(search))) {
          return false;
        }
      }
      if (filters.status && record.status !== filters.status) {
        return false;
      }
      if (procedure && record.procedure.toLowerCase() !== procedure) {
        return false;
      }
      if (filters.dateRange) {
        if (record.surgeryDate < filters.dateRange.from || record.surgeryDate > filters.dateRange.to) {
          return false;
        }
      }
      return true;
    });
  }

  // References are unique per logbook, ignoring case and surrounding spaces.
  private assertReferenceAvailable(reference: string | null, excludeId: string | null) {
    if (reference === null) {
      return;
    }
    const wanted = reference.toLowerCase();
    for (const record of this.cases.values()) {
      if (record.id !== excludeId && record.reference?.toLowerCase() === wanted) {
        throw new DuplicateReferenceError();
      }
    }
  }
}

function validated(input: CaseInput) {
  const errors = validateCase(input);
  if (hasErrors(errors)) {
    throw new CaseValidationError(errors);
  }
  return normalizeCaseInput(input);
}

function procedureCounts(records: CaseRecord[]): ProcedureCount[] {
  const groups = new Map<string, ProcedureCount>();
  for (const record of records) {
    const key = record.procedure.toLowerCase();
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (record.procedure < group.procedure) {
        group.procedure = record.procedure;
      }
    } else {
      groups.set(key, { procedure: record.procedure, count: 1 });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.procedure.toLowerCase().localeCompare(b.procedure.toLowerCase()),
  );
}

function bySurgeryDate(a: CaseRecord, b: CaseRecord): number {
  return (
    b.surgeryDate.localeCompare(a.surgeryDate) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  );
}

function byRecentlyUpdated(a: CaseRecord, b: CaseRecord): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}

function toSummary(record: CaseRecord): CaseSummary {
  const { sections: _sections, ...summary } = record;
  return { ...summary };
}

// Callers never share objects with the store, as they would not with a server.
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
