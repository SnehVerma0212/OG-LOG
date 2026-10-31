import type {
  CaseInput,
  CaseRecord,
  CaseStatus,
  CaseSummary,
  CaseValidationErrors,
  SurgicalRole,
} from '@og-log/domain/cases';
import type { DateRange } from '@og-log/domain/dates';

// The only way screens reach case data. Phase 1 uses an in-memory sample
// implementation; a later phase replaces it with an authenticated database
// repository without changing the screens.

export interface CaseListFilters {
  search?: string;
  status?: CaseStatus;
  procedure?: string;
  dateRange?: DateRange | null;
  sort?: 'surgeryDate' | 'recentlyUpdated';
  offset?: number;
  limit?: number;
}

export interface ProcedureCount {
  procedure: string;
  count: number;
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

export interface CaseRepository {
  // Describes where data lives, shown to the user so storage is never misrepresented.
  readonly storageDescription: string;
  listCases(filters?: CaseListFilters): Promise<CaseSummary[]>;
  countCases(filters?: Omit<CaseListFilters, 'offset' | 'limit' | 'sort'>): Promise<number>;
  listProcedures(): Promise<ProcedureCount[]>;
  getCase(id: string): Promise<CaseRecord | null>;
  createCase(input: CaseInput): Promise<CaseRecord>;
  updateCase(id: string, input: CaseInput): Promise<CaseRecord>;
  deleteCase(id: string): Promise<boolean>;
  getStats(today?: Date): Promise<CaseStats>;
}

export class CaseValidationError extends Error {
  constructor(readonly errors: CaseValidationErrors) {
    super('The case has fields that need attention.');
    this.name = 'CaseValidationError';
  }
}

export class DuplicateReferenceError extends Error {
  constructor() {
    super('Another case already uses this reference.');
    this.name = 'DuplicateReferenceError';
  }
}

export class CaseNotFoundError extends Error {
  constructor() {
    super('This case no longer exists. It may have been deleted.');
    this.name = 'CaseNotFoundError';
  }
}
