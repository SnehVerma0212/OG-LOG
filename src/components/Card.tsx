import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

interface CardProps {
  title?: string;
  trailing?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ title, trailing, children, style }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={styles.header}>
          <Text style={[typography.headline, styles.title]} accessibilityRole="header">
            {title}
          </Text>
          {trailing}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    flexShrink: 1,
  },
});
