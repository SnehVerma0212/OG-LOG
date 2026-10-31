import { Pressable, StyleSheet, Text, View } from 'react-native';

import { roleLabel, type CaseSummary } from '../domain/cases';
import { formatDisplayDate } from '../domain/dates';
import { colors, spacing, touchTarget, typography } from '../theme';
import { Badge } from './Badge';

interface CaseListItemProps {
  item: CaseSummary;
  onPress: () => void;
  isLast?: boolean;
}

export function CaseListItem({ item, onPress, isLast }: CaseListItemProps) {
  const statusLabel = item.status === 'completed' ? 'Completed' : 'Draft';
  const date = formatDisplayDate(item.surgeryDate);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.procedure}, ${date}, ${statusLabel}`}
      accessibilityHint="Opens the case"
      style={({ pressed }) => [styles.row, !isLast && styles.divider, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <Text style={typography.headline} numberOfLines={1}>
          {item.procedure}
        </Text>
        <Text style={typography.caption} numberOfLines={1}>
          {date} · {roleLabel(item.role)}
          {item.reference ? ` · Ref ${item.reference}` : ''}
        </Text>
        {item.diagnosis ? (
          <Text style={typography.callout} numberOfLines={1}>
            {item.diagnosis}
          </Text>
        ) : null}
      </View>
      <Badge label={statusLabel} tone={item.status === 'completed' ? 'accent' : 'notice'} />
    </Pressable>
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
  pressed: {
    opacity: 0.6,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});
