import { StyleSheet, Text, View } from 'react-native';

import { BrandHeader } from '../components/BrandHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CaseListItem } from '../components/CaseListItem';
import { EmptyState } from '../components/EmptyState';
import { Loading, LoadError } from '../components/LoadStatus';
import { Screen } from '../components/Screen';
import { StatCard } from '../components/StatCard';
import { getCaseStats, listCases } from '../db/caseRepository';
import { getDatabase } from '../db/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { spacing, typography } from '../theme';

interface HomeScreenProps {
  onNewCase: () => void;
  onOpenCase: (id: string) => void;
  onViewAllCases: () => void;
}

export function HomeScreen({ onNewCase, onOpenCase, onViewAllCases }: HomeScreenProps) {
  const { state, retry } = useAsyncData(async () => {
    const db = await getDatabase();
    const [stats, recent] = await Promise.all([
      getCaseStats(db),
      listCases(db, { sort: 'recentlyUpdated', limit: 5 }),
    ]);
    return { stats, recent };
  }, []);

  const stats = state.status === 'ready' ? state.data.stats : null;

  return (
    <Screen header={<BrandHeader />}>
      <Card>
        <Text style={typography.title}>Welcome</Text>
        <Text style={typography.callout}>
          Keep a structured personal record of your surgical cases, from preoperative assessment
          through the OT record to postoperative follow-up.
        </Text>
      </Card>

      <View style={styles.stats}>
        <StatCard label="Total Cases" value={stats?.total ?? null} />
        <StatCard label="This Month" value={stats?.thisMonth ?? null} />
        <StatCard label="Drafts" value={stats?.drafts ?? null} />
      </View>

      <Button label="New Case" onPress={onNewCase} accessibilityHint="Opens the new case form" />

      <Card
        title="Recent Cases"
        trailing={
          state.status === 'ready' && state.data.recent.length > 0 ? (
            <Button label="View All" variant="plain" onPress={onViewAllCases} />
          ) : null
        }
      >
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError error={state.error} onRetry={retry} />}
        {state.status === 'ready' &&
          (state.data.recent.length === 0 ? (
            <EmptyState
              title="No cases yet"
              message="You haven't added any cases. Cases you record will appear here, most recently updated first."
            />
          ) : (
            <View>
              {state.data.recent.map((item, index) => (
                <CaseListItem
                  key={item.id}
                  item={item}
                  onPress={() => onOpenCase(item.id)}
                  isLast={index === state.data.recent.length - 1}
                />
              ))}
            </View>
          ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: 'row',
    gap: spacing.md,
  },
});
