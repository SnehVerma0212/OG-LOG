import {
  normalizeCaseInput,
  SECTION_KEYS,
  type CaseInput,
  type CaseRecord,
  type CaseSummary,
} from '@og-log/domain/cases';

import { generateId as defaultGenerateId } from '../lib/ids';
import { assertSavable } from './caseLimits';
import { caseStats, filterCases, procedureCounts, sortAndPage } from './caseQueries';
import {
  CaseNotFoundError,
  ConcurrentUpdateError,
  DuplicateReferenceError,
  type CaseListFilters,
  type CaseRepository,
  type CaseStats,
  type CreateCaseOptions,
  type ProcedureCount,
  type UpdateCaseOptions,
} from './caseRepository';

// SAMPLE / TEST ONLY. Keeps cases in this page's memory: nothing is sent
// anywhere, and everything is lost when the page reloads. It enforces the same
// validation, normalisation, reference and concurrency rules as the database
// repository so screens can be tested without a server.

interface Options {
  now?: () => Date;
  generateId?: () => string;
}

export class InMemoryCaseRepository implements CaseRepository {
  readonly kind = 'sample';
  readonly storageDescription = 'Sample data held in this browser tab only. It is lost when the page reloads.';
  private readonly cases = new Map<string, CaseRecord>();
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private lastTimestamp = 0;

  constructor(seed: CaseInput[] = [], options: Options = {}) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? defaultGenerateId;
    for (const input of seed) {
      this.create(input, this.generateId());
    }
  }

  async listCases(filters: CaseListFilters = {}): Promise<CaseSummary[]> {
    return sortAndPage(filterCases(this.summaries(), filters), filters);
  }

  async countCases(filters: Omit<CaseListFilters, 'offset' | 'limit' | 'sort'> = {}): Promise<number> {
    return filterCases(this.summaries(), filters).length;
  }

  async listProcedures(): Promise<ProcedureCount[]> {
    return procedureCounts(this.summaries());
  }

  async getCase(id: string): Promise<CaseRecord | null> {
    const record = this.cases.get(id);
    return record ? copy(record) : null;
  }

  async createCase(input: CaseInput, options: CreateCaseOptions = {}): Promise<CaseRecord> {
    const id = options.id ?? this.generateId();
    const existing = this.cases.get(id);
    if (existing) {
      return copy(existing); // A retried save of a case already created.
    }
    return copy(this.create(input, id));
  }

  async updateCase(id: string, input: CaseInput, options: UpdateCaseOptions = {}): Promise<CaseRecord> {
    const existing = this.cases.get(id);
    if (!existing) {
      throw new CaseNotFoundError();
    }
    if (options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== existing.updatedAt) {
      throw new ConcurrentUpdateError();
    }
    assertSavable(input);
    const data = normalizeCaseInput(input);
    this.assertReferenceAvailable(data.reference, id);
    const timestamp = this.timestamp();
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
    return caseStats(this.summaries(), today);
  }

  async exportCases(): Promise<CaseRecord[]> {
    return [...this.cases.values()].map(copy);
  }

  private create(input: CaseInput, id: string): CaseRecord {
    assertSavable(input);
    const data = normalizeCaseInput(input);
    this.assertReferenceAvailable(data.reference, null);
    const timestamp = this.timestamp();
    const section = (key: (typeof SECTION_KEYS)[number]) => ({
      fields: data.sections[key],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const record: CaseRecord = {
      id,
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

  // Strictly increasing, like database timestamps, so concurrent-edit checks
  // can tell two saves in the same millisecond apart.
  private timestamp(): string {
    this.lastTimestamp = Math.max(this.now().getTime(), this.lastTimestamp + 1);
    return new Date(this.lastTimestamp).toISOString();
  }

  private summaries(): CaseSummary[] {
    return [...this.cases.values()].map(toSummary);
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

function toSummary(record: CaseRecord): CaseSummary {
  const { sections: _sections, ...summary } = record;
  return { ...summary };
}

// Callers never share objects with the store, as they would not with a server.
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
