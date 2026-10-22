import { StyleSheet, Text, View } from 'react-native';

import { BrandHeader } from '../components/BrandHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { StatCard } from '../components/StatCard';
import { getCaseStats, savedCases } from '../data/cases';
import { spacing, typography } from '../theme';

interface HomeScreenProps {
  onNewCase: () => void;
}

export function HomeScreen({ onNewCase }: HomeScreenProps) {
  const stats = getCaseStats(savedCases);

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
        <StatCard label="Total Cases" value={stats.total} />
        <StatCard label="This Month" value={stats.thisMonth} />
        <StatCard label="Drafts" value={stats.drafts} />
      </View>

      <Button label="New Case" onPress={onNewCase} accessibilityHint="Opens the new case form" />

      <Card title="Recent Cases">
        <EmptyState
          title="No cases yet"
          message="You haven't added any cases. Cases you record will appear here, most recent first."
        />
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
