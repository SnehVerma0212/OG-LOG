import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.mark} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={styles.markLine} />
        <View style={[styles.markLine, styles.markLineShort]} />
      </View>
      <Text style={[typography.headline, styles.center]}>{title}</Text>
      <Text style={[typography.callout, styles.center]}>{message}</Text>
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  // A simple "blank page" mark drawn with views, so no icon library is needed.
  mark: {
    width: 48,
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    gap: 6,
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  markLine: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  markLineShort: {
    width: '60%',
  },
  center: {
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
});
