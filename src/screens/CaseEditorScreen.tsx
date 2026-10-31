import { useEffect, useState } from 'react';
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { KeyboardAwareScrollView } from '../components/KeyboardAwareScrollView';
import { Loading } from '../components/LoadStatus';
import { Notice } from '../components/Notice';
import { deleteCase, getCase } from '../db/caseRepository';
import { generateCaseId, getDatabase } from '../db/client';
import { saveCase } from '../db/saveCase';
import { useIsLocked } from '../security/AppLockGate';
import { emptyFormValues, formValuesFromRecord, isFormDirty, toCaseInput, type CaseFormValues } from '../domain/caseForm';
import {
  REFERENCE_MAX_LENGTH,
  SECTIONS,
  SURGICAL_ROLES,
  type CaseField,
  type CaseRecord,
  type CaseStatus,
  type CaseValidationErrors,
  type SectionKey,
} from '../domain/cases';
import { formatSavedAt, isValidISODate } from '../domain/dates';
import { colors, maxContentWidth, radius, spacing, touchTarget, typography } from '../theme';
import { createSingleFlight } from '../utils/singleFlight';

interface CaseEditorScreenProps {
  // null creates a new case; an id opens that saved case for editing.
  caseId: string | null;
  // Leaves without saving (Cancel, Close, back button) or after a delete.
  onClose: () => void;
  // Called only after the toolbar save has succeeded.
  onSaved: (message: string) => void;
}

type LoadStatus = 'loading' | 'ready' | 'notFound' | 'error';

export function CaseEditorScreen({ caseId, onClose, onSaved }: CaseEditorScreenProps) {
  const insets = useSafeAreaInsets();
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(caseId ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState('');
  const [savedId, setSavedId] = useState<string | null>(caseId);
  const [status, setStatus] = useState<CaseStatus>('draft');
  const [values, setValues] = useState<CaseFormValues>(() => emptyFormValues(new Date()));
  // The last saved (or initial) values, used to detect unsaved changes.
  const [baseline, setBaseline] = useState<CaseFormValues>(values);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<CaseValidationErrors>({});
  const [busy, setBusy] = useState(false);
  // Synchronous guard against repeated taps; `busy` only updates on the next render.
  const [writeGuard] = useState(createSingleFlight);
  const [activeSection, setActiveSection] = useState<SectionKey>('preop');
  const locked = useIsLocked();

  useEffect(() => {
    if (!caseId) {
      return;
    }
    let active = true;
    (async () => {
      try {
        const record = await getCase(await getDatabase(), caseId);
        if (!active) {
          return;
        }
        if (!record) {
          setLoadStatus('notFound');
          return;
        }
        const loaded = formValuesFromRecord(record);
        setValues(loaded);
        setBaseline(loaded);
        setStatus(record.status);
        setSavedAt(record.updatedAt);
        setLoadStatus('ready');
      } catch (error) {
        if (active) {
          setLoadError(error instanceof Error ? error.message : String(error));
          setLoadStatus('error');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [caseId]);

  const dirty = isFormDirty(values, baseline);
  const sectionIndex = SECTIONS.findIndex((section) => section.key === activeSection);
  const section = SECTIONS[sectionIndex];
  const liveDateError =
    values.surgeryDate.trim() && !isValidISODate(values.surgeryDate.trim())
      ? 'Use the format YYYY-MM-DD, e.g. 2026-10-22.'
      : undefined;

  function setField<K extends CaseField>(field: K, value: CaseFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _cleared, ...rest }) => rest);
  }

  function setSectionField(key: SectionKey, field: string, value: string) {
    setValues((current) => ({
      ...current,
      sections: { ...current.sections, [key]: { ...current.sections[key], [field]: value } },
    }));
  }

  // Saves with the given status. Returns the saved record, or null if the save
  // failed (the error has already been shown) or another write was in progress.
  async function save(nextStatus: CaseStatus): Promise<CaseRecord | null> {
    const outcome = await writeGuard.run(async () => {
      setBusy(true);
      try {
        return await saveCase(getDatabase, {
          caseId: savedId,
          input: toCaseInput(values, nextStatus),
          generateId: generateCaseId,
        });
      } finally {
        setBusy(false);
      }
    });
    if (!outcome) {
      return null;
    }
    if (outcome.ok) {
      setSavedId(outcome.record.id);
      setStatus(outcome.record.status);
      // Only the baseline moves: anything typed while saving stays on screen as unsaved.
      setBaseline(formValuesFromRecord(outcome.record));
      setSavedAt(outcome.record.updatedAt);
      setErrors({});
      return outcome.record;
    }
    switch (outcome.kind) {
      case 'validation':
        setErrors(outcome.errors);
        Alert.alert(
          nextStatus === 'completed' ? 'Cannot mark as completed yet' : 'Cannot save yet',
          Object.values(outcome.errors).join('\n'),
        );
        break;
      case 'duplicateReference':
        setErrors({ reference: 'Another case already uses this reference.' });
        Alert.alert('Reference already in use', 'Choose a different internal case reference, or leave it blank.');
        break;
      case 'notFound':
        Alert.alert('Case not found', 'This case no longer exists. It may have been deleted.');
        break;
      case 'error':
        Alert.alert('Could not save', `Nothing was changed. Please try again.\n\n${outcome.message}`);
        break;
    }
    return null;
  }

  // Toolbar Save Draft / Save: on success, return to My Cases.
  async function saveAndClose() {
    const record = await save(status);
    if (record) {
      onSaved(record.status === 'completed' ? 'Changes saved.' : 'Draft saved.');
    }
  }

  // Status changes keep the editor open, as before.
  async function saveWithStatus(nextStatus: CaseStatus, successMessage: string) {
    if (await save(nextStatus)) {
      Alert.alert(successMessage);
    }
  }

  function confirmDelete() {
    const id = savedId;
    if (!id || writeGuard.isRunning()) {
      return;
    }
    Alert.alert(
      'Delete this case?',
      'This permanently removes the case and all three of its sections from this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            writeGuard.run(async () => {
              setBusy(true);
              try {
                await deleteCase(await getDatabase(), id);
                onClose();
              } catch (error) {
                setBusy(false);
                Alert.alert('Could not delete', `The case was not deleted. Please try again.\n\n${messageOf(error)}`);
              }
            }),
        },
      ],
    );
  }

  function handleClose() {
    if (writeGuard.isRunning()) {
      return;
    }
    if (!dirty || loadStatus !== 'ready') {
      onClose();
      return;
    }
    Alert.alert(
      savedId ? 'Discard unsaved changes?' : 'Discard this case?',
      savedId
        ? 'Changes since your last save will be lost.'
        : 'This case has not been saved. Leaving will clear what you have entered.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  }

  // Android hardware back button behaves like Cancel / Close (not while locked).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (locked) {
        return false;
      }
      handleClose();
      return true;
    });
    return () => subscription.remove();
  });

  const saveLabel = status === 'completed' ? 'Save' : 'Save Draft';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.toolbar}>
        <Button label={dirty ? 'Cancel' : 'Close'} variant="plain" onPress={handleClose} disabled={busy} />
        <Text style={typography.headline} accessibilityRole="header">
          {savedId ? 'Edit Case' : 'New Case'}
        </Text>
        <Button
          label={saveLabel}
          variant="plain"
          onPress={() => void saveAndClose()}
          disabled={busy || loadStatus !== 'ready'}
        />
      </View>

      <KeyboardAwareScrollView
        bottomPadding={insets.bottom + spacing.xxxl}
        contentContainerStyle={[
          styles.content,
          { paddingLeft: insets.left + spacing.xl, paddingRight: insets.right + spacing.xl },
        ]}
      >
        <View style={styles.inner}>
          {loadStatus === 'loading' && <Loading label="Opening case…" />}
          {loadStatus === 'notFound' && (
            <EmptyState
              title="Case not found"
              message="This case no longer exists. It may have been deleted."
              actionLabel="Close"
              onAction={onClose}
            />
          )}
          {loadStatus === 'error' && (
            <EmptyState
              title="Could not open this case"
              message={`Something went wrong while reading the database on this device. ${loadError}`}
              actionLabel="Close"
              onAction={onClose}
            />
          )}

          {loadStatus === 'ready' && (
            <>
              <Notice
                title="Preview: not yet reviewed for real patient data"
                message="Cases are encrypted on this device, but there is no backup yet and this version has not had an independent security review. Do not enter patient names, phone numbers, hospital numbers or other identifying details."
              />

              <View style={styles.statusRow}>
                <Badge label={status === 'completed' ? 'Completed' : 'Draft'} tone={status === 'completed' ? 'accent' : 'notice'} />
                <Text style={typography.caption} accessibilityLiveRegion="polite">
                  {busy
                    ? 'Saving…'
                    : dirty
                      ? 'Unsaved changes'
                      : savedAt
                        ? `Saved ${formatSavedAt(savedAt)}`
                        : 'Not saved yet'}
                </Text>
              </View>

              <Card title="Case Details">
                <FormField
                  label="Case reference (optional)"
                  hint="Your own internal code, e.g. 2026-001. Must be unique. Not a patient or hospital ID."
                  error={errors.reference}
                  value={values.reference}
                  onChangeText={(text) => setField('reference', text)}
                  placeholder="e.g. 2026-001"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={REFERENCE_MAX_LENGTH}
                />
                <FormField
                  label="Surgery date"
                  hint="Format: YYYY-MM-DD"
                  error={errors.surgeryDate ?? liveDateError}
                  value={values.surgeryDate}
                  onChangeText={(text) => setField('surgeryDate', text)}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />
                <FormField
                  label="Procedure"
                  error={errors.procedure}
                  value={values.procedure}
                  onChangeText={(text) => setField('procedure', text)}
                  placeholder="e.g. Laparoscopic cholecystectomy"
                />
                <FormField
                  label="Diagnosis"
                  hint="Needed to mark the case completed."
                  error={errors.diagnosis}
                  value={values.diagnosis}
                  onChangeText={(text) => setField('diagnosis', text)}
                  placeholder="e.g. Symptomatic cholelithiasis"
                />
                <View style={styles.roleField}>
                  <Text style={typography.label}>Surgical role</Text>
                  <View style={styles.roles}>
                    {SURGICAL_ROLES.map((option) => (
                      <Chip
                        key={option.value}
                        label={option.label}
                        selected={values.role === option.value}
                        onPress={() => setField('role', values.role === option.value ? null : option.value)}
                      />
                    ))}
                  </View>
                  {errors.role ? (
                    <Text style={styles.error}>{errors.role}</Text>
                  ) : (
                    <Text style={typography.caption}>Needed to mark the case completed. Tap again to clear.</Text>
                  )}
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

              <Card title={section.label}>
                <Text style={typography.callout}>{section.description}</Text>
                {section.fields.map((field) => (
                  <FormField
                    key={`${section.key}.${field.key}`}
                    label={field.label}
                    value={values.sections[section.key][field.key] ?? ''}
                    onChangeText={(text) => setSectionField(section.key, field.key, text)}
                    placeholder={field.placeholder}
                    multiline={field.multiline}
                  />
                ))}
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

              <Card title="Case Status">
                {status === 'draft' ? (
                  <>
                    <Text style={typography.callout}>
                      Saving keeps this case as a draft. Mark it completed once the record is finished.
                    </Text>
                    <Button
                      label="Save and Mark as Completed"
                      onPress={() => void saveWithStatus('completed', 'Case marked as completed.')}
                      disabled={busy}
                    />
                  </>
                ) : (
                  <>
                    <Text style={typography.callout}>This case is marked completed. You can still edit it.</Text>
                    <Button
                      label="Save and Move Back to Draft"
                      variant="secondary"
                      onPress={() => void saveWithStatus('draft', 'Case moved back to draft.')}
                      disabled={busy}
                    />
                  </>
                )}
                {savedId ? (
                  <Button label="Delete Case" variant="danger" onPress={confirmDelete} disabled={busy} />
                ) : null}
              </Card>
            </>
          )}
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: -spacing.sm,
  },
  roleField: {
    gap: spacing.sm,
  },
  roles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
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
  stepButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
});
