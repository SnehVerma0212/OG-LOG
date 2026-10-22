import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, touchTarget, typography } from '../theme';

interface SettingsRowProps {
  label: string;
  description?: string;
  trailing?: ReactNode;
  isLast?: boolean;
}

// A read-only settings row. Rows become interactive once their feature exists.
export function SettingsRow({ label, description, trailing, isLast }: SettingsRowProps) {
  return (
    <View style={[styles.row, !isLast && styles.divider]}>
      <View style={styles.text}>
        <Text style={typography.body}>{label}</Text>
        {description ? <Text style={typography.caption}>{description}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});
