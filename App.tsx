import { StatusBar } from 'expo-status-bar';
import { useEffect, useReducer } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfirmationBanner } from './src/components/ConfirmationBanner';
import { DatabaseGate } from './src/components/DatabaseGate';
import { TabBar, type TabItem } from './src/components/TabBar';
import { useKeyboardHeight } from './src/hooks/useKeyboardHeight';
import { initialNavigationState, navigationReducer, type TabKey } from './src/navigation';
import { CaseEditorScreen } from './src/screens/CaseEditorScreen';
import { CasesScreen } from './src/screens/CasesScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StatisticsScreen } from './src/screens/StatisticsScreen';
import { AppLockGate, useIsLocked } from './src/security/AppLockGate';
import { expoAppLockServices } from './src/security/expoAppLock';
import { colors } from './src/theme';

const TABS: TabItem<TabKey>[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'cases', label: 'My Cases', icon: 'cases' },
  { key: 'statistics', label: 'Statistics', icon: 'statistics' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

const NOTICE_DURATION_MS = 3000;

// The app lock comes first, then the encrypted database is opened; screens
// only render once both are ready.
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppLockGate services={expoAppLockServices}>
        <DatabaseGate>
          <MainApp />
        </DatabaseGate>
      </AppLockGate>
    </SafeAreaProvider>
  );
}

// Navigation is plain React state (see src/navigation.ts): one active tab,
// plus a full-screen case editor shown instead of the tabs while it is open.
// Tab screens unmount while the editor is open, so they reload saved data
// when it closes.
function MainApp() {
  const [navigation, dispatch] = useReducer(navigationReducer, initialNavigationState);
  const { activeTab, editor, notice } = navigation;
  // Hide the tab bar while typing so it doesn't ride up above the keyboard on Android.
  const isKeyboardOpen = useKeyboardHeight() > 0;
  const locked = useIsLocked();

  const openNewCase = () => dispatch({ type: 'openNewCase' });
  const openCase = (caseId: string) => dispatch({ type: 'openCase', caseId });
  const selectTab = (tab: TabKey) => dispatch({ type: 'selectTab', tab });

  // Android back button: from any tab other than Home, return to Home.
  // While the case editor is open, it handles the back button itself.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (locked || editor || activeTab === 'home') {
        return false;
      }
      dispatch({ type: 'selectTab', tab: 'home' });
      return true;
    });
    return () => subscription.remove();
  }, [activeTab, editor, locked]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => dispatch({ type: 'dismissNotice', id: notice.id }), NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <>
      {editor ? (
        <CaseEditorScreen
          key={editor.caseId ?? 'new'}
          caseId={editor.caseId}
          onClose={() => dispatch({ type: 'closeEditor' })}
          onSaved={(message) => dispatch({ type: 'caseSaved', message })}
        />
      ) : (
        <View style={styles.container}>
          <View style={styles.screen}>
            {activeTab === 'home' && (
              <HomeScreen onNewCase={openNewCase} onOpenCase={openCase} onViewAllCases={() => selectTab('cases')} />
            )}
            {activeTab === 'cases' && <CasesScreen onNewCase={openNewCase} onOpenCase={openCase} />}
            {activeTab === 'statistics' && <StatisticsScreen />}
            {activeTab === 'settings' && <SettingsScreen />}
          </View>
          {notice && !isKeyboardOpen ? <ConfirmationBanner message={notice.message} /> : null}
          {!isKeyboardOpen && <TabBar tabs={TABS} activeTab={activeTab} onChange={selectTab} />}
        </View>
      )}
    </>
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
