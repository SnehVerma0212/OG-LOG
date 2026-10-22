import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, touchTarget } from '../theme';
import { TabIcon, type TabIconName } from './TabIcon';

export interface TabItem<Key extends string> {
  key: Key;
  label: string;
  icon: TabIconName;
}

interface TabBarProps<Key extends string> {
  tabs: TabItem<Key>[];
  activeTab: Key;
  onChange: (key: Key) => void;
}

export function TabBar<Key extends string>({ tabs, activeTab, onChange }: TabBarProps<Key>) {
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, spacing.sm),
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        const color = active ? colors.accent : colors.textTertiary;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <View style={[styles.indicator, active && styles.indicatorActive]} />
            <TabIcon name={tab.icon} color={color} />
            <Text
              style={[styles.label, active && styles.labelActive]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    minHeight: touchTarget + spacing.md,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  // Sits on the top edge of the bar above the active tab.
  indicator: {
    width: 32,
    height: 3,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    backgroundColor: 'transparent',
    marginBottom: spacing.xs,
  },
  indicatorActive: {
    backgroundColor: colors.accent,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textTertiary,
  },
  labelActive: {
    color: colors.accent,
    fontWeight: '700',
  },
});
