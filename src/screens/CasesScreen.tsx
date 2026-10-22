import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { savedCases } from '../data/cases';
import { colors, radius, spacing, touchTarget, typography } from '../theme';

type DateFilter = 'all' | 'month' | 'quarter' | 'year';
type StatusFilter = 'all' | 'draft' | 'completed';

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
}

export function CasesScreen({ onNewCase }: CasesScreenProps) {
  // Filter state is UI-only for now; it will drive real queries once cases are saved.
  const [query, setQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  return (
    <Screen title="My Cases" subtitle="Search and filter your logbook">
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search procedure or diagnosis"
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
          <Chip label="All procedures" selected onPress={() => {}} />
        </FilterGroup>
        <Text style={[typography.caption, styles.procedureHint]}>
          Procedure filters will list your own procedures once cases are saved.
        </Text>

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

      {savedCases.length === 0 ? (
        <Card>
          <EmptyState
            title="No saved cases"
            message="Your logbook is empty. Create your first case to get started."
            actionLabel="Create First Case"
            onAction={onNewCase}
          />
        </Card>
      ) : null}
    </Screen>
  );
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
});
