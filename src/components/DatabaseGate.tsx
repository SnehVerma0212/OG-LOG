import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getDatabase } from '../db/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { SecureDatabaseError, type SecureDatabaseErrorCode } from '../security/secureDatabase';
import { colors, maxContentWidth, spacing, typography } from '../theme';
import { Button } from './Button';
import { Loading } from './LoadStatus';
import { LogoMark } from './LogoMark';

const TITLES: Record<SecureDatabaseErrorCode, string> = {
  encryptionUnavailable: 'Encryption is not available',
  secureStorageUnavailable: 'Secure storage is unavailable',
  keyMissing: 'Encryption key missing',
  keyInvalid: 'Encryption key damaged',
  keyRejected: 'Logbook could not be unlocked',
  migrationFailed: 'Encryption upgrade did not finish',
  unverifiedDatabase: 'Logbook could not be verified',
  openFailed: 'Logbook could not be opened',
};

// Codes where retrying cannot help and the records may be unrecoverable.
const KEY_LOSS_CODES: SecureDatabaseErrorCode[] = ['keyMissing', 'keyInvalid', 'keyRejected', 'unverifiedDatabase'];

// Opens the encrypted database before any screen that reads it is shown.
export function DatabaseGate({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { state, retry } = useAsyncData(getDatabase, []);

  if (state.status === 'ready') {
    return <>{children}</>;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xxxl, paddingBottom: insets.bottom + spacing.xl }]}
    >
      <View style={styles.inner}>
        <LogoMark size={56} />
        {state.status === 'loading' ? (
          <Loading label="Opening your encrypted logbook…" />
        ) : (
          <DatabaseError error={state.error} onRetry={retry} />
        )}
      </View>
    </ScrollView>
  );
}

function DatabaseError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  // Only SecureDatabaseError messages are shown; they are fixed text that never
  // includes key material or record contents.
  const secure = error instanceof SecureDatabaseError ? error : null;
  const code = secure?.code ?? 'openFailed';

  return (
    <View style={styles.error}>
      <Text style={[typography.title, styles.center]} accessibilityRole="header">
        {TITLES[code]}
      </Text>
      <Text style={[typography.callout, styles.center]}>{secure?.message ?? new SecureDatabaseError('openFailed').message}</Text>
      {KEY_LOSS_CODES.includes(code) ? (
        <Text style={[typography.caption, styles.center]}>
          Encrypted records cannot be read without their original key, and there is no backup yet. OG-LOG will not
          erase or replace anything by itself. Clearing the app’s storage in the device settings would let you start
          again, but permanently deletes the encrypted logbook.
        </Text>
      ) : null}
      {secure?.stage ? <Text style={[typography.caption, styles.center]}>Step: {secure.stage}</Text> : null}
      <View style={styles.button}>
        <Button label="Try Again" onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  inner: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  error: {
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
  },
  center: {
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
});
