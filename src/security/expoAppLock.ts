import {
  authenticateAsync,
  AuthenticationType,
  getEnrolledLevelAsync,
  SecurityLevel,
  supportedAuthenticationTypesAsync,
} from 'expo-local-authentication';
import { enableAppSwitcherProtectionAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { getItemAsync, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from 'expo-secure-store';
import { Platform } from 'react-native';

import { authErrorMessage, parseLockPolicy, serializeLockPolicy, type LockPolicy } from './appLock';

export type AuthResult = { ok: true } | { ok: false; message: string };

export interface LockCapability {
  // False when the device has no screen lock at all.
  available: boolean;
  description: string;
}

export interface AppLockServices {
  loadPolicy(): Promise<LockPolicy>;
  savePolicy(policy: LockPolicy): Promise<void>;
  authenticate(promptMessage: string): Promise<AuthResult>;
  getCapability(): Promise<LockCapability>;
  enablePrivacyProtection(): Promise<void>;
}

// Stored in secure storage too, so it cannot be edited like an ordinary file.
const POLICY_KEY = 'oglog.appLockPolicy.v1';
const STORE_OPTIONS = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const expoAppLockServices: AppLockServices = {
  async loadPolicy() {
    return parseLockPolicy(await getItemAsync(POLICY_KEY, STORE_OPTIONS));
  },

  async savePolicy(policy) {
    await setItemAsync(POLICY_KEY, serializeLockPolicy(policy), STORE_OPTIONS);
  },

  async authenticate(promptMessage) {
    try {
      // The operating system shows biometrics and, as the fallback, the device
      // PIN, pattern or password. OG-LOG never sees or stores either.
      const result = await authenticateAsync({ promptMessage, cancelLabel: 'Cancel', disableDeviceFallback: false });
      return result.success ? { ok: true } : { ok: false, message: authErrorMessage(result.error) };
    } catch {
      return { ok: false, message: authErrorMessage(undefined) };
    }
  },

  async getCapability() {
    const level = await getEnrolledLevelAsync();
    if (level === SecurityLevel.NONE) {
      return { available: false, description: 'No screen lock is set up on this device.' };
    }
    if (level === SecurityLevel.SECRET) {
      return { available: true, description: 'Your device PIN, pattern or password.' };
    }
    const types = await supportedAuthenticationTypesAsync();
    const biometric = types.includes(AuthenticationType.FACIAL_RECOGNITION)
      ? 'Face recognition'
      : types.includes(AuthenticationType.FINGERPRINT)
        ? 'Fingerprint'
        : 'Biometrics';
    return { available: true, description: `${biometric}, or your device PIN, pattern or password.` };
  },

  async enablePrivacyProtection() {
    if (Platform.OS === 'android') {
      // FLAG_SECURE: blank preview in Recents (also blocks screenshots).
      await preventScreenCaptureAsync('oglog-privacy');
    } else if (Platform.OS === 'ios') {
      await enableAppSwitcherProtectionAsync(1);
    }
  },
};
