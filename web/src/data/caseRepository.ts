import type {
  CaseInput,
  CaseRecord,
  CaseStatus,
  CaseSummary,
  CaseValidationErrors,
  SurgicalRole,
} from '@og-log/domain/cases';
import type { DateRange } from '@og-log/domain/dates';

// The only way screens reach case data. The website uses the Supabase
// repository (the signed-in user's rows only, enforced by Row Level Security);
// tests use the in-memory implementation, which follows the same contract.

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

export interface CreateCaseOptions {
  // Chosen by the caller once per new-case form, so a retried save after a
  // lost response finds the case it already created instead of adding another.
  id?: string;
}

export interface UpdateCaseOptions {
  // The updatedAt the editor loaded. If the case changed since (another tab or
  // device), the save is refused with ConcurrentUpdateError.
  expectedUpdatedAt?: string;
}

export interface CaseRepository {
  // 'sample': demo data in memory; 'database': the signed-in user's saved cases.
  readonly kind: 'sample' | 'database';
  // Describes where data lives, shown to the user so storage is never misrepresented.
  readonly storageDescription: string;
  listCases(filters?: CaseListFilters): Promise<CaseSummary[]>;
  countCases(filters?: Omit<CaseListFilters, 'offset' | 'limit' | 'sort'>): Promise<number>;
  listProcedures(): Promise<ProcedureCount[]>;
  getCase(id: string): Promise<CaseRecord | null>;
  createCase(input: CaseInput, options?: CreateCaseOptions): Promise<CaseRecord>;
  updateCase(id: string, input: CaseInput, options?: UpdateCaseOptions): Promise<CaseRecord>;
  deleteCase(id: string): Promise<boolean>;
  getStats(today?: Date): Promise<CaseStats>;
  // Every case with all sections, for the doctor's own data export.
  exportCases(): Promise<CaseRecord[]>;
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

export class ConcurrentUpdateError extends Error {
  constructor() {
    super('This case was changed somewhere else after you opened it. Reload it to see the latest version, then make your changes again.');
    this.name = 'ConcurrentUpdateError';
  }
}

// A save was refused for a reason the user can act on; the message is safe to show.
export class CaseSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseSaveError';
  }
}

// The session expired or was revoked; the user must sign in again.
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has ended. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}
