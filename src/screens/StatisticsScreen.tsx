import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { StatCard } from '../components/StatCard';
import { getCaseStats, savedCases, SURGICAL_ROLES } from '../data/cases';
import { colors, radius, spacing, typography } from '../theme';

export function StatisticsScreen() {
  const stats = getCaseStats(savedCases);

  return (
    <Screen title="Statistics" subtitle="Your logbook at a glance">
      <View style={styles.grid}>
        <View style={styles.row}>
          <StatCard label="Total Cases" value={stats.total} />
          <StatCard label="This Month" value={stats.thisMonth} />
        </View>
        <View style={styles.row}>
          <StatCard label="This Year" value={stats.thisYear} />
          <StatCard label="Drafts" value={stats.drafts} />
        </View>
      </View>

      <Card title="Cases by Surgical Role">
        {SURGICAL_ROLES.map((role) => {
          const count = stats.byRole[role.value];
          const share = stats.total > 0 ? count / stats.total : 0;
          return (
            <View key={role.value} style={styles.roleRow} accessible accessibilityLabel={`${role.label}: ${count}`}>
              <View style={styles.roleHeader}>
                <Text style={typography.body}>{role.label}</Text>
                <Text style={[typography.label, styles.count]}>{count}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${share * 100}%` }]} />
              </View>
            </View>
          );
        })}
      </Card>

      <Card title="Procedures">
        <EmptyState
          title="No data yet"
          message="A breakdown of your most frequent procedures will appear once you have logged cases."
        />
      </Card>

      <Card title="Monthly Activity">
        <EmptyState
          title="No data yet"
          message="A month-by-month chart of your cases will appear here once cases are saved."
        />
      </Card>
    </Screen>
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
  roleRow: {
    gap: spacing.xs,
  },
  roleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
