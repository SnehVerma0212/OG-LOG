import { SURGICAL_ROLES } from '@og-log/domain/cases';
import { formatDisplayMonth } from '@og-log/domain/dates';

import { BarRow, Card, EmptyState, Loading, LoadError, PageHeader, StatCard } from '../components/ui';
import { useRepository } from '../data/RepositoryContext';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function StatisticsPage() {
  useDocumentTitle('Statistics');
  const repository = useRepository();
  const { state, retry } = useAsync(() => repository.getStats(), [repository]);
  const stats = state.status === 'ready' ? state.data : null;

  return (
    <>
      <PageHeader title="Statistics" subtitle="Calculated from the cases in your logbook." />

      <div className="grid-2 grid-2--wide-4">
        <StatCard label="Total Cases" value={stats?.total ?? null} />
        <StatCard label="This Month" value={stats?.thisMonth ?? null} />
        <StatCard label="This Year" value={stats?.thisYear ?? null} />
        <StatCard label="Drafts" value={stats?.drafts ?? null} />
      </div>

      {state.status === 'loading' && <Loading label="Loading statistics…" />}
      {state.status === 'error' && <LoadError onRetry={retry} />}
      {stats && (
        <>
          <Card title="Cases by Surgical Role">
            {SURGICAL_ROLES.map((role) => (
              <BarRow key={role.value} label={role.label} count={stats.byRole[role.value]} max={stats.total} />
            ))}
            {stats.total > 0 ? <p className="caption">Drafts without a role are not included.</p> : null}
          </Card>

          <Card title="Most Frequent Procedures">
            {stats.topProcedures.length === 0 ? (
              <EmptyState title="No data yet" message="Your most frequent procedures will appear once cases are saved." />
            ) : (
              stats.topProcedures.map((item) => (
                <BarRow key={item.procedure} label={item.procedure} count={item.count} max={stats.total} />
              ))
            )}
          </Card>

          <Card title="Last Six Months">
            {stats.total === 0 ? (
              <EmptyState title="No data yet" message="A month-by-month count by surgery date will appear here." />
            ) : (
              stats.monthly.map((item) => (
                <BarRow
                  key={item.month}
                  label={formatDisplayMonth(item.month)}
                  count={item.count}
                  max={Math.max(...stats.monthly.map((month) => month.count))}
                />
              ))
            )}
          </Card>
        </>
      )}
    </>
  );
}
