import { Text } from 'react-native';

import appConfig from '../../app.json';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { SettingsRow } from '../components/SettingsRow';
import { typography } from '../theme';

const notAvailable = <Badge label="Not available yet" />;

export function SettingsScreen() {
  return (
    <Screen title="Settings">
      <Notice
        title="No data protection is active yet"
        message="This version does not save, lock, encrypt or back up any data. These features will be added in later milestones."
      />

      <Card title="Privacy & App Lock">
        <SettingsRow label="App lock (PIN)" description="Require a PIN to open OG-LOG." trailing={notAvailable} />
        <SettingsRow
          label="Biometric unlock"
          description="Use fingerprint or face recognition."
          trailing={notAvailable}
        />
        <SettingsRow
          label="Encrypted storage"
          description="Encrypt case records stored on this device."
          trailing={notAvailable}
          isLast
        />
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
