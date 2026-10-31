import { isValidISODate } from './dates';

export type CaseStatus = 'draft' | 'completed';

export type SurgicalRole = 'primary' | 'assistant' | 'supervisor' | 'observer';

export const SURGICAL_ROLES: { value: SurgicalRole; label: string }[] = [
  { value: 'primary', label: 'Primary surgeon' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'observer', label: 'Observer' },
];

export function roleLabel(role: SurgicalRole | null): string {
  return SURGICAL_ROLES.find((item) => item.value === role)?.label ?? 'Role not set';
}

export type SectionKey = 'preop' | 'ot' | 'postop';

export const SECTION_KEYS: SectionKey[] = ['preop', 'ot', 'postop'];

// Free-text values keyed by field. Stored as JSON so fields can be added
// later without a schema migration; unknown keys are always preserved.
export type SectionFields = Record<string, string>;

export interface SectionFieldDefinition {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
}

export interface SectionDefinition {
  key: SectionKey;
  label: string;
  description: string;
  fields: SectionFieldDefinition[];
}

export const SECTIONS: SectionDefinition[] = [
  {
    key: 'preop',
    label: 'Preoperative',
    description: 'Assessment and planning before surgery.',
    fields: [
      { key: 'indication', label: 'Indication for surgery', multiline: true },
      { key: 'investigations', label: 'Relevant investigations', multiline: true },
      { key: 'asaGrade', label: 'ASA grade', placeholder: 'e.g. ASA II' },
      { key: 'planningNotes', label: 'Consent and planning notes', multiline: true },
    ],
  },
  {
    key: 'ot',
    label: 'OT Record',
    description: 'What happened in the operation theatre.',
    fields: [
      { key: 'anaesthesia', label: 'Anaesthesia type', placeholder: 'e.g. General anaesthesia' },
      { key: 'technique', label: 'Approach and technique', multiline: true },
      { key: 'findings', label: 'Intraoperative findings', multiline: true },
      { key: 'duration', label: 'Duration', placeholder: 'e.g. 75 minutes' },
      { key: 'complications', label: 'Intraoperative complications', multiline: true },
    ],
  },
  {
    key: 'postop',
    label: 'Postoperative',
    description: 'Recovery, follow-up and outcome.',
    fields: [
      { key: 'course', label: 'Postoperative course', multiline: true },
      { key: 'complications', label: 'Complications', multiline: true },
      { key: 'lengthOfStay', label: 'Length of stay', placeholder: 'e.g. 2 days' },
      { key: 'followUp', label: 'Follow-up and outcome', multiline: true },
    ],
  },
];

export interface CaseSection {
  fields: SectionFields;
  createdAt: string;
  updatedAt: string;
}

export interface CaseRecord {
  id: string;
  reference: string | null;
  surgeryDate: string;
  procedure: string;
  diagnosis: string;
  role: SurgicalRole | null;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  sections: Record<SectionKey, CaseSection>;
}

// Lightweight row used by lists, without section contents.
export type CaseSummary = Omit<CaseRecord, 'sections'>;

// What the form submits to be saved.
export interface CaseInput {
  reference: string;
  surgeryDate: string;
  procedure: string;
  diagnosis: string;
  role: SurgicalRole | null;
  status: CaseStatus;
  sections: Record<SectionKey, SectionFields>;
}

export const REFERENCE_MAX_LENGTH = 40;

export type CaseField = 'reference' | 'surgeryDate' | 'procedure' | 'diagnosis' | 'role';

export type CaseValidationErrors = Partial<Record<CaseField, string>>;

// Drafts need a valid date and a procedure so they can be found in the list.
// Completing a case also requires a diagnosis and surgical role.
export function validateCase(input: CaseInput): CaseValidationErrors {
  const errors: CaseValidationErrors = {};
  const surgeryDate = input.surgeryDate.trim();

  if (!surgeryDate) {
    errors.surgeryDate = 'Enter the surgery date.';
  } else if (!isValidISODate(surgeryDate)) {
    errors.surgeryDate = 'Use the format YYYY-MM-DD, e.g. 2026-10-22.';
  }
  if (!input.procedure.trim()) {
    errors.procedure = 'Enter the procedure name.';
  }
  if (input.reference.trim().length > REFERENCE_MAX_LENGTH) {
    errors.reference = `Keep the reference to ${REFERENCE_MAX_LENGTH} characters or fewer.`;
  }
  if (input.status === 'completed') {
    if (!input.diagnosis.trim()) {
      errors.diagnosis = 'Enter a diagnosis to mark the case completed.';
    }
    if (!input.role) {
      errors.role = 'Choose your surgical role to mark the case completed.';
    }
  }
  return errors;
}

export function hasErrors(errors: CaseValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

// Trims text, turns a blank reference into null and drops empty section values.
export function normalizeCaseInput(input: CaseInput) {
  const reference = input.reference.trim();
  return {
    reference: reference === '' ? null : reference,
    surgeryDate: input.surgeryDate.trim(),
    procedure: input.procedure.trim(),
    diagnosis: input.diagnosis.trim(),
    role: input.role,
    status: input.status,
    sections: {
      preop: normalizeSectionFields(input.sections.preop),
      ot: normalizeSectionFields(input.sections.ot),
      postop: normalizeSectionFields(input.sections.postop),
    },
  };
}

export function normalizeSectionFields(fields: SectionFields): SectionFields {
  const result: SectionFields = {};
  for (const key of Object.keys(fields).sort()) {
    const value = fields[key].trim();
    if (value !== '') {
      result[key] = value;
    }
  }
  return result;
}
