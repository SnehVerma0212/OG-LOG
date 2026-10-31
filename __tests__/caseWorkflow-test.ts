import {
  CaseValidationError,
  createCase,
  deleteCase,
  getCase,
  getCaseStats,
  listCases,
  updateCase,
} from '../src/db/caseRepository';
import { emptyFormValues, formValuesFromRecord, isFormDirty, toCaseInput } from '../src/domain/caseForm';
import { openTestDatabase, testClock, testIds } from '../test-utils/nodeDatabase';

// Follows the same steps the case editor performs, using its form helpers.
it('creates, edits section by section, completes, finds and deletes a case', async () => {
  const db = await openTestDatabase();
  const generateId = testIds();
  const now = testClock();
  const today = new Date(2026, 9, 22);

  // 1. New case: fill in details and the preoperative section, then Save Draft.
  let values = emptyFormValues(today);
  values = {
    ...values,
    reference: 'GS-100',
    procedure: 'Laparoscopic appendicectomy',
    sections: { ...values.sections, preop: { indication: 'Right iliac fossa pain' } },
  };
  const draft = await createCase(db, toCaseInput(values, 'draft'), { generateId, now });
  expect(draft.status).toBe('draft');
  expect(draft.surgeryDate).toBe('2026-10-22');

  // 2. Reopen it from the list: the form shows exactly what was saved.
  const reopened = await getCase(db, draft.id);
  values = formValuesFromRecord(reopened!);
  const baseline = values;
  expect(values.sections.preop.indication).toBe('Right iliac fossa pain');

  // 3. Edit only the OT section. Switching sections keeps both sections' input.
  values = { ...values, sections: { ...values.sections, ot: { findings: 'Inflamed appendix' } } };
  expect(isFormDirty(values, baseline)).toBe(true);
  const edited = await updateCase(db, draft.id, toCaseInput(values, 'draft'), { now });
  expect(edited.sections.preop.fields).toEqual({ indication: 'Right iliac fossa pain' });
  expect(edited.sections.ot.fields).toEqual({ findings: 'Inflamed appendix' });
  expect(edited.status).toBe('draft');

  // 4. Mark completed: refused until diagnosis and role are filled in.
  await expect(updateCase(db, draft.id, toCaseInput(values, 'completed'), { now })).rejects.toBeInstanceOf(
    CaseValidationError,
  );
  values = { ...values, diagnosis: 'Acute appendicitis', role: 'primary' };
  const completed = await updateCase(db, draft.id, toCaseInput(values, 'completed'), { now });
  expect(completed.status).toBe('completed');

  // 5. Library and dashboard reflect it.
  expect((await listCases(db, { search: 'appendicitis', status: 'completed' })).map((item) => item.id)).toEqual([draft.id]);
  expect((await getCaseStats(db, today)).total).toBe(1);

  // 6. Delete after confirmation.
  expect(await deleteCase(db, draft.id)).toBe(true);
  expect(await listCases(db)).toEqual([]);
  expect((await getCaseStats(db, today)).total).toBe(0);
  db.close();
});
