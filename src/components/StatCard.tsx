import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

interface StatCardProps {
  label: string;
  // null while loading.
  value: number | null;
}

export function StatCard({ label, value }: StatCardProps) {
  return (
    <View style={styles.card} accessible accessibilityLabel={`${label}: ${value ?? 'loading'}`}>
      <Text style={styles.value}>{value ?? '–'}</Text>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 88,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  value: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
