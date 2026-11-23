import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { CaseInput, CaseRecord, CaseSummary } from '@og-log/domain/cases';

import { assertSavable } from './caseLimits';
import { caseStats, filterCases, procedureCounts, sortAndPage } from './caseQueries';
import {
  CaseNotFoundError,
  CaseSaveError,
  ConcurrentUpdateError,
  DuplicateReferenceError,
  SessionExpiredError,
  type CaseListFilters,
  type CaseRepository,
  type CaseStats,
  type CreateCaseOptions,
  type ProcedureCount,
  type UpdateCaseOptions,
} from './caseRepository';
import { fromCaseRow, toCaseWrite, type CaseRow } from './caseRows';

// Cases in Supabase (public.cases) through the Data API, as the signed-in user.
// Row Level Security limits every query to that user's rows; nothing here
// filters by owner or sends an owner ID, and the database sets owner_id and
// all timestamps itself.
//
// Lists, search and statistics load the user's case summaries (no section
// text) and reuse the shared helpers, so results match the mobile app's rules
// exactly. That suits a personal logbook of up to several thousand cases.

const SUMMARY_COLUMNS = 'id, reference, surgery_date, procedure, diagnosis, role, status, created_at, updated_at';
const PAGE = 1000; // The Data API's default maximum rows per request.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SummaryRow = Pick<CaseRow, 'id' | 'reference' | 'surgery_date' | 'procedure' | 'diagnosis' | 'role' | 'status' | 'created_at' | 'updated_at'>;

export class SupabaseCaseRepository implements CaseRepository {
  readonly kind = 'database';
  readonly storageDescription = 'Saved to the OG-LOG development database. Only your account can see your cases.';
  // Concurrent reads (a page loading list, counts and procedures together)
  // share one request; it is never reused once settled.
  private inFlight: Promise<CaseSummary[]> | null = null;

  constructor(
    private readonly client: SupabaseClient,
    private readonly onSessionExpired: () => void | Promise<void> = () => undefined,
  ) {}

  async listCases(filters: CaseListFilters = {}): Promise<CaseSummary[]> {
    return sortAndPage(filterCases(await this.summaries(), filters), filters);
  }

  async countCases(filters: Omit<CaseListFilters, 'offset' | 'limit' | 'sort'> = {}): Promise<number> {
    return filterCases(await this.summaries(), filters).length;
  }

  async listProcedures(): Promise<ProcedureCount[]> {
    return procedureCounts(await this.summaries());
  }

  async getStats(today: Date = new Date()): Promise<CaseStats> {
    return caseStats(await this.summaries(), today);
  }

  async getCase(id: string): Promise<CaseRecord | null> {
    if (!UUID.test(id)) {
      return null; // Not an ID the database could hold.
    }
    const { data, error, status } = await this.client.from('cases').select('*').eq('id', id).maybeSingle();
    if (error) {
      throw await this.failure(error, status);
    }
    // Another user's case is invisible (RLS), so it is reported as not found.
    return data ? fromCaseRow(data as CaseRow) : null;
  }

  async createCase(input: CaseInput, options: CreateCaseOptions = {}): Promise<CaseRecord> {
    assertSavable(input);
    const row = options.id ? { id: options.id, ...toCaseWrite(input) } : toCaseWrite(input);
    const { data, error, status } = await this.client.from('cases').insert(row).select('*').single();
    if (error) {
      if (options.id && error.code === '23505' && error.message.includes('cases_pkey')) {
        // A retry of a save whose response was lost: return the existing case.
        const existing = await this.getCase(options.id);
        if (existing) {
          return existing;
        }
      }
      throw await this.failure(error, status);
    }
    return fromCaseRow(data as CaseRow);
  }

  async updateCase(id: string, input: CaseInput, options: UpdateCaseOptions = {}): Promise<CaseRecord> {
    if (!UUID.test(id)) {
      throw new CaseNotFoundError();
    }
    assertSavable(input);
    // toCaseWrite never includes id, owner_id or timestamps, so they cannot change.
    let query = this.client.from('cases').update(toCaseWrite(input)).eq('id', id);
    if (options.expectedUpdatedAt !== undefined) {
      query = query.eq('updated_at', options.expectedUpdatedAt);
    }
    const { data, error, status } = await query.select('*').maybeSingle();
    if (error) {
      throw await this.failure(error, status);
    }
    if (!data) {
      // Nothing matched: either the case is gone (or not ours), or it changed.
      if (options.expectedUpdatedAt !== undefined && (await this.getCase(id))) {
        throw new ConcurrentUpdateError();
      }
      throw new CaseNotFoundError();
    }
    return fromCaseRow(data as CaseRow);
  }

  // Photo files must be removed first (see PhotoStore.deleteCasePhotos); the
  // attachment records then go with the case.
  async deleteCase(id: string): Promise<boolean> {
    if (!UUID.test(id)) {
      return false;
    }
    const { data, error, status } = await this.client.from('cases').delete().eq('id', id).select('id');
    if (error) {
      throw await this.failure(error, status);
    }
    return (data ?? []).length > 0;
  }

  async exportCases(): Promise<CaseRecord[]> {
    const all: CaseRecord[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error, status } = await this.client.from('cases').select('*').order('id').range(from, from + PAGE - 1);
      if (error) {
        throw await this.failure(error, status);
      }
      const rows = (data ?? []) as CaseRow[];
      all.push(...rows.map(fromCaseRow));
      if (rows.length < PAGE) {
        return all;
      }
    }
  }

  private summaries(): Promise<CaseSummary[]> {
    if (!this.inFlight) {
      this.inFlight = this.fetchSummaries().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async fetchSummaries(): Promise<CaseSummary[]> {
    const all: CaseSummary[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error, status } = await this.client
        .from('cases')
        .select(SUMMARY_COLUMNS)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) {
        throw await this.failure(error, status);
      }
      const rows = (data ?? []) as SummaryRow[];
      all.push(...rows.map(toSummary));
      if (rows.length < PAGE) {
        return all;
      }
    }
  }

  // Maps database errors to ones the screens understand. Raw database messages
  // are never shown to the user.
  private async failure(error: PostgrestError, status: number): Promise<Error> {
    if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') {
      await this.onSessionExpired();
      return new SessionExpiredError();
    }
    if (error.code === '23505' && error.message.includes('cases_owner_reference_key')) {
      return new DuplicateReferenceError();
    }
    if (error.code === '23514' || error.code === '22001' || error.code === '22007' || error.code === '22008') {
      return new CaseSaveError('The database did not accept one of the values. Check the dates and the length of each field.');
    }
    return new Error(`Database request failed (${error.code || status}).`);
  }
}

function toSummary(row: SummaryRow): CaseSummary {
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
