import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, maxContentWidth, spacing, typography } from '../theme';
import { Button } from './Button';
import { LogoMark } from './LogoMark';

interface LockScreenProps {
  busy: boolean;
  message: string | null;
  onUnlock: () => void;
}

export function LockScreen({ busy, message, onUnlock }: LockScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityViewIsModal
    >
      <View style={styles.content}>
        <LogoMark size={64} />
        <Text style={typography.title} accessibilityRole="header">
          OG-LOG is locked
        </Text>
        <Text style={[typography.callout, styles.center]}>
          Unlock with your fingerprint or face, or your device PIN, pattern or password.
        </Text>
        {message ? (
          <Text style={[styles.message, styles.center]} accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
        <View style={styles.button}>
          <Button label={busy ? 'Waiting for unlock…' : 'Unlock'} onPress={onUnlock} disabled={busy} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  center: {
    textAlign: 'center',
  },
  message: {
    ...typography.label,
    color: colors.danger,
  },
  button: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
  },
});
