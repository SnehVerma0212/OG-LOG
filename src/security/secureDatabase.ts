import type { Database, SqlExecutor } from '../db/database';
import { withSerialTransactions } from '../db/serialTransactions';
import { isValidDatabaseKey, type KeyStore } from './databaseKey';

// Opens the encrypted logbook, creating it or migrating the old unencrypted
// development database into it as needed. Every failure stops with a
// SecureDatabaseError: there is no fallback to unencrypted storage, and nothing
// is deleted unless a verified encrypted copy of it exists.

export const LEGACY_DATABASE_NAME = 'oglog.db'; // unencrypted, from Milestone 3
export const SECURE_DATABASE_NAME = 'oglog-secure.db';

// Written to the SQLite header (PRAGMA application_id) only after the encrypted
// database has been created or migrated and verified. "OGLG" in ASCII.
export const VERIFIED_MARKER = 0x4f474c47;

export interface SqlConnection extends SqlExecutor {
  close(): Promise<void>;
}

// Thrown by a driver when a key does not open an existing file.
export class KeyRejectedError extends Error {
  constructor() {
    super('The key did not open the database.');
    this.name = 'KeyRejectedError';
  }
}

// Thrown by a driver when the SQLite library has no encryption support.
export class EncryptionUnavailableError extends Error {
  constructor() {
    super('SQLCipher is not available.');
    this.name = 'EncryptionUnavailableError';
  }
}

// Platform-specific file and SQLCipher operations (expo-sqlite on devices).
export interface CipherDriver {
  // SQLCipher version, or null when the SQLite library is not SQLCipher.
  cipherVersion(): Promise<string | null>;
  // True when the file exists and is not empty.
  exists(name: string): Promise<boolean>;
  // Removes the file and its -wal, -shm and -journal companions, if present.
  remove(name: string): Promise<void>;
  openPlain(name: string): Promise<SqlConnection>;
  // Sets the key before any other statement and proves it by reading the
  // schema. Rejects with KeyRejectedError if the key does not open the file.
  openEncrypted(name: string, key: string): Promise<SqlConnection>;
  // Confirms an open connection is encrypted and its pages authenticate.
  verifyEncryption(connection: SqlConnection): Promise<void>;
  // Writes an encrypted copy of `source` to `targetName` (sqlcipher_export).
  exportEncrypted(source: SqlConnection, targetName: string, key: string, userVersion: number): Promise<void>;
}

export type SecureDatabaseErrorCode =
  | 'encryptionUnavailable'
  | 'secureStorageUnavailable'
  | 'keyMissing'
  | 'keyInvalid'
  | 'keyRejected'
  | 'migrationFailed'
  | 'unverifiedDatabase'
  | 'openFailed';

const ERROR_MESSAGES: Record<SecureDatabaseErrorCode, string> = {
  encryptionUnavailable:
    'This build of OG-LOG does not include database encryption, so the logbook was not opened. Use the OG-LOG development build; Expo Go cannot open it.',
  secureStorageUnavailable:
    'The device’s secure storage could not be used to read or save the encryption key. Unlock the device and try again.',
  keyMissing:
    'An encrypted logbook exists on this device, but its encryption key is missing. The records cannot be decrypted without it. Nothing has been changed or replaced.',
  keyInvalid:
    'The stored encryption key is damaged, so the logbook was not opened. Nothing has been changed or replaced.',
  keyRejected:
    'The encrypted logbook could not be unlocked with the stored key. Nothing has been changed or replaced.',
  migrationFailed:
    'The existing logbook could not be moved into encrypted storage. The original data has been kept unchanged. Try again.',
  unverifiedDatabase:
    'An encrypted logbook was found that was never confirmed as complete. It has been left untouched.',
  openFailed: 'The encrypted logbook could not be opened. Nothing has been changed. Try again.',
};

// User-facing message is fixed per code and never includes underlying error
// text, which could contain SQL with the key in it. `stage` names the step
// that failed, for troubleshooting, and contains no data.
export class SecureDatabaseError extends Error {
  constructor(
    readonly code: SecureDatabaseErrorCode,
    readonly stage?: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SecureDatabaseError';
  }
}

export interface SecureDatabaseDeps {
  driver: CipherDriver;
  keyStore: KeyStore;
  generateKey: () => Promise<string>;
  migrate: (db: Database) => Promise<void>;
}

export interface OpenedSecureDatabase {
  db: Database;
  close: () => Promise<void>;
  cipherVersion: string;
  // True when this launch moved records from the old unencrypted database.
  migratedFromLegacy: boolean;
}

export async function openSecureDatabase(deps: SecureDatabaseDeps): Promise<OpenedSecureDatabase> {
  const { driver } = deps;
  const cipherVersion = await guard('encryptionUnavailable', 'cipher-version', () => driver.cipherVersion());
  if (!cipherVersion) {
    throw new SecureDatabaseError('encryptionUnavailable', 'cipher-version');
  }

  const storedKey = await readStoredKey(deps.keyStore);
  const hasSecure = await guard('openFailed', 'check-files', () => driver.exists(SECURE_DATABASE_NAME));
  const hasLegacy = await guard('openFailed', 'check-files', () => driver.exists(LEGACY_DATABASE_NAME));

  if (hasSecure) {
    if (!storedKey) {
      throw new SecureDatabaseError('keyMissing');
    }
    const connection = await openWithKey(driver, storedKey);
    let verified: boolean;
    let empty: boolean;
    try {
      verified = await isVerified(connection);
      empty = !verified && (await hasNoCases(connection));
    } catch {
      await closeQuietly(connection);
      throw new SecureDatabaseError('openFailed', 'read-marker');
    }

    if (verified) {
      if (hasLegacy) {
        // A previous migration verified its copy but stopped before removing
        // the original. The encrypted copy is authoritative.
        await driver.remove(LEGACY_DATABASE_NAME).catch(() => undefined);
      }
      return finish(deps, connection, cipherVersion, false);
    }

    await closeQuietly(connection);
    if (hasLegacy) {
      // An interrupted migration: the unencrypted original is still the source of truth.
      await guard('migrationFailed', 'discard-partial-copy', () => driver.remove(SECURE_DATABASE_NAME));
      return migrateLegacy(deps, storedKey, cipherVersion);
    }
    if (!empty) {
      throw new SecureDatabaseError('unverifiedDatabase');
    }
    // An interrupted first-time setup that never held any cases.
    await guard('openFailed', 'discard-empty-setup', () => driver.remove(SECURE_DATABASE_NAME));
    return createFresh(deps, storedKey, cipherVersion);
  }

  if (hasLegacy) {
    return migrateLegacy(deps, storedKey ?? (await createAndStoreKey(deps)), cipherVersion);
  }
  return createFresh(deps, storedKey ?? (await createAndStoreKey(deps)), cipherVersion);
}

async function createFresh(deps: SecureDatabaseDeps, key: string, cipherVersion: string) {
  const connection = await openWithKey(deps.driver, key);
  try {
    await deps.driver.verifyEncryption(connection);
    await deps.migrate(withSerialTransactions(connection));
    await connection.execAsync(`PRAGMA application_id = ${VERIFIED_MARKER}`);
  } catch {
    await closeQuietly(connection);
    throw new SecureDatabaseError('openFailed', 'create');
  }
  return finish(deps, connection, cipherVersion, false);
}

async function migrateLegacy(deps: SecureDatabaseDeps, key: string, cipherVersion: string) {
  const { driver } = deps;
  let source: SqlConnection | null = null;
  let copy: SqlConnection | null = null;
  let stage = 'open-original';
  try {
    source = await driver.openPlain(LEGACY_DATABASE_NAME);
    stage = 'read-original';
    await source.getFirstAsync('SELECT count(*) AS count FROM sqlite_master', []);
    // Fold any write-ahead log into the main file so the export sees every record.
    await source.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
    stage = 'update-original-schema';
    await deps.migrate(withSerialTransactions(source));
    const userVersion = await readUserVersion(source);
    const expected = await snapshot(source);

    stage = 'export';
    await driver.exportEncrypted(source, SECURE_DATABASE_NAME, key, userVersion);

    stage = 'verify-copy';
    copy = await driver.openEncrypted(SECURE_DATABASE_NAME, key);
    await verifyCopy(driver, copy, expected, userVersion);
    await copy.execAsync(`PRAGMA application_id = ${VERIFIED_MARKER}`);
    await copy.close();
    copy = null;

    stage = 'reopen-copy';
    copy = await driver.openEncrypted(SECURE_DATABASE_NAME, key);
    if (!(await isVerified(copy))) {
      throw new Error('The verification marker was not saved.');
    }
    await verifyCopy(driver, copy, expected, userVersion);

    await source.close();
    source = null;
  } catch {
    if (copy) {
      await closeQuietly(copy);
    }
    if (source) {
      await closeQuietly(source);
    }
    // Only the unfinished copy is removed. The original is never touched here.
    await driver.remove(SECURE_DATABASE_NAME).catch(() => undefined);
    throw new SecureDatabaseError('migrationFailed', stage);
  }

  // The encrypted copy is verified and marked, so the original can go. If this
  // fails, the next launch removes it (see the `verified` branch above).
  await driver.remove(LEGACY_DATABASE_NAME).catch(() => undefined);
  return finish(deps, copy, cipherVersion, true);
}

async function finish(
  deps: SecureDatabaseDeps,
  connection: SqlConnection,
  cipherVersion: string,
  migratedFromLegacy: boolean,
): Promise<OpenedSecureDatabase> {
  const db = withSerialTransactions(connection);
  try {
    await connection.execAsync('PRAGMA journal_mode = WAL');
    await connection.execAsync('PRAGMA foreign_keys = ON');
    await deps.migrate(db);
  } catch {
    await closeQuietly(connection);
    throw new SecureDatabaseError('openFailed', 'prepare');
  }
  return { db, close: () => connection.close(), cipherVersion, migratedFromLegacy };
}

async function readStoredKey(keyStore: KeyStore): Promise<string | null> {
  let key: string | null;
  try {
    key = await keyStore.read();
  } catch {
    throw new SecureDatabaseError('secureStorageUnavailable', 'read-key');
  }
  if (key !== null && !isValidDatabaseKey(key)) {
    throw new SecureDatabaseError('keyInvalid');
  }
  return key;
}

// Saves a new key and reads it back before anything is encrypted with it, so a
// key that did not actually persist can never protect data.
async function createAndStoreKey(deps: SecureDatabaseDeps): Promise<string> {
  let key: string;
  try {
    key = await deps.generateKey();
  } catch {
    throw new SecureDatabaseError('openFailed', 'generate-key');
  }
  if (!isValidDatabaseKey(key)) {
    throw new SecureDatabaseError('openFailed', 'generate-key');
  }
  try {
    await deps.keyStore.write(key);
    if ((await deps.keyStore.read()) !== key) {
      throw new Error('The saved key did not match.');
    }
  } catch {
    throw new SecureDatabaseError('secureStorageUnavailable', 'save-key');
  }
  return key;
}

async function openWithKey(driver: CipherDriver, key: string): Promise<SqlConnection> {
  try {
    return await driver.openEncrypted(SECURE_DATABASE_NAME, key);
  } catch (error) {
    if (error instanceof EncryptionUnavailableError) {
      throw new SecureDatabaseError('encryptionUnavailable', 'open');
    }
    if (error instanceof KeyRejectedError) {
      throw new SecureDatabaseError('keyRejected');
    }
    throw new SecureDatabaseError('openFailed', 'open');
  }
}

async function isVerified(connection: SqlExecutor): Promise<boolean> {
  const row = await connection.getFirstAsync<{ application_id: number }>('PRAGMA application_id', []);
  return row?.application_id === VERIFIED_MARKER;
}

async function hasNoCases(connection: SqlExecutor): Promise<boolean> {
  const table = await connection.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cases'",
    [],
  );
  if (!table) {
    return true;
  }
  const row = await connection.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM cases', []);
  return (row?.count ?? 0) === 0;
}

async function readUserVersion(connection: SqlExecutor): Promise<number> {
  const row = await connection.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  return row?.user_version ?? 0;
}

async function verifyCopy(driver: CipherDriver, copy: SqlConnection, expected: string, userVersion: number) {
  await driver.verifyEncryption(copy);
  const integrity = await copy.getAllAsync<{ integrity_check: string }>('PRAGMA integrity_check', []);
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error('Integrity check failed.');
  }
  if ((await readUserVersion(copy)) !== userVersion) {
    throw new Error('Schema version mismatch.');
  }
  if ((await snapshot(copy)) !== expected) {
    throw new Error('Copied records do not match the original.');
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The full schema plus every row of every table, in a deterministic order, so
// two databases can be compared for exact equality (counts and content).
export async function snapshot(connection: SqlExecutor): Promise<string> {
  const schema = await connection.getAllAsync<{ type: string; name: string; sql: string | null }>(
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    [],
  );
  const tables: Record<string, { count: number; rows: unknown[] }> = {};
  for (const entry of schema) {
    if (entry.type !== 'table') {
      continue;
    }
    if (!IDENTIFIER.test(entry.name)) {
      throw new Error('Unexpected table name.');
    }
    const columns = await connection.getAllAsync<{ name: string }>(`PRAGMA table_info("${entry.name}")`, []);
    if (columns.length === 0 || columns.some((column) => !IDENTIFIER.test(column.name))) {
      throw new Error('Unexpected column name.');
    }
    const order = columns.map((column) => `"${column.name}"`).join(', ');
    const rows = await connection.getAllAsync(`SELECT * FROM "${entry.name}" ORDER BY ${order}`, []);
    tables[entry.name] = { count: rows.length, rows };
  }
  return JSON.stringify({ schema, tables });
}

async function guard<T>(code: SecureDatabaseErrorCode, stage: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch {
    throw new SecureDatabaseError(code, stage);
  }
}

async function closeQuietly(connection: SqlConnection): Promise<void> {
  try {
    await connection.close();
  } catch {
    // Already failing; keep the original error.
  }
}
