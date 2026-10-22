import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

type BadgeTone = 'notice' | 'accent' | 'neutral';

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

export function Badge({ label, tone = 'notice' }: BadgeProps) {
  return (
    <View style={[styles.badge, badgeTones[tone]]}>
      <Text style={[styles.label, labelTones[tone]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});

const badgeTones = StyleSheet.create({
  notice: { backgroundColor: colors.noticeSoft },
  accent: { backgroundColor: colors.accentSoft },
  neutral: { backgroundColor: colors.surfaceMuted },
});

const labelTones = StyleSheet.create({
  notice: { color: colors.notice },
  accent: { color: colors.accentPressed },
  neutral: { color: colors.textSecondary },
});
