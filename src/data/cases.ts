export type CaseStatus = 'draft' | 'completed';

export type SurgicalRole = 'primary' | 'assistant' | 'supervisor' | 'observer';

export const SURGICAL_ROLES: { value: SurgicalRole; label: string }[] = [
  { value: 'primary', label: 'Primary surgeon' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'observer', label: 'Observer' },
];

export interface CaseSummary {
  id: string;
  reference: string;
  surgeryDate: string; // YYYY-MM-DD
  procedure: string;
  status: CaseStatus;
  role: SurgicalRole;
}

// Persistence is not implemented yet, so the logbook is always empty.
// Every count shown in the app is derived from this list rather than hard-coded.
export const savedCases: CaseSummary[] = [];

export interface CaseStats {
  total: number;
  thisMonth: number;
  thisYear: number;
  drafts: number;
  byRole: Record<SurgicalRole, number>;
}

export function getCaseStats(cases: CaseSummary[], today = new Date()): CaseStats {
  const year = String(today.getFullYear());
  const month = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const byRole: Record<SurgicalRole, number> = { primary: 0, assistant: 0, supervisor: 0, observer: 0 };

  for (const item of cases) {
    byRole[item.role] += 1;
  }

  return {
    total: cases.length,
    thisMonth: cases.filter((item) => item.surgeryDate.startsWith(month)).length,
    thisYear: cases.filter((item) => item.surgeryDate.startsWith(year)).length,
    drafts: cases.filter((item) => item.status === 'draft').length,
    byRole,
  };
}
