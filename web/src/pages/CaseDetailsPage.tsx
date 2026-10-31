import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { roleLabel, SECTIONS } from '@og-log/domain/cases';
import { formatDisplayDate, formatSavedAt } from '@og-log/domain/dates';
import { createSingleFlight } from '@og-log/single-flight';

import { StatusBadge } from '../components/CaseList';
import { Button, ButtonLink, Card, EmptyState, Loading, LoadError, PageHeader } from '../components/ui';
import { useRepository } from '../data/RepositoryContext';
import { useNotify } from '../lib/notifications';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function CaseDetailsPage() {
  useDocumentTitle('Case Details');
  const { caseId = '' } = useParams();
  const repository = useRepository();
  const navigate = useNavigate();
  const notify = useNotify();
  const [deleteGuard] = useState(createSingleFlight);
  const [deleting, setDeleting] = useState(false);
  const { state, retry } = useAsync(() => repository.getCase(caseId), [repository, caseId]);

  async function confirmDelete() {
    if (
      !window.confirm(
        'Delete this case? This permanently removes the case and all three of its sections. This cannot be undone.',
      )
    ) {
      return;
    }
    await deleteGuard.run(async () => {
      setDeleting(true);
      try {
        await repository.deleteCase(caseId);
        notify('Case deleted.');
        navigate('/cases');
      } catch {
        setDeleting(false);
        window.alert('The case could not be deleted. Please try again.');
      }
    });
  }

  if (state.status === 'loading') {
    return <Loading label="Loading case…" />;
  }
  if (state.status === 'error') {
    return <LoadError onRetry={retry} />;
  }
  const record = state.data;
  if (!record) {
    return (
      <Card>
        <EmptyState
          title="Case not found"
          message="This case does not exist or has been deleted."
          action={<ButtonLink to="/cases" variant="secondary">Back to My Cases</ButtonLink>}
        />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={record.procedure}
        subtitle={`${formatDisplayDate(record.surgeryDate)} · ${roleLabel(record.role)}`}
        actions={
          <>
            <ButtonLink to={`/cases/${record.id}/edit`} variant="secondary">
              Edit
            </ButtonLink>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleting}>
              Delete
            </Button>
          </>
        }
      />

      <Card title="Case Details" trailing={<StatusBadge status={record.status} />}>
        <dl className="details">
          <Detail term="Case reference" value={record.reference} />
          <Detail term="Surgery date" value={formatDisplayDate(record.surgeryDate)} />
          <Detail term="Procedure" value={record.procedure} />
          <Detail term="Diagnosis" value={record.diagnosis} />
          <Detail term="Surgical role" value={record.role ? roleLabel(record.role) : null} />
          <Detail term="Last updated" value={formatSavedAt(record.updatedAt)} />
        </dl>
      </Card>

      {SECTIONS.map((section) => {
        const fields = record.sections[section.key].fields;
        const known = new Set(section.fields.map((field) => field.key));
        // Values saved under keys the current form does not know are still shown.
        const extra = Object.keys(fields).filter((key) => !known.has(key));
        return (
          <Card key={section.key} title={section.label}>
            <p className="callout">{section.description}</p>
            <dl className="details">
              {section.fields.map((field) => (
                <Detail key={field.key} term={field.label} value={fields[field.key]} />
              ))}
              {extra.map((key) => (
                <Detail key={key} term={key} value={fields[key]} />
              ))}
            </dl>
          </Card>
        );
      })}
    </>
  );
}

function Detail({ term, value }: { term: string; value: string | null | undefined }) {
  return (
    <div className="details__row">
      <dt>{term}</dt>
      <dd className={value ? undefined : 'muted'}>{value || 'Not recorded'}</dd>
    </div>
  );
}
