import { emptyFormValues, isFormDirty, toCaseInput } from '../src/domain/caseForm';
import { normalizeCaseInput, REFERENCE_MAX_LENGTH, validateCase } from '../src/domain/cases';
import { caseInput } from '../test-utils/fixtures';

describe('validateCase', () => {
  it('accepts a minimal draft with a date and procedure', () => {
    expect(validateCase(caseInput({ diagnosis: '', role: null }))).toEqual({});
  });

  it('requires a valid date and procedure for drafts', () => {
    expect(validateCase(caseInput({ surgeryDate: '', procedure: '  ' }))).toEqual({
      surgeryDate: 'Enter the surgery date.',
      procedure: 'Enter the procedure name.',
    });
    expect(validateCase(caseInput({ surgeryDate: '2026-02-30' })).surgeryDate).toMatch(/YYYY-MM-DD/);
  });

  it('requires diagnosis and role only to complete a case', () => {
    const incomplete = caseInput({ diagnosis: '', role: null });
    expect(validateCase({ ...incomplete, status: 'draft' })).toEqual({});
    expect(Object.keys(validateCase({ ...incomplete, status: 'completed' })).sort()).toEqual(['diagnosis', 'role']);
  });

  it('limits reference length', () => {
    expect(validateCase(caseInput({ reference: 'x'.repeat(REFERENCE_MAX_LENGTH) }))).toEqual({});
    expect(validateCase(caseInput({ reference: 'x'.repeat(REFERENCE_MAX_LENGTH + 1) })).reference).toBeDefined();
  });
});

describe('normalizeCaseInput', () => {
  it('trims text, nulls a blank reference and drops empty section values', () => {
    const normalized = normalizeCaseInput(
      caseInput({
        reference: '   ',
        procedure: '  Appendicectomy ',
        sections: { preop: { indication: ' Pain ', asaGrade: '  ' }, ot: {}, postop: {} },
      }),
    );
    expect(normalized.reference).toBeNull();
    expect(normalized.procedure).toBe('Appendicectomy');
    expect(normalized.sections.preop).toEqual({ indication: 'Pain' });
  });

  it('keeps section keys the current form does not know about', () => {
    const normalized = normalizeCaseInput(caseInput({ sections: { preop: { legacyField: 'kept' }, ot: {}, postop: {} } }));
    expect(normalized.sections.preop).toEqual({ legacyField: 'kept' });
  });
});

describe('form dirty tracking', () => {
  const today = new Date(2026, 9, 22);

  it('treats a fresh form as clean', () => {
    expect(isFormDirty(emptyFormValues(today), emptyFormValues(today))).toBe(false);
  });

  it('detects edits in any section', () => {
    const baseline = emptyFormValues(today);
    const edited = { ...baseline, sections: { ...baseline.sections, postop: { course: 'Uneventful' } } };
    expect(isFormDirty(edited, baseline)).toBe(true);
  });

  it('ignores whitespace-only and cleared fields', () => {
    const baseline = emptyFormValues(today);
    const edited = { ...baseline, procedure: '   ', sections: { ...baseline.sections, ot: { findings: '' } } };
    expect(isFormDirty(edited, baseline)).toBe(false);
  });

  it('builds the case input with the requested status', () => {
    expect(toCaseInput(emptyFormValues(today), 'completed').status).toBe('completed');
  });
});
