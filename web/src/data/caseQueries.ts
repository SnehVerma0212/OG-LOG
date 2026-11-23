import type { CaseSummary, SurgicalRole } from '@og-log/domain/cases';
import { recentMonths } from '@og-log/domain/dates';

import type { CaseListFilters, CaseStats, ProcedureCount } from './caseRepository';

// Search, filtering, sorting and statistics over one doctor's case summaries.
// Shared by every repository so the screens behave identically whatever the
// storage. These are presentation helpers, not access control: the database
// only ever returns the signed-in user's rows.

export function filterCases<T extends CaseSummary>(cases: T[], filters: Omit<CaseListFilters, 'offset' | 'limit' | 'sort'>): T[] {
  const search = filters.search?.trim().toLowerCase();
  const procedure = filters.procedure?.toLowerCase();
  return cases.filter((record) => {
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

export function sortAndPage<T extends CaseSummary>(cases: T[], filters: CaseListFilters): T[] {
  const sorted = [...cases].sort(filters.sort === 'recentlyUpdated' ? byRecentlyUpdated : bySurgeryDate);
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  const end = filters.limit === undefined ? undefined : offset + Math.max(0, Math.floor(filters.limit));
  return sorted.slice(offset, end);
}

export function procedureCounts(records: CaseSummary[]): ProcedureCount[] {
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

export function caseStats(all: CaseSummary[], today: Date): CaseStats {
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

function bySurgeryDate(a: CaseSummary, b: CaseSummary): number {
  return (
    b.surgeryDate.localeCompare(a.surgeryDate) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  );
}

function byRecentlyUpdated(a: CaseSummary, b: CaseSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}
