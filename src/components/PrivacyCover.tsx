import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';
import { LogoMark } from './LogoMark';

// Opaque cover with no case content, shown whenever the app is not in the
// foreground (so app-switcher snapshots show only this) and while starting up.
export function PrivacyCover() {
  return (
    <View style={[StyleSheet.absoluteFill, styles.cover]} accessibilityLabel="OG-LOG">
      <LogoMark size={64} />
      <Text style={styles.name}>OG-LOG</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  name: {
    ...typography.title,
  },
});
