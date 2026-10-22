import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

interface NoticeProps {
  title: string;
  message: string;
}

// Highlighted message used to state plainly what the app does not do yet.
export function Notice({ title, message }: NoticeProps) {
  return (
    <View style={styles.notice} accessible accessibilityLabel={`${title}. ${message}`}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colors.noticeSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  title: {
    ...typography.label,
    color: colors.notice,
  },
  message: {
    ...typography.caption,
    color: colors.notice,
  },
});
