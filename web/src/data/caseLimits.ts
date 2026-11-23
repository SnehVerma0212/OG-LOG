import {
  hasErrors,
  normalizeCaseInput,
  SECTIONS,
  validateCase,
  type CaseInput,
  type CaseValidationErrors,
  type SectionFields,
} from '@og-log/domain/cases';

import { CaseSaveError, CaseValidationError } from './caseRepository';

// Website-only checks for limits the database enforces (public.cases CHECK
// constraints) but the shared domain validation, also used by the mobile app,
// does not. Checking first gives a clear message instead of a rejected save.
// The database remains the authority.

export const PROCEDURE_MAX_LENGTH = 300;
export const DIAGNOSIS_MAX_LENGTH = 1000;
export const SECTION_MAX_BYTES = 32768;

// Characters as PostgreSQL counts them (code points), not UTF-16 units.
const characters = (value: string) => Array.from(value.trim()).length;

export function databaseLimitErrors(input: CaseInput): CaseValidationErrors {
  const errors: CaseValidationErrors = {};
  if (characters(input.procedure) > PROCEDURE_MAX_LENGTH) {
    errors.procedure = `Keep the procedure to ${PROCEDURE_MAX_LENGTH} characters or fewer.`;
  }
  if (characters(input.diagnosis) > DIAGNOSIS_MAX_LENGTH) {
    errors.diagnosis = `Keep the diagnosis to ${DIAGNOSIS_MAX_LENGTH} characters or fewer.`;
  }
  return errors;
}

// Size of a section as PostgreSQL measures it: octet_length(jsonb::text). jsonb
// text adds a space after every ':' and ','; escaping otherwise matches JSON.
export function sectionByteSize(fields: SectionFields): number {
  const keys = Object.keys(fields).length;
  return new TextEncoder().encode(JSON.stringify(fields)).length + (keys > 0 ? 2 * keys - 1 : 0);
}

// The label of the first section over the limit, or null.
export function oversizedSection(sections: CaseInput['sections']): string | null {
  for (const section of SECTIONS) {
    if (sectionByteSize(sections[section.key]) > SECTION_MAX_BYTES) {
      return section.label;
    }
  }
  return null;
}

// Domain validation plus the database limits; throws what the editor shows.
export function assertSavable(input: CaseInput): void {
  const errors = { ...validateCase(input), ...databaseLimitErrors(input) };
  if (hasErrors(errors)) {
    throw new CaseValidationError(errors);
  }
  const section = oversizedSection(normalizeCaseInput(input).sections);
  if (section) {
    throw new CaseSaveError(`The ${section} section is too long to save. Shorten some of its notes and try again.`);
  }
}
