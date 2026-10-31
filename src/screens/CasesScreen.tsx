import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CaseListItem } from '../components/CaseListItem';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Loading, LoadError } from '../components/LoadStatus';
import { Screen } from '../components/Screen';
import { countCases, listCases, listProcedures } from '../db/caseRepository';
import { getDatabase } from '../db/client';
import type { CaseStatus } from '../domain/cases';
import { dateRangeFor, type DateFilter } from '../domain/dates';
import { useAsyncData } from '../hooks/useAsyncData';
import { colors, radius, spacing, touchTarget, typography } from '../theme';

type StatusFilter = 'all' | CaseStatus;

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

interface CasesScreenProps {
  onNewCase: () => void;
  onOpenCase: (id: string) => void;
}

export function CasesScreen({ onNewCase, onOpenCase }: CasesScreenProps) {
  const [query, setQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [procedureFilter, setProcedureFilter] = useState<string | null>(null);

  const procedures = useAsyncData(async () => listProcedures(await getDatabase()), []);

  const results = useAsyncData(async () => {
    const db = await getDatabase();
    const [cases, total] = await Promise.all([
      listCases(db, {
        search: query,
        status: statusFilter === 'all' ? undefined : statusFilter,
        procedure: procedureFilter ?? undefined,
        dateRange: dateRangeFor(dateFilter, new Date()),
      }),
      countCases(db),
    ]);
    return { cases, total };
  }, [query, dateFilter, statusFilter, procedureFilter]);

  const filtersActive = query.trim() !== '' || dateFilter !== 'all' || statusFilter !== 'all' || procedureFilter !== null;
  const hasAnyCases = results.state.status === 'ready' && results.state.data.total > 0;

  function clearFilters() {
    setQuery('');
    setDateFilter('all');
    setStatusFilter('all');
    setProcedureFilter(null);
  }

  return (
    <Screen title="My Cases" subtitle="Search and filter your logbook">
      {hasAnyCases ? <Button label="New Case" onPress={onNewCase} accessibilityHint="Opens the new case form" /> : null}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search procedure, diagnosis or reference"
        placeholderTextColor={colors.textTertiary}
        accessibilityLabel="Search cases"
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        style={styles.search}
      />

      <View style={styles.filters}>
        <FilterGroup label="Date">
          {DATE_FILTERS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={dateFilter === option.value}
              onPress={() => setDateFilter(option.value)}
            />
          ))}
        </FilterGroup>

        <FilterGroup label="Procedure">
          <Chip label="All procedures" selected={procedureFilter === null} onPress={() => setProcedureFilter(null)} />
          {procedures.state.status === 'ready' &&
            procedures.state.data.map((item) => (
              <Chip
                key={item.procedure.toLowerCase()}
                label={item.procedure}
                selected={procedureFilter?.toLowerCase() === item.procedure.toLowerCase()}
                onPress={() => setProcedureFilter(item.procedure)}
              />
            ))}
        </FilterGroup>
        {procedures.state.status === 'ready' && procedures.state.data.length === 0 ? (
          <Text style={[typography.caption, styles.procedureHint]}>
            Procedure filters will list your own procedures once cases are saved.
          </Text>
        ) : null}

        <FilterGroup label="Status">
          {STATUS_FILTERS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={statusFilter === option.value}
              onPress={() => setStatusFilter(option.value)}
            />
          ))}
        </FilterGroup>
      </View>

      {results.state.status === 'loading' && (
        <Card>
          <Loading label="Loading cases…" />
        </Card>
      )}

      {results.state.status === 'error' && (
        <Card>
          <LoadError error={results.state.error} onRetry={results.retry} />
        </Card>
      )}

      {results.state.status === 'ready' &&
        (results.state.data.total === 0 ? (
          <Card>
            <EmptyState
              title="No saved cases"
              message="Your logbook is empty. Create your first case to get started."
              actionLabel="Create First Case"
              onAction={onNewCase}
            />
          </Card>
        ) : results.state.data.cases.length === 0 ? (
          <Card>
            <EmptyState
              title="No matching cases"
              message="No saved cases match your search and filters."
              actionLabel={filtersActive ? 'Clear Search and Filters' : undefined}
              onAction={filtersActive ? clearFilters : undefined}
            />
          </Card>
        ) : (
          <View style={styles.results}>
            <Text style={typography.caption} accessibilityLiveRegion="polite">
              {resultSummary(results.state.data.cases.length, results.state.data.total)}
            </Text>
            <Card>
              {results.state.data.cases.map((item, index, all) => (
                <CaseListItem
                  key={item.id}
                  item={item}
                  onPress={() => onOpenCase(item.id)}
                  isLast={index === all.length - 1}
                />
              ))}
            </Card>
          </View>
        ))}
    </Screen>
  );
}

function resultSummary(shown: number, total: number): string {
  const noun = (count: number) => (count === 1 ? 'case' : 'cases');
  return shown === total ? `${total} ${noun(total)}` : `${shown} of ${total} ${noun(total)}`;
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={typography.label}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityLabel={`${label} filter`}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: touchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
    color: colors.text,
  },
  filters: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  procedureHint: {
    marginTop: -spacing.sm,
  },
  results: {
    gap: spacing.sm,
  },
});
