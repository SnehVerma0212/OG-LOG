import { useState } from 'react';

import type { CaseStatus } from '@og-log/domain/cases';
import { dateRangeFor, type DateFilter } from '@og-log/domain/dates';

import { CaseList } from '../components/CaseList';
import { ChoiceChips } from '../components/forms';
import { Button, ButtonLink, Card, EmptyState, Loading, LoadError, PageHeader } from '../components/ui';
import { useRepository } from '../data/RepositoryContext';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type StatusFilter = 'all' | CaseStatus;

const PAGE_SIZE = 25;

const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'Last 3 months' },
  { value: 'year', label: 'This year' },
];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'completed', label: 'Completed' },
];

const ALL_PROCEDURES = '__all__';

// Search and filter values stay in component state, not the URL, so clinical
// search terms never end up in browser history or server logs.
export function CasesPage() {
  useDocumentTitle('My Cases');
  const repository = useRepository();
  const [query, setQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [procedureFilter, setProcedureFilter] = useState<string>(ALL_PROCEDURES);
  const [pageCount, setPageCount] = useState(1);

  const procedures = useAsync(() => repository.listProcedures(), [repository]);
  const results = useAsync(async () => {
    const filters = {
      search: query,
      status: statusFilter === 'all' ? undefined : statusFilter,
      procedure: procedureFilter === ALL_PROCEDURES ? undefined : procedureFilter,
      dateRange: dateRangeFor(dateFilter, new Date()),
    };
    const [cases, matching, total] = await Promise.all([
      repository.listCases({ ...filters, limit: PAGE_SIZE * pageCount }),
      repository.countCases(filters),
      repository.countCases(),
    ]);
    return { cases, matching, total };
  }, [repository, query, dateFilter, statusFilter, procedureFilter, pageCount]);

  const filtersActive =
    query.trim() !== '' || dateFilter !== 'all' || statusFilter !== 'all' || procedureFilter !== ALL_PROCEDURES;

  function resetPaging<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPageCount(1);
    };
  }

  function clearFilters() {
    setQuery('');
    setDateFilter('all');
    setStatusFilter('all');
    setProcedureFilter(ALL_PROCEDURES);
    setPageCount(1);
  }

  const procedureOptions = [
    { value: ALL_PROCEDURES, label: 'All procedures' },
    ...(procedures.state.status === 'ready'
      ? procedures.state.data.map((item) => ({ value: item.procedure, label: item.procedure }))
      : []),
  ];

  return (
    <>
      <PageHeader
        title="My Cases"
        subtitle="Search and filter your logbook."
        actions={<ButtonLink to="/cases/new">New Case</ButtonLink>}
      />

      <Card>
        <div className="stack">
          <div className="field">
            <label className="field__label" htmlFor="case-search">
              Search
            </label>
            <input
              id="case-search"
              className="field__input"
              type="search"
              value={query}
              onChange={(event) => resetPaging(setQuery)(event.target.value)}
              placeholder="Procedure, diagnosis or reference"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <ChoiceChips legend="Date" name="date-filter" options={DATE_FILTERS} value={dateFilter} onChange={resetPaging(setDateFilter)} />
          <ChoiceChips
            legend="Procedure"
            name="procedure-filter"
            options={procedureOptions}
            value={procedureFilter}
            onChange={resetPaging(setProcedureFilter)}
          />
          <ChoiceChips legend="Status" name="status-filter" options={STATUS_FILTERS} value={statusFilter} onChange={resetPaging(setStatusFilter)} />
        </div>
      </Card>

      {results.state.status === 'loading' && <Loading label="Loading cases…" />}
      {results.state.status === 'error' && <LoadError onRetry={results.retry} />}
      {results.state.status === 'ready' && (
        <Card>
          {results.state.data.total === 0 ? (
            <EmptyState
              title="No saved cases"
              message="Your logbook is empty. Create your first case to get started."
              action={<ButtonLink to="/cases/new">Create First Case</ButtonLink>}
            />
          ) : results.state.data.matching === 0 ? (
            <EmptyState
              title="No matching cases"
              message="No cases match your search and filters."
              action={filtersActive ? <Button variant="secondary" onClick={clearFilters}>Clear Search and Filters</Button> : undefined}
            />
          ) : (
            <>
              <p className="caption" aria-live="polite">
                {summary(results.state.data.cases.length, results.state.data.matching, results.state.data.total)}
              </p>
              <CaseList cases={results.state.data.cases} />
              {results.state.data.cases.length < results.state.data.matching ? (
                <Button variant="secondary" onClick={() => setPageCount((count) => count + 1)}>
                  Show More
                </Button>
              ) : null}
            </>
          )}
        </Card>
      )}
    </>
  );
}

function summary(shown: number, matching: number, total: number): string {
  const noun = (count: number) => (count === 1 ? 'case' : 'cases');
  if (matching === total) {
    return shown === total ? `${total} ${noun(total)}` : `Showing ${shown} of ${total} ${noun(total)}`;
  }
  return `Showing ${shown} of ${matching} matching ${noun(matching)} (${total} in total)`;
}
