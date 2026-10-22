import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, touchTarget } from '../theme';

type ButtonVariant = 'primary' | 'secondary' | 'plain';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityHint?: string;
}

export function Button({ label, onPress, variant = 'primary', disabled, accessibilityHint }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && pressedStyles[variant],
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, labelStyles[variant]]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  plain: {
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.md,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});

const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: colors.accentPressed },
  secondary: { backgroundColor: colors.surfaceMuted },
  plain: { opacity: 0.6 },
});

const labelStyles = StyleSheet.create({
  primary: { color: colors.onAccent },
  secondary: { color: colors.text },
  plain: { color: colors.accent },
});
