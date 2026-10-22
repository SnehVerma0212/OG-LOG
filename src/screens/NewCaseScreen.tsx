import { useEffect, useState } from 'react';
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { FormField } from '../components/FormField';
import { KeyboardAwareScrollView } from '../components/KeyboardAwareScrollView';
import { Notice } from '../components/Notice';
import { SURGICAL_ROLES, type SurgicalRole } from '../data/cases';
import { colors, maxContentWidth, radius, spacing, touchTarget, typography } from '../theme';

type SectionKey = 'preop' | 'ot' | 'postop';

const SECTIONS: { key: SectionKey; label: string; title: string; description: string; planned: string[] }[] = [
  {
    key: 'preop',
    label: 'Preoperative',
    title: 'Preoperative',
    description: 'Assessment and planning before surgery.',
    planned: ['Indication for surgery', 'Relevant investigations', 'ASA grade', 'Consent and planning notes'],
  },
  {
    key: 'ot',
    label: 'OT Record',
    title: 'OT Record',
    description: 'What happened in the operation theatre.',
    planned: ['Anaesthesia type', 'Approach and technique', 'Intraoperative findings', 'Duration and complications'],
  },
  {
    key: 'postop',
    label: 'Postoperative',
    title: 'Postoperative',
    description: 'Recovery, follow-up and outcome.',
    planned: ['Postoperative course', 'Complications', 'Length of stay', 'Follow-up and outcome'],
  },
];

interface NewCaseScreenProps {
  onClose: () => void;
}

export function NewCaseScreen({ onClose }: NewCaseScreenProps) {
  const insets = useSafeAreaInsets();
  const [reference, setReference] = useState('');
  const [surgeryDate, setSurgeryDate] = useState(formatDate(new Date()));
  const [procedure, setProcedure] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [role, setRole] = useState<SurgicalRole | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('preop');

  const hasEntries = Boolean(reference || procedure || diagnosis || role);
  const dateError = surgeryDate && !isValidDate(surgeryDate) ? 'Use the format YYYY-MM-DD, e.g. 2026-10-22.' : undefined;
  const sectionIndex = SECTIONS.findIndex((section) => section.key === activeSection);
  const section = SECTIONS[sectionIndex];

  function handleCancel() {
    if (!hasEntries) {
      onClose();
      return;
    }
    Alert.alert('Discard this case?', 'Nothing has been saved. Leaving will clear what you have entered.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  }

  function handleSaveDraft() {
    Alert.alert(
      'Saving is not available yet',
      'Drafts cannot be saved in this version. Saving will be added in a later milestone. Your entries stay on this screen until you leave it.',
    );
  }

  // Android hardware back button behaves like Cancel.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCancel();
      return true;
    });
    return () => subscription.remove();
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.toolbar}>
        <Button label="Cancel" variant="plain" onPress={handleCancel} />
        <Text style={typography.headline} accessibilityRole="header">
          New Case
        </Text>
        <Button label="Save Draft" variant="plain" onPress={handleSaveDraft} />
      </View>

      <KeyboardAwareScrollView
        bottomPadding={insets.bottom + spacing.xxxl}
        contentContainerStyle={[
          styles.content,
          { paddingLeft: insets.left + spacing.xl, paddingRight: insets.right + spacing.xl },
        ]}
      >
        <View style={styles.inner}>
          <Notice
            title="Preview only: this case will not be saved"
            message="Saving cases will be added in a later milestone. Do not enter patient names, phone numbers, hospital numbers or other identifying details."
          />

          <Card title="Case Details">
            <FormField
              label="Case reference"
              hint="Your own internal code, e.g. 2026-001. Not a patient or hospital ID."
              value={reference}
              onChangeText={setReference}
              placeholder="e.g. 2026-001"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <FormField
              label="Surgery date"
              hint="Format: YYYY-MM-DD"
              error={dateError}
              value={surgeryDate}
              onChangeText={setSurgeryDate}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            <FormField
              label="Procedure"
              value={procedure}
              onChangeText={setProcedure}
              placeholder="e.g. Laparoscopic cholecystectomy"
            />
            <FormField
              label="Diagnosis"
              value={diagnosis}
              onChangeText={setDiagnosis}
              placeholder="e.g. Symptomatic cholelithiasis"
            />
            <View style={styles.roleField}>
              <Text style={typography.label}>Surgical role</Text>
              <View style={styles.roles}>
                {SURGICAL_ROLES.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    selected={role === option.value}
                    onPress={() => setRole(option.value)}
                  />
                ))}
              </View>
            </View>
          </Card>

          <View style={styles.stepper}>
            <Text style={typography.caption}>
              Section {sectionIndex + 1} of {SECTIONS.length}
            </Text>
            <View style={styles.steps} accessibilityRole="tablist">
              {SECTIONS.map((item, index) => {
                const active = item.key === activeSection;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setActiveSection(item.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Section ${index + 1} of ${SECTIONS.length}: ${item.label}`}
                    style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
                  >
                    <View style={styles.stepTrack}>
                      <View style={[styles.connector, index === 0 && styles.connectorHidden]} />
                      <View style={[styles.stepCircle, active && styles.stepCircleActive]}>
                        <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>{index + 1}</Text>
                      </View>
                      <View style={[styles.connector, index === SECTIONS.length - 1 && styles.connectorHidden]} />
                    </View>
                    <Text
                      style={[styles.stepLabel, active && styles.stepLabelActive]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Card title={section.title} trailing={<Badge label="Coming later" />}>
            <Text style={typography.callout}>{section.description}</Text>
            <View style={styles.planned}>
              <Text style={typography.label}>Planned fields</Text>
              {section.planned.map((item) => (
                <View key={item} style={styles.plannedRow}>
                  <View style={styles.bullet} />
                  <Text style={[typography.callout, styles.flex]}>{item}</Text>
                </View>
              ))}
            </View>
            <View style={styles.stepButtons}>
              <View style={styles.flex}>
                <Button
                  label="Previous"
                  variant="secondary"
                  disabled={sectionIndex === 0}
                  onPress={() => setActiveSection(SECTIONS[sectionIndex - 1].key)}
                />
              </View>
              <View style={styles.flex}>
                <Button
                  label="Next"
                  variant="secondary"
                  disabled={sectionIndex === SECTIONS.length - 1}
                  onPress={() => setActiveSection(SECTIONS[sectionIndex + 1].key)}
                />
              </View>
            </View>
          </Card>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    minHeight: touchTarget + spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  content: {
    paddingTop: spacing.xl,
  },
  inner: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    gap: spacing.xl,
  },
  roleField: {
    gap: spacing.sm,
  },
  roles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stepper: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  steps: {
    flexDirection: 'row',
    alignSelf: 'stretch',
  },
  step: {
    flex: 1,
    minHeight: touchTarget + spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 2,
  },
  stepPressed: {
    opacity: 0.6,
  },
  stepTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  connector: {
    flex: 1,
    height: 2,
    backgroundColor: colors.border,
  },
  connectorHidden: {
    backgroundColor: 'transparent',
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  stepNumberActive: {
    color: colors.onAccent,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  stepLabelActive: {
    color: colors.text,
    fontWeight: '700',
  },
  planned: {
    gap: spacing.sm,
  },
  plannedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  stepButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
});
