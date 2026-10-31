import type { KeyStore } from '../src/security/databaseKey';
import {
  EncryptionUnavailableError,
  KeyRejectedError,
  type CipherDriver,
  type SqlConnection,
} from '../src/security/secureDatabase';
import { nodeBuiltin, openRawTestDatabase } from './nodeDatabase';

// TEST DOUBLE — NO REAL ENCRYPTION. Simulates SQLCipher's observable behaviour
// on Node's SQLite so the migration and key-handling logic can be tested:
// each "encrypted" file gets a `<name>.testkey` sidecar holding its key; a
// wrong key or a plaintext/encrypted mismatch is rejected the way SQLCipher
// rejects it. Real encryption can only be verified in a SQLCipher build.

const fs = nodeBuiltin<{
  existsSync(path: string): boolean;
  statSync(path: string): { size: number };
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  rmSync(path: string, options: { force: boolean }): void;
  mkdtempSync(prefix: string): string;
}>('node:fs');
const os = nodeBuiltin<{ tmpdir(): string }>('node:os');
const path = nodeBuiltin<{ join(...parts: string[]): string }>('node:path');

export function makeTempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oglog-secure-'));
}

export function removeDirectory(directory: string): void {
  (nodeBuiltin<{ rmSync(path: string, options: { recursive: boolean; force: boolean }): void }>('node:fs')).rmSync(
    directory,
    { recursive: true, force: true },
  );
}

interface FakeConnection extends SqlConnection {
  file: string;
}

export interface FakeCipherDriver extends CipherDriver {
  cipherVersionValue: string | null;
  // Runs on the copy right after export, e.g. to corrupt it.
  afterExport?: (copy: SqlConnection) => Promise<void>;
  failExport: boolean;
  failVerifyEncryption: boolean;
  openConnectionCount(): number;
  filePath(name: string): string;
  isEncrypted(name: string): boolean;
}

export function createFakeCipherDriver(directory: string): FakeCipherDriver {
  const filePath = (name: string) => path.join(directory, name);
  const keyPath = (name: string) => `${filePath(name)}.testkey`;
  const open = new Set<FakeConnection>();

  const exists = (file: string) => fs.existsSync(file) && fs.statSync(file).size > 0;

  function connect(name: string): FakeConnection {
    const file = filePath(name);
    const db = openRawTestDatabase(file);
    const connection: FakeConnection = {
      file,
      execAsync: db.execAsync,
      runAsync: db.runAsync,
      getFirstAsync: db.getFirstAsync,
      getAllAsync: db.getAllAsync,
      close: async () => {
        db.close();
        open.delete(connection);
      },
    };
    open.add(connection);
    return connection;
  }

  const driver: FakeCipherDriver = {
    cipherVersionValue: '4.17.0 community',
    failExport: false,
    failVerifyEncryption: false,
    openConnectionCount: () => open.size,
    filePath,
    isEncrypted: (name) => fs.existsSync(keyPath(name)),

    async cipherVersion() {
      return driver.cipherVersionValue;
    },
    async exists(name) {
      return exists(filePath(name));
    },
    async remove(name) {
      for (const suffix of ['', '-wal', '-shm', '-journal', '.testkey']) {
        fs.rmSync(filePath(name) + suffix, { force: true });
      }
    },
    async openPlain(name) {
      if (fs.existsSync(keyPath(name))) {
        throw new Error('file is not a database');
      }
      return connect(name);
    },
    async openEncrypted(name, key) {
      if (!driver.cipherVersionValue) {
        throw new EncryptionUnavailableError();
      }
      if (exists(filePath(name))) {
        if (!fs.existsSync(keyPath(name)) || fs.readFileSync(keyPath(name), 'utf8') !== key) {
          throw new KeyRejectedError();
        }
      } else {
        fs.writeFileSync(keyPath(name), key);
      }
      return connect(name);
    },
    async verifyEncryption(connection) {
      const file = (connection as FakeConnection).file;
      if (driver.failVerifyEncryption || !fs.existsSync(`${file}.testkey`)) {
        throw new Error('Encrypted page check failed.');
      }
    },
    async exportEncrypted(source, targetName, key, userVersion) {
      if (driver.failExport) {
        throw new Error(`simulated export failure (key ${key})`);
      }
      const target = filePath(targetName);
      if (target.includes("'")) {
        throw new Error('Unsafe test path.');
      }
      await source.execAsync(`VACUUM INTO '${target}'`);
      fs.writeFileSync(keyPath(targetName), key);
      const copy = connect(targetName);
      // Like sqlcipher_export, the copy's user_version is set explicitly.
      await copy.execAsync(`PRAGMA user_version = ${userVersion}`);
      await driver.afterExport?.(copy);
      await copy.close();
    },
  };
  return driver;
}

export interface MemoryKeyStore extends KeyStore {
  value: string | null;
  failRead: boolean;
  failWrite: boolean;
  // Accepts writes but does not keep them, like storage that silently fails.
  dropWrites: boolean;
  writes: number;
}

export function createMemoryKeyStore(initial: string | null = null): MemoryKeyStore {
  const store: MemoryKeyStore = {
    value: initial,
    failRead: false,
    failWrite: false,
    dropWrites: false,
    writes: 0,
    async read() {
      if (store.failRead) {
        throw new Error('keystore unavailable');
      }
      return store.value;
    },
    async write(key) {
      if (store.failWrite) {
        throw new Error('keystore unavailable');
      }
      store.writes += 1;
      if (!store.dropWrites) {
        store.value = key;
      }
    },
  };
  return store;
}
