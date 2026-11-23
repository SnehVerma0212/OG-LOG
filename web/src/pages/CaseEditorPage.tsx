import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router';

import { emptyFormValues, formValuesFromRecord, isFormDirty, toCaseInput, type CaseFormValues } from '@og-log/domain/caseForm';
import {
  hasErrors,
  REFERENCE_MAX_LENGTH,
  SECTIONS,
  SURGICAL_ROLES,
  validateCase,
  type CaseField,
  type CaseRecord,
  type CaseStatus,
  type CaseValidationErrors,
  type SectionKey,
  type SurgicalRole,
} from '@og-log/domain/cases';
import { createSingleFlight } from '@og-log/single-flight';

import { StatusBadge } from '../components/CaseList';
import { ChoiceChips, TextAreaField, TextField } from '../components/forms';
import { Button, ButtonLink, Card, EmptyState, Loading, PageHeader } from '../components/ui';
import {
  CaseNotFoundError,
  CaseSaveError,
  CaseValidationError,
  ConcurrentUpdateError,
  DuplicateReferenceError,
  SessionExpiredError,
} from '../data/caseRepository';
import { databaseLimitErrors } from '../data/caseLimits';
import { useRepository } from '../data/RepositoryContext';
import { generateId } from '../lib/ids';
import { useNotify } from '../lib/notifications';
import { SectionPhotos } from '../photos/SectionPhotos';
import { useCasePhotos } from '../photos/useCasePhotos';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type LoadState = 'loading' | 'ready' | 'notFound' | 'error';
type RoleChoice = SurgicalRole | 'none';

const ROLE_OPTIONS: { value: RoleChoice; label: string }[] = [
  ...SURGICAL_ROLES,
  { value: 'none', label: 'Not set' },
];

type SaveOutcome =
  | { kind: 'skipped' }
  | { kind: 'saved'; record: CaseRecord }
  | { kind: 'invalid'; errors: CaseValidationErrors }
  | { kind: 'failed'; message: string };

export function CaseEditorPage() {
  const { caseId } = useParams();
  const isNew = !caseId;
  useDocumentTitle(isNew ? 'New Case' : 'Edit Case');
  const repository = useRepository();
  const navigate = useNavigate();
  const notify = useNotify();

  const [loadState, setLoadState] = useState<LoadState>(isNew ? 'ready' : 'loading');
  const [status, setStatus] = useState<CaseStatus>('draft');
  const [values, setValues] = useState<CaseFormValues>(() => emptyFormValues(new Date()));
  const [baseline, setBaseline] = useState<CaseFormValues>(values);
  const [errors, setErrors] = useState<CaseValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveGuard] = useState(createSingleFlight);
  // A new case keeps one ID for every save attempt, so retrying after a lost
  // response cannot create a second copy.
  const [newCaseId] = useState(generateId);
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | undefined>(undefined);
  const [activeSection, setActiveSection] = useState<SectionKey>('preop');
  const leavingAfterSave = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  // Photos attach only to a case the database has saved and returned.
  const photos = useCasePhotos(caseId && loadState === 'ready' ? caseId : null);

  useEffect(() => {
    if (!caseId) {
      return;
    }
    let active = true;
    repository.getCase(caseId).then(
      (record) => {
        if (!active) {
          return;
        }
        if (!record) {
          setLoadState('notFound');
          return;
        }
        const loaded = formValuesFromRecord(record);
        setValues(loaded);
        setBaseline(loaded);
        setStatus(record.status);
        setLoadedUpdatedAt(record.updatedAt);
        setLoadState('ready');
      },
      () => active && setLoadState('error'),
    );
    return () => {
      active = false;
    };
  }, [repository, caseId]);

  const dirty = isFormDirty(values, baseline);

  // Unsaved changes: ask before leaving within the app, and before closing the tab.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leavingAfterSave.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      return;
    }
    const message = isNew ? 'Discard this case? It has not been saved.' : 'Discard your unsaved changes?';
    if (window.confirm(message)) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker, isNew]);
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function setField<K extends CaseField>(field: K, value: CaseFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _cleared, ...rest }) => rest);
  }

  function setSectionField(section: SectionKey, field: string, value: string) {
    setValues((current) => ({
      ...current,
      sections: { ...current.sections, [section]: { ...current.sections[section], [field]: value } },
    }));
  }

  async function save(nextStatus: CaseStatus, destination: 'list' | 'details' | 'editor', message: string) {
    if (leavingAfterSave.current) {
      return; // Already saved; navigation is under way.
    }
    const outcome = await saveGuard.run(async (): Promise<SaveOutcome> => {
      if (leavingAfterSave.current) {
        return { kind: 'skipped' };
      }
      const input = toCaseInput(values, nextStatus);
      const found = { ...validateCase(input), ...databaseLimitErrors(input) };
      if (hasErrors(found)) {
        return { kind: 'invalid', errors: found };
      }
      setBusy(true);
      try {
        const record = caseId
          ? await repository.updateCase(caseId, input, { expectedUpdatedAt: loadedUpdatedAt })
          : await repository.createCase(input, { id: newCaseId });
        // Set before the guard is released, so a click that lands between
        // saving and leaving the page cannot save a second copy.
        leavingAfterSave.current = true;
        return { kind: 'saved', record };
      } catch (error) {
        if (error instanceof CaseValidationError) {
          return { kind: 'invalid', errors: error.errors };
        }
        if (error instanceof DuplicateReferenceError) {
          return { kind: 'invalid', errors: { reference: 'Another case already uses this reference.' } };
        }
        if (
          error instanceof CaseNotFoundError ||
          error instanceof ConcurrentUpdateError ||
          error instanceof CaseSaveError ||
          error instanceof SessionExpiredError
        ) {
          return { kind: 'failed', message: error.message };
        }
        return { kind: 'failed', message: 'The case could not be saved. Nothing was changed. Please try again.' };
      } finally {
        setBusy(false);
      }
    });
    if (!outcome || outcome.kind === 'skipped') {
      return; // Another save was in progress, or the case was already saved.
    }
    if (outcome.kind === 'saved') {
      notify(message);
      const paths = { list: '/cases', details: `/cases/${outcome.record.id}`, editor: `/cases/${outcome.record.id}/edit` };
      // Replace the new-case page in history: Back should not reopen an empty form.
      navigate(paths[destination], { replace: destination === 'editor' });
      return;
    }
    if (outcome.kind === 'invalid') {
      setErrors(outcome.errors);
      setFormError(
        nextStatus === 'completed' && status === 'draft'
          ? 'The case cannot be marked as completed yet.'
          : 'The case cannot be saved yet.',
      );
    } else {
      setFormError(outcome.message);
    }
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (isNew) {
      // Stay in the editor, now for the saved draft, so photos can be added.
      void save(status, 'editor', 'Draft saved. You can now add photos.');
      return;
    }
    void save(status, 'list', status === 'completed' ? 'Changes saved.' : 'Draft saved.');
  }

  if (loadState === 'loading') {
    return <Loading label="Loading case…" />;
  }
  if (loadState === 'notFound' || loadState === 'error') {
    return (
      <Card>
        <EmptyState
          title={loadState === 'notFound' ? 'Case not found' : 'Something went wrong'}
          message={loadState === 'notFound' ? 'This case does not exist or has been deleted.' : 'The case could not be loaded.'}
          action={<ButtonLink to="/cases" variant="secondary">Back to My Cases</ButtonLink>}
        />
      </Card>
    );
  }

  const sectionIndex = SECTIONS.findIndex((section) => section.key === activeSection);
  const section = SECTIONS[sectionIndex]!;
  const errorMessages = Object.values(errors);

  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-busy={busy}>
      <PageHeader
        title={isNew ? 'New Case' : 'Edit Case'}
        subtitle={dirty ? 'Unsaved changes' : isNew ? 'Not saved yet' : 'No unsaved changes'}
        actions={
          <>
            <ButtonLink to={isNew ? '/cases' : `/cases/${caseId}`} variant="secondary">
              Cancel
            </ButtonLink>
            <Button type="submit" disabled={busy}>
              {status === 'completed' ? 'Save' : 'Save Draft'}
            </Button>
          </>
        }
      />

      {formError ? (
        <div className="error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
          <strong>{formError}</strong>
          {errorMessages.length > 0 ? (
            <ul>
              {errorMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Card title="Case Details" trailing={<StatusBadge status={status} />}>
        <TextField
          label="Case reference (optional)"
          hint="Your own internal code, e.g. 2026-001. Must be unique. Not a patient or hospital ID."
          error={errors.reference}
          value={values.reference}
          onChange={(event) => setField('reference', event.target.value)}
          maxLength={REFERENCE_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <TextField
          label="Surgery date"
          type="date"
          error={errors.surgeryDate}
          value={values.surgeryDate}
          onChange={(event) => setField('surgeryDate', event.target.value)}
        />
        <TextField
          label="Procedure"
          error={errors.procedure}
          value={values.procedure}
          onChange={(event) => setField('procedure', event.target.value)}
          placeholder="e.g. Laparoscopic cholecystectomy"
          autoComplete="off"
        />
        <TextField
          label="Diagnosis"
          hint="Needed to mark the case completed."
          error={errors.diagnosis}
          value={values.diagnosis}
          onChange={(event) => setField('diagnosis', event.target.value)}
          placeholder="e.g. Symptomatic cholelithiasis"
          autoComplete="off"
        />
        <ChoiceChips<RoleChoice>
          legend="Surgical role"
          name="surgical-role"
          options={ROLE_OPTIONS}
          value={values.role ?? 'none'}
          onChange={(choice) => setField('role', choice === 'none' ? null : choice)}
          hint="Needed to mark the case completed."
          error={errors.role}
        />
      </Card>

      <section className="card" aria-labelledby="section-heading">
        <nav aria-label="Case sections">
          <ol className="stepper">
            {SECTIONS.map((item, index) => (
              <li key={item.key}>
                <button
                  type="button"
                  className="stepper__button"
                  aria-current={item.key === activeSection ? 'step' : undefined}
                  onClick={() => setActiveSection(item.key)}
                >
                  <span className="stepper__number" aria-hidden="true">
                    {index + 1}
                  </span>
                  {item.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <h2 className="card__title" id="section-heading">
          {section.label} <span className="caption">(section {sectionIndex + 1} of {SECTIONS.length})</span>
        </h2>
        <p className="callout">{section.description}</p>
        {section.fields.map((field) => {
          const props = {
            label: field.label,
            value: values.sections[section.key][field.key] ?? '',
            placeholder: field.placeholder,
          };
          return field.multiline ? (
            <TextAreaField
              key={`${section.key}.${field.key}`}
              {...props}
              onChange={(event) => setSectionField(section.key, field.key, event.target.value)}
            />
          ) : (
            <TextField
              key={`${section.key}.${field.key}`}
              {...props}
              autoComplete="off"
              onChange={(event) => setSectionField(section.key, field.key, event.target.value)}
            />
          );
        })}
        {caseId ? (
          // All three stay mounted (inactive ones hidden), so photos chosen but
          // not yet uploaded survive moving between sections.
          SECTIONS.map((item) => (
            <div key={item.key} hidden={item.key !== section.key}>
              <SectionPhotos
                caseId={caseId}
                section={item.key}
                sectionLabel={item.label}
                state={photos.state}
                onAdded={photos.added}
                onRemoved={photos.removed}
                onReload={photos.reload}
              />
            </div>
          ))
        ) : (
          <p className="callout photos">
            Photos: save this case as a draft first. Saving gives it a permanent ID; you then stay here and can add
            Preoperative, OT Record and Postoperative photos.
          </p>
        )}
        <div className="grid-2">
          <Button
            variant="secondary"
            disabled={sectionIndex === 0}
            onClick={() => setActiveSection(SECTIONS[sectionIndex - 1]!.key)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={sectionIndex === SECTIONS.length - 1}
            onClick={() => setActiveSection(SECTIONS[sectionIndex + 1]!.key)}
          >
            Next
          </Button>
        </div>
      </section>

      <Card title="Case Status">
        {status === 'draft' ? (
          <>
            <p className="callout">Saving keeps this case as a draft. Mark it completed once the record is finished.</p>
            <Button disabled={busy} onClick={() => void save('completed', 'details', 'Case marked as completed.')}>
              Save and Mark as Completed
            </Button>
          </>
        ) : (
          <>
            <p className="callout">This case is marked completed. You can still edit it.</p>
            <Button variant="secondary" disabled={busy} onClick={() => void save('draft', 'details', 'Case moved back to draft.')}>
              Save and Move Back to Draft
            </Button>
          </>
        )}
      </Card>
    </form>
  );
}
