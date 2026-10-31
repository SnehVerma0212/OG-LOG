import { randomUUID } from 'expo-crypto';

import { expoCipherDriver } from '../security/expoCipherDriver';
import { expoKeyStore, generateSecureDatabaseKey } from '../security/expoKeyStore';
import { openSecureDatabase, type OpenedSecureDatabase } from '../security/secureDatabase';
import type { Database } from './database';
import { migrate } from './schema';

// The logbook is an SQLCipher-encrypted database whose key lives in the
// platform's secure storage (see src/security). If encryption cannot be set
// up, opening fails; there is no unencrypted fallback.

let openPromise: Promise<OpenedSecureDatabase> | null = null;

// Opens the database once per app launch. A failed open is not cached, so the
// next call (e.g. a Retry button) tries again.
function openOnce(): Promise<OpenedSecureDatabase> {
  if (!openPromise) {
    openPromise = openSecureDatabase({
      driver: expoCipherDriver,
      keyStore: expoKeyStore,
      generateKey: generateSecureDatabaseKey,
      migrate,
    }).catch((error: unknown) => {
      openPromise = null;
      throw error;
    });
  }
  return openPromise;
}

export async function getDatabase(): Promise<Database> {
  return (await openOnce()).db;
}

export interface DatabaseSecurityStatus {
  cipherVersion: string;
  migratedFromLegacy: boolean;
}

export async function getDatabaseSecurityStatus(): Promise<DatabaseSecurityStatus> {
  const { cipherVersion, migratedFromLegacy } = await openOnce();
  return { cipherVersion, migratedFromLegacy };
}

export function generateCaseId(): string {
  return randomUUID();
}
