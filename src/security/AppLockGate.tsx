import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { AppState, BackHandler, Keyboard, StyleSheet, View, type AppStateStatus } from 'react-native';

import { LockScreen } from '../components/LockScreen';
import { PrivacyCover } from '../components/PrivacyCover';
import { initialLockState, isLocked, lockReducer, type LockPolicy } from './appLock';
import type { AppLockServices, AuthResult, LockCapability } from './expoAppLock';

interface AppLockControls {
  policy: LockPolicy;
  // Requires a successful device authentication before saving the change.
  updatePolicy(policy: LockPolicy): Promise<AuthResult>;
  getCapability(): Promise<LockCapability>;
}

const AppLockContext = createContext<AppLockControls | null>(null);
// Defaults to unlocked so screens also work outside the gate (e.g. in tests).
const LockedContext = createContext(false);

// Lets screens ignore input, such as the Android back button, while locked.
export function useIsLocked(): boolean {
  return useContext(LockedContext);
}

export function useAppLock(): AppLockControls {
  const controls = useContext(AppLockContext);
  if (!controls) {
    throw new Error('useAppLock must be used inside AppLockGate.');
  }
  return controls;
}

interface AppLockGateProps {
  services: AppLockServices;
  children: ReactNode;
  now?: () => number;
}

// Shows the lock screen when the policy requires it. The app underneath stays
// mounted (so an unsaved case survives a lock) but is fully covered and hidden
// from accessibility services. Nothing is mounted until the first unlock.
export function AppLockGate({ services, children, now = Date.now }: AppLockGateProps) {
  const [state, dispatch] = useReducer(lockReducer, initialLockState);
  const [appState, setAppState] = useState<AppStateStatus>(() => knownAppState(AppState.currentState));
  const [hasUnlocked, setHasUnlocked] = useState(false);
  const prompting = useRef(false);

  useEffect(() => {
    services.enablePrivacyProtection().catch(() => undefined);
    services.loadPolicy().then(
      (policy) => dispatch({ type: 'policyLoaded', policy }),
      () => dispatch({ type: 'policyLoadFailed' }),
    );
  }, [services]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setAppState(next);
      if (next === 'background') {
        dispatch({ type: 'background', at: now() });
      } else if (next === 'active') {
        dispatch({ type: 'foreground', at: now() });
      }
    });
    return () => subscription.remove();
  }, [now]);

  const unlock = useCallback(async () => {
    if (prompting.current) {
      return;
    }
    prompting.current = true;
    dispatch({ type: 'authStarted' });
    const result = await services.authenticate('Unlock OG-LOG');
    prompting.current = false;
    dispatch(result.ok ? { type: 'authSucceeded' } : { type: 'authFailed', message: result.message });
  }, [services]);

  const locked = isLocked(state.phase);
  const showLockScreen = state.phase === 'locked' || state.phase === 'authenticating';

  useEffect(() => {
    if (state.phase === 'unlocked') {
      setHasUnlocked(true);
    } else if (state.phase === 'locked') {
      Keyboard.dismiss();
    }
  }, [state.phase]);

  useEffect(() => {
    if (state.phase === 'locked' && state.autoPrompt && appState === 'active') {
      void unlock();
    }
  }, [state.phase, state.autoPrompt, appState, unlock]);

  // While locked, the Android back button must not reach the screens underneath.
  useEffect(() => {
    if (!locked) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [locked]);

  const updatePolicy = useCallback(
    async (policy: LockPolicy): Promise<AuthResult> => {
      dispatch({ type: 'settingsAuthStarted' });
      const result = await services.authenticate(
        policy.enabled ? 'Confirm to change the app lock' : 'Confirm to turn off the app lock',
      );
      dispatch({ type: 'settingsAuthFinished' });
      if (!result.ok) {
        return result;
      }
      try {
        await services.savePolicy(policy);
      } catch {
        return { ok: false, message: 'The setting could not be saved. Try again.' };
      }
      dispatch({ type: 'policyChanged', policy });
      return { ok: true };
    },
    [services],
  );

  const controls: AppLockControls = { policy: state.policy, updatePolicy, getCapability: services.getCapability };

  return (
    <AppLockContext.Provider value={controls}>
      <LockedContext.Provider value={locked}>
        <View style={styles.container}>
          {hasUnlocked ? (
            <View
              style={styles.container}
              accessibilityElementsHidden={locked}
              importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}
            >
              {children}
            </View>
          ) : null}
          {state.phase === 'checking' ? <PrivacyCover /> : null}
          {showLockScreen ? (
            <LockScreen
              busy={state.phase === 'authenticating'}
              message={state.message}
              onUnlock={() => void unlock()}
            />
          ) : null}
          {appState !== 'active' ? <PrivacyCover /> : null}
        </View>
      </LockedContext.Provider>
    </AppLockContext.Provider>
  );
}

// currentState can be unknown very early in startup; the app is in the foreground then.
function knownAppState(value: string | null | undefined): AppStateStatus {
  return value === 'background' || value === 'inactive' ? value : 'active';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
