import { CaseList } from '../components/CaseList';
import { ButtonLink, Card, EmptyState, Loading, LoadError, PageHeader, StatCard } from '../components/ui';
import { useRepository } from '../data/RepositoryContext';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const repository = useRepository();
  const { state, retry } = useAsync(async () => {
    const [stats, recent] = await Promise.all([
      repository.getStats(),
      repository.listCases({ sort: 'recentlyUpdated', limit: 5 }),
    ]);
    return { stats, recent };
  }, [repository]);
  const stats = state.status === 'ready' ? state.data.stats : null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Your surgical activity at a glance."
        actions={<ButtonLink to="/cases/new">New Case</ButtonLink>}
      />

      <div className="grid-3">
        <StatCard label="Total Cases" value={stats?.total ?? null} />
        <StatCard label="This Month" value={stats?.thisMonth ?? null} />
        <StatCard label="Drafts" value={stats?.drafts ?? null} />
      </div>

      <Card
        title="Recent Cases"
        trailing={
          state.status === 'ready' && state.data.recent.length > 0 ? (
            <ButtonLink to="/cases" variant="plain">
              View All
            </ButtonLink>
          ) : null
        }
      >
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError onRetry={retry} />}
        {state.status === 'ready' &&
          (state.data.recent.length === 0 ? (
            <EmptyState
              title="No cases yet"
              message="Cases you record will appear here, most recently updated first."
              action={<ButtonLink to="/cases/new">Create First Case</ButtonLink>}
            />
          ) : (
            <CaseList cases={state.data.recent} />
          ))}
      </Card>
    </>
  );
}
