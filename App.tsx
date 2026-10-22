import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TabBar, type TabItem } from './src/components/TabBar';
import { useKeyboardHeight } from './src/hooks/useKeyboardHeight';
import { CasesScreen } from './src/screens/CasesScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { NewCaseScreen } from './src/screens/NewCaseScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StatisticsScreen } from './src/screens/StatisticsScreen';
import { colors } from './src/theme';

type TabKey = 'home' | 'cases' | 'statistics' | 'settings';

const TABS: TabItem<TabKey>[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'cases', label: 'My Cases', icon: 'cases' },
  { key: 'statistics', label: 'Statistics', icon: 'statistics' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

// Navigation is plain React state: one active tab, plus a full-screen
// New Case form shown on top of the tabs when it is open.
export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [isCreatingCase, setIsCreatingCase] = useState(false);
  // Hide the tab bar while typing so it doesn't ride up above the keyboard on Android.
  const isKeyboardOpen = useKeyboardHeight() > 0;

  const openNewCase = () => setIsCreatingCase(true);
  const closeNewCase = () => setIsCreatingCase(false);

  // Android back button: from any tab other than Home, return to Home.
  // While the New Case form is open, it handles the back button itself.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isCreatingCase || activeTab === 'home') {
        return false;
      }
      setActiveTab('home');
      return true;
    });
    return () => subscription.remove();
  }, [activeTab, isCreatingCase]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {isCreatingCase ? (
        <NewCaseScreen onClose={closeNewCase} />
      ) : (
        <View style={styles.container}>
          <View style={styles.screen}>
            {activeTab === 'home' && <HomeScreen onNewCase={openNewCase} />}
            {activeTab === 'cases' && <CasesScreen onNewCase={openNewCase} />}
            {activeTab === 'statistics' && <StatisticsScreen />}
            {activeTab === 'settings' && <SettingsScreen />}
          </View>
          {!isKeyboardOpen && <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />}
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
  },
});
