import { Link } from 'react-router';

import { roleLabel, type CaseSummary } from '@og-log/domain/cases';
import { formatDisplayDate } from '@og-log/domain/dates';

import { Badge } from './ui';

export function StatusBadge({ status }: { status: CaseSummary['status'] }) {
  return status === 'completed' ? <Badge label="Completed" tone="accent" /> : <Badge label="Draft" tone="notice" />;
}

export function CaseList({ cases }: { cases: CaseSummary[] }) {
  return (
    <ul className="case-list">
      {cases.map((item) => (
        <li key={item.id} className="case-list__item">
          <Link className="case-list__link" to={`/cases/${item.id}`}>
            <span className="case-list__text">
              <span className="case-list__title">{item.procedure}</span>
              <span className="case-list__meta">
                {formatDisplayDate(item.surgeryDate)} · {roleLabel(item.role)}
                {item.reference ? ` · Ref ${item.reference}` : ''}
              </span>
              {item.diagnosis ? <span className="case-list__diagnosis">{item.diagnosis}</span> : null}
            </span>
            <StatusBadge status={item.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
