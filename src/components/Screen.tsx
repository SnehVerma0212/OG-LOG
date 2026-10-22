import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, maxContentWidth, spacing, typography } from '../theme';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  // Replaces the default large title, e.g. for the branded Home header.
  header?: ReactNode;
  children: ReactNode;
}

// Scrollable page with a large title. The bottom inset is handled by the tab bar.
export function Screen({ title, subtitle, header, children }: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing.lg,
          paddingLeft: insets.left + spacing.xl,
          paddingRight: insets.right + spacing.xl,
        },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.inner}>
        {header ?? (
          <View style={styles.header}>
            <Text style={typography.largeTitle} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        )}
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xxxl,
  },
  inner: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    gap: spacing.xl,
  },
  header: {
    gap: spacing.xs,
  },
  subtitle: {
    ...typography.callout,
  },
});
