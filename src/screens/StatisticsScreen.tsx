import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Loading, LoadError } from '../components/LoadStatus';
import { Screen } from '../components/Screen';
import { StatCard } from '../components/StatCard';
import { getCaseStats, type CaseStats } from '../db/caseRepository';
import { getDatabase } from '../db/client';
import { SURGICAL_ROLES } from '../domain/cases';
import { formatDisplayMonth } from '../domain/dates';
import { useAsyncData } from '../hooks/useAsyncData';
import { colors, radius, spacing, typography } from '../theme';

export function StatisticsScreen() {
  const { state, retry } = useAsyncData(async () => getCaseStats(await getDatabase()), []);
  const stats = state.status === 'ready' ? state.data : null;

  return (
    <Screen title="Statistics" subtitle="Counts from the cases saved on this device">
      <View style={styles.grid}>
        <View style={styles.row}>
          <StatCard label="Total Cases" value={stats?.total ?? null} />
          <StatCard label="This Month" value={stats?.thisMonth ?? null} />
        </View>
        <View style={styles.row}>
          <StatCard label="This Year" value={stats?.thisYear ?? null} />
          <StatCard label="Drafts" value={stats?.drafts ?? null} />
        </View>
      </View>

      {state.status === 'loading' && (
        <Card>
          <Loading label="Loading statistics…" />
        </Card>
      )}
      {state.status === 'error' && (
        <Card>
          <LoadError title="Could not load statistics" error={state.error} onRetry={retry} />
        </Card>
      )}
      {stats && <Breakdowns stats={stats} />}
    </Screen>
  );
}

function Breakdowns({ stats }: { stats: CaseStats }) {
  return (
    <>
      <Card title="Cases by Surgical Role">
        {SURGICAL_ROLES.map((role) => (
          <BarRow key={role.value} label={role.label} count={stats.byRole[role.value]} total={stats.total} />
        ))}
        {stats.total > 0 ? (
          <Text style={typography.caption}>Drafts without a role selected are not included here.</Text>
        ) : null}
      </Card>

      <Card title="Most Frequent Procedures">
        {stats.topProcedures.length === 0 ? (
          <EmptyState
            title="No data yet"
            message="A breakdown of your most frequent procedures will appear once you have saved cases."
          />
        ) : (
          stats.topProcedures.map((item) => (
            <BarRow key={item.procedure} label={item.procedure} count={item.count} total={stats.total} />
          ))
        )}
      </Card>

      <Card title="Last Six Months">
        {stats.total === 0 ? (
          <EmptyState
            title="No data yet"
            message="A month-by-month count of your cases, by surgery date, will appear here once cases are saved."
          />
        ) : (
          stats.monthly.map((item) => (
            <BarRow
              key={item.month}
              label={formatDisplayMonth(item.month)}
              count={item.count}
              total={Math.max(...stats.monthly.map((month) => month.count))}
            />
          ))
        )}
      </Card>
    </>
  );
}

function BarRow({ label, count, total }: { label: string; count: number; total: number }) {
  const share = total > 0 ? count / total : 0;
  return (
    <View style={styles.barRow} accessible accessibilityLabel={`${label}: ${count}`}>
      <View style={styles.barHeader}>
        <Text style={[typography.body, styles.barLabel]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[typography.label, styles.count]}>{count}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${share * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  barRow: {
    gap: spacing.xs,
  },
  barHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  barLabel: {
    flex: 1,
  },
  count: {
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
});
