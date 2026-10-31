import {
  normalizeCaseInput,
  type CaseInput,
  type CaseRecord,
  type CaseStatus,
  type SectionFields,
  type SurgicalRole,
} from '@og-log/domain/cases';

// Maps between the shared domain model and rows of public.cases
// (web/supabase/migrations). Dates and timestamps are strings, as the Supabase
// Data API returns them.

export interface CaseRow {
  id: string;
  owner_id: string;
  reference: string | null;
  surgery_date: string;
  procedure: string;
  diagnosis: string;
  role: SurgicalRole | null;
  status: CaseStatus;
  preop: SectionFields;
  ot: SectionFields;
  postop: SectionFields;
  preop_updated_at: string;
  ot_updated_at: string;
  postop_updated_at: string;
  created_at: string;
  updated_at: string;
}

// Columns a client may write. owner_id, id and every timestamp are left out on
// purpose: the database sets them, so the browser can never assign ownership
// or forge times.
export type CaseWrite = Pick<
  CaseRow,
  'reference' | 'surgery_date' | 'procedure' | 'diagnosis' | 'role' | 'status' | 'preop' | 'ot' | 'postop'
>;

export const CASE_WRITE_COLUMNS: (keyof CaseWrite)[] = [
  'reference',
  'surgery_date',
  'procedure',
  'diagnosis',
  'role',
  'status',
  'preop',
  'ot',
  'postop',
];

// Expects input that already passed validateCase; normalises it the same way
// the mobile app and the in-memory repository do.
export function toCaseWrite(input: CaseInput): CaseWrite {
  const data = normalizeCaseInput(input);
  return {
    reference: data.reference,
    surgery_date: data.surgeryDate,
    procedure: data.procedure,
    diagnosis: data.diagnosis,
    role: data.role,
    status: data.status,
    preop: data.sections.preop,
    ot: data.sections.ot,
    postop: data.sections.postop,
  };
}

// The owner ID is deliberately not part of the domain record.
export function fromCaseRow(row: CaseRow): CaseRecord {
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
    sections: {
      preop: { fields: { ...row.preop }, createdAt: row.created_at, updatedAt: row.preop_updated_at },
      ot: { fields: { ...row.ot }, createdAt: row.created_at, updatedAt: row.ot_updated_at },
      postop: { fields: { ...row.postop }, createdAt: row.created_at, updatedAt: row.postop_updated_at },
    },
  };
}
