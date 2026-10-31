import { File } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { sqlcipherRawKeyLiteral } from './databaseKey';
import { EncryptionUnavailableError, KeyRejectedError, type CipherDriver, type SqlConnection } from './secureDatabase';

// The only file with SQLCipher-specific SQL. It needs a build made with
// `useSQLCipher: true` (see app.json) and cannot run in Expo Go or in Jest.

// Always open a fresh native connection. expo-sqlite otherwise reuses an open
// connection to the same file, which would skip setting the key and make a
// "reopen to verify" meaningless.
const OPEN_OPTIONS = { useNewConnection: true };

function databaseFile(name: string): File {
  return new File(`file://${defaultDatabaseDirectory}`, name);
}

function connection(db: SQLiteDatabase): SqlConnection {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: async (sql, params) => ({ changes: (await db.runAsync(sql, params)).changes }),
    getFirstAsync: (sql, params) => db.getFirstAsync(sql, params),
    getAllAsync: (sql, params) => db.getAllAsync(sql, params),
    close: () => db.closeAsync(),
  };
}

export const expoCipherDriver: CipherDriver = {
  async cipherVersion() {
    const db = await openDatabaseAsync(':memory:', OPEN_OPTIONS);
    try {
      const row = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
      return row?.cipher_version || null;
    } finally {
      await db.closeAsync();
    }
  },

  async exists(name) {
    const file = databaseFile(name);
    return file.exists && file.size > 0;
  },

  async remove(name) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const file = databaseFile(name + suffix);
      if (file.exists) {
        file.delete();
      }
    }
  },

  async openPlain(name) {
    return connection(await openDatabaseAsync(name, OPEN_OPTIONS));
  },

  async openEncrypted(name, key) {
    const db = await openDatabaseAsync(name, OPEN_OPTIONS);
    try {
      // Must be the first statement on the connection.
      await db.execAsync(`PRAGMA key = ${sqlcipherRawKeyLiteral(key)}`);
      // Without SQLCipher, PRAGMA key silently does nothing: refuse to continue.
      const version = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
      if (!version?.cipher_version) {
        throw new EncryptionUnavailableError();
      }
    } catch (error) {
      await db.closeAsync().catch(() => undefined);
      throw error instanceof EncryptionUnavailableError ? error : new KeyRejectedError();
    }
    try {
      // The first read is where SQLCipher reports a wrong key.
      await db.getFirstAsync('SELECT count(*) AS count FROM sqlite_master');
    } catch {
      await db.closeAsync().catch(() => undefined);
      throw new KeyRejectedError();
    }
    return connection(db);
  },

  async verifyEncryption(db) {
    const version = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version', []);
    if (!version?.cipher_version) {
      throw new EncryptionUnavailableError();
    }
    // No rows means every page authenticated with the key (HMAC check).
    const problems = await db.getAllAsync('PRAGMA cipher_integrity_check', []);
    if (problems.length > 0) {
      throw new Error('Encrypted page check failed.');
    }
  },

  async exportEncrypted(source, targetName, key, userVersion) {
    if (!Number.isInteger(userVersion) || userVersion < 0) {
      throw new Error('Invalid schema version.');
    }
    const targetPath = `${defaultDatabaseDirectory}/${targetName}`;
    await source.runAsync(`ATTACH DATABASE ? AS encrypted KEY ${sqlcipherRawKeyLiteral(key)}`, [targetPath]);
    try {
      await source.getFirstAsync("SELECT sqlcipher_export('encrypted')", []);
      // sqlcipher_export does not copy user_version; the app uses it for migrations.
      await source.execAsync(`PRAGMA encrypted.user_version = ${userVersion}`);
    } finally {
      await source.execAsync('DETACH DATABASE encrypted');
    }
  },
};
