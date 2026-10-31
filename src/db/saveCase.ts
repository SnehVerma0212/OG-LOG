import { hasErrors, validateCase, type CaseInput, type CaseRecord, type CaseValidationErrors } from '../domain/cases';
import {
  CaseNotFoundError,
  CaseValidationError,
  createCase,
  DuplicateReferenceError,
  updateCase,
  type RepositoryOptions,
} from './caseRepository';
import type { Database } from './database';

export type SaveOutcome =
  | { ok: true; record: CaseRecord }
  | { ok: false; kind: 'validation'; errors: CaseValidationErrors }
  | { ok: false; kind: 'duplicateReference' }
  | { ok: false; kind: 'notFound' }
  | { ok: false; kind: 'error'; message: string };

interface SaveCaseRequest extends RepositoryOptions {
  // null creates a new case; an id updates that case.
  caseId: string | null;
  input: CaseInput;
  generateId: () => string;
}

// Creates or updates a case and reports the result instead of throwing, so
// callers can only treat the save as successful when `ok` is true.
export async function saveCase(getDb: () => Promise<Database>, request: SaveCaseRequest): Promise<SaveOutcome> {
  const errors = validateCase(request.input);
  if (hasErrors(errors)) {
    return { ok: false, kind: 'validation', errors };
  }
  try {
    const db = await getDb();
    const record = request.caseId
      ? await updateCase(db, request.caseId, request.input, request)
      : await createCase(db, request.input, request);
    return { ok: true, record };
  } catch (error) {
    if (error instanceof CaseValidationError) {
      return { ok: false, kind: 'validation', errors: error.errors };
    }
    if (error instanceof DuplicateReferenceError) {
      return { ok: false, kind: 'duplicateReference' };
    }
    if (error instanceof CaseNotFoundError) {
      return { ok: false, kind: 'notFound' };
    }
    return { ok: false, kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
