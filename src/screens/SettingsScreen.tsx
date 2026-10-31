import { useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, Text, View } from 'react-native';

import appConfig from '../../app.json';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { SettingsRow } from '../components/SettingsRow';
import { getDatabaseSecurityStatus } from '../db/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { LOCK_TIMEOUT_OPTIONS, type LockPolicy } from '../security/appLock';
import { useAppLock } from '../security/AppLockGate';
import { colors, spacing, typography } from '../theme';

const notAvailable = <Badge label="Not available yet" />;

const KEY_STORAGE = Platform.OS === 'ios' ? 'the iOS Keychain' : 'Android Keystore-protected storage';

export function SettingsScreen() {
  const { policy, updatePolicy, getCapability } = useAppLock();
  const security = useAsyncData(getDatabaseSecurityStatus, []);
  const capability = useAsyncData(getCapability, []);
  const [saving, setSaving] = useState(false);

  async function changePolicy(next: LockPolicy) {
    if (saving) {
      return;
    }
    if (next.enabled && !policy.enabled) {
      if (capability.state.status === 'ready' && !capability.state.data.available) {
        Alert.alert(
          'Set up a screen lock first',
          'App lock uses your device’s own screen lock. Add a PIN, pattern, password or biometrics in the device settings, then try again.',
        );
        return;
      }
    }
    setSaving(true);
    const result = await updatePolicy(next);
    setSaving(false);
    if (!result.ok) {
      Alert.alert('App lock not changed', result.message);
    }
  }

  const encryptionDescription =
    security.state.status === 'ready'
      ? `SQLCipher ${security.state.data.cipherVersion}, 256-bit AES. The key is stored in ${KEY_STORAGE} on this device.`
      : security.state.status === 'error'
        ? 'Status unavailable.'
        : 'Checking…';

  return (
    <Screen title="Settings">
      <Notice
        title="Encrypted, but there is no backup yet"
        message="Cases are encrypted on this device. Backup is not available yet, so a lost, reset or replaced phone, or uninstalling OG-LOG, permanently loses the records. This preview has not had an independent security review."
      />

      <Card title="Data Protection">
        <SettingsRow
          label="Database encryption"
          description={encryptionDescription}
          trailing={security.state.status === 'ready' ? <Badge label="On" tone="accent" /> : null}
        />
        <SettingsRow
          label="Screen privacy"
          description={
            Platform.OS === 'android'
              ? 'Content is hidden in the recent apps view. Screenshots of OG-LOG are blocked.'
              : 'Content is hidden in the app switcher.'
          }
          trailing={<Badge label="On" tone="accent" />}
          isLast
        />
      </Card>

      <Card title="App Lock">
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text style={typography.body}>Require unlock</Text>
            <Text style={typography.caption}>
              {capability.state.status === 'ready' ? capability.state.data.description : 'Checking this device…'}
            </Text>
          </View>
          <Switch
            value={policy.enabled}
            disabled={saving}
            onValueChange={(enabled) => void changePolicy({ ...policy, enabled })}
            trackColor={{ true: colors.accent, false: colors.border }}
            accessibilityLabel="Require unlock"
          />
        </View>
        {policy.enabled ? (
          <View style={styles.timeouts}>
            <Text style={typography.label}>Lock again after leaving the app</Text>
            <View style={styles.chips}>
              {LOCK_TIMEOUT_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={policy.timeoutSeconds === option.value}
                  onPress={() => {
                    if (option.value !== policy.timeoutSeconds) {
                      void changePolicy({ ...policy, timeoutSeconds: option.value });
                    }
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}
        <Text style={typography.caption}>
          When on, OG-LOG asks for unlock every time it starts. Changing these settings asks you to confirm with your
          device unlock. The lock hides the app; your records are encrypted whether or not it is on.
        </Text>
      </Card>

      <Card title="Encryption Key">
        <Text style={typography.callout}>
          The key that encrypts your logbook was created on this device and is kept only in its secure storage. OG-LOG
          never shows, exports or sends it anywhere.
        </Text>
        <Text style={typography.callout}>
          If the key is lost, the encrypted records cannot be recovered. This happens if OG-LOG is uninstalled or its
          storage is cleared, and the key does not move to a new phone.
        </Text>
      </Card>

      <Card title="Backup & Restore">
        <SettingsRow label="Create backup" description="Export your logbook to a file." trailing={notAvailable} />
        <SettingsRow
          label="Restore from backup"
          description="Import a previously exported logbook."
          trailing={notAvailable}
        />
        <SettingsRow label="Last backup" trailing={<Text style={typography.callout}>Never</Text>} isLast />
      </Card>

      <Card title="About OG-LOG">
        <Text style={typography.callout}>
          OG-LOG is a personal surgical logbook for recording your own cases across preoperative, OT
          and postoperative stages.
        </Text>
        <SettingsRow label="Version" trailing={<Text style={typography.callout}>{appConfig.expo.version}</Text>} />
        <SettingsRow
          label="Build"
          trailing={<Badge label="Development preview" tone="neutral" />}
          isLast
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  timeouts: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
