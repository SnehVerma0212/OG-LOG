import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';
import { EmptyState } from './EmptyState';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.loading} accessible accessibilityLabel={label}>
      <ActivityIndicator color={colors.accent} />
      <Text style={typography.caption}>{label}</Text>
    </View>
  );
}

interface LoadErrorProps {
  title?: string;
  error: Error;
  onRetry: () => void;
}

export function LoadError({ title = 'Could not load your cases', error, onRetry }: LoadErrorProps) {
  return (
    <EmptyState
      title={title}
      message={`Something went wrong while reading the database on this device. ${error.message}`}
      actionLabel="Try Again"
      onAction={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
});
