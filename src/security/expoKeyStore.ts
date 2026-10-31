import { getRandomBytesAsync } from 'expo-crypto';
import { getItemAsync, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from 'expo-secure-store';

import { generateDatabaseKey, type KeyStore } from './databaseKey';

// iOS: Keychain. Android: SharedPreferences encrypted with an Android Keystore
// key (Auto Backup is disabled in app.json). THIS_DEVICE_ONLY keeps the key out
// of iCloud Keychain and device-to-device transfers.
//
// requireAuthentication is deliberately not used: biometric enrollment changes
// would make the key, and so every record, permanently unreadable.
const KEY_NAME = 'oglog.databaseKey.v1';
const OPTIONS = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const expoKeyStore: KeyStore = {
  read: () => getItemAsync(KEY_NAME, OPTIONS),
  write: (key) => setItemAsync(KEY_NAME, key, OPTIONS),
};

// getRandomBytesAsync uses the platform's secure random generator. (The
// synchronous getRandomBytes may fall back to Math.random in development.)
export function generateSecureDatabaseKey(): Promise<string> {
  return generateDatabaseKey(getRandomBytesAsync);
}
