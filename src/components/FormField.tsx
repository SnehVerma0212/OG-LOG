import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing, touchTarget, typography } from '../theme';

interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string;
}

export function FormField({ label, hint, error, ...inputProps }: FormFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={typography.label}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={colors.textTertiary}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        style={[styles.input, focused && styles.focused, error ? styles.invalid : null]}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={typography.caption}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  input: {
    minHeight: touchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  focused: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  invalid: {
    borderColor: colors.danger,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
});
