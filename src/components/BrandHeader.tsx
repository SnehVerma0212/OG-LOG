import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';
import { LogoMark } from './LogoMark';

export function BrandHeader() {
  return (
    <View style={styles.header} accessible accessibilityRole="header" accessibilityLabel="OG-LOG, Personal Surgical Logbook">
      <LogoMark size={48} />
      <View style={styles.text}>
        <Text style={styles.wordmark}>OG-LOG</Text>
        <Text style={typography.callout}>Personal Surgical Logbook</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  text: {
    flex: 1,
  },
  wordmark: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.text,
  },
});
