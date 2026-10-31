import { normalizeSectionFields, type CaseInput, type CaseRecord, type CaseStatus, type SectionFields, type SectionKey, type SurgicalRole } from './cases';
import { toISODate } from './dates';

// Everything the case editor holds while the user types. All three sections
// live in one object, so switching sections never loses unsaved input.
export interface CaseFormValues {
  reference: string;
  surgeryDate: string;
  procedure: string;
  diagnosis: string;
  role: SurgicalRole | null;
  sections: Record<SectionKey, SectionFields>;
}

export function emptyFormValues(today: Date): CaseFormValues {
  return {
    reference: '',
    surgeryDate: toISODate(today),
    procedure: '',
    diagnosis: '',
    role: null,
    sections: { preop: {}, ot: {}, postop: {} },
  };
}

export function formValuesFromRecord(record: CaseRecord): CaseFormValues {
  return {
    reference: record.reference ?? '',
    surgeryDate: record.surgeryDate,
    procedure: record.procedure,
    diagnosis: record.diagnosis,
    role: record.role,
    sections: {
      preop: { ...record.sections.preop.fields },
      ot: { ...record.sections.ot.fields },
      postop: { ...record.sections.postop.fields },
    },
  };
}

export function toCaseInput(values: CaseFormValues, status: CaseStatus): CaseInput {
  return { ...values, status };
}

// Compares what would actually be saved, so trailing spaces or a field that
// was typed in and cleared again do not count as unsaved changes.
export function isFormDirty(values: CaseFormValues, baseline: CaseFormValues): boolean {
  return serialize(values) !== serialize(baseline);
}

function serialize(values: CaseFormValues): string {
  return JSON.stringify([
    values.reference.trim(),
    values.surgeryDate.trim(),
    values.procedure.trim(),
    values.diagnosis.trim(),
    values.role,
    normalizeSectionFields(values.sections.preop),
    normalizeSectionFields(values.sections.ot),
    normalizeSectionFields(values.sections.postop),
  ]);
}
