import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing } from '../theme';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

// A selectable pill used for filters and single-choice options.
export function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  selectedLabel: {
    color: colors.accentPressed,
    fontWeight: '600',
  },
});
