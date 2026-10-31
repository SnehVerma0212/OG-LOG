import { createCase, getCase, listCases } from '../src/db/caseRepository';
import { migrate } from '../src/db/schema';
import {
  LEGACY_DATABASE_NAME,
  openSecureDatabase,
  SECURE_DATABASE_NAME,
  SecureDatabaseError,
  VERIFIED_MARKER,
  type SecureDatabaseErrorCode,
} from '../src/security/secureDatabase';
import {
  createFakeCipherDriver,
  createMemoryKeyStore,
  makeTempDirectory,
  removeDirectory,
  type FakeCipherDriver,
  type MemoryKeyStore,
} from '../test-utils/fakeCipherDriver';
import { caseInput } from '../test-utils/fixtures';
import { openTestDatabase, testIds } from '../test-utils/nodeDatabase';

// Uses a simulated SQLCipher driver (see test-utils/fakeCipherDriver.ts). These
// tests cover key handling, migration and failure behaviour, not cryptography.

const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);

let directory: string;
let driver: FakeCipherDriver;
let keyStore: MemoryKeyStore;
let generateKey: jest.Mock<Promise<string>, []>;
let generateId: () => string;

beforeEach(() => {
  directory = makeTempDirectory();
  driver = createFakeCipherDriver(directory);
  keyStore = createMemoryKeyStore();
  generateKey = jest.fn(async () => KEY_A);
  generateId = testIds();
});

afterEach(() => {
  expect(driver.openConnectionCount()).toBe(0);
  removeDirectory(directory);
});

const open = () => openSecureDatabase({ driver, keyStore, generateKey, migrate });

async function expectSecureError(promise: Promise<unknown>, code: SecureDatabaseErrorCode) {
  const error = await promise.then(
    () => {
      throw new Error(`Expected ${code}, but the database opened.`);
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SecureDatabaseError);
  expect((error as SecureDatabaseError).code).toBe(code);
  // No key material may ever appear in what the app could display or log.
  for (const key of [KEY_A, KEY_B]) {
    expect(String(error)).not.toContain(key);
    expect((error as SecureDatabaseError).stage ?? '').not.toContain(key);
  }
  return error as SecureDatabaseError;
}

// Creates an unencrypted Milestone 3 database with synthetic cases.
async function createLegacyDatabase(count = 2) {
  const legacy = await openTestDatabase(driver.filePath(LEGACY_DATABASE_NAME));
  for (let index = 1; index <= count; index += 1) {
    await createCase(
      legacy,
      caseInput({
        reference: `T-${index}`,
        procedure: `Test procedure ${index}`,
        sections: { preop: { indication: `Indication ${index}` }, ot: { duration: `${index * 10} minutes` }, postop: {} },
      }),
      { generateId },
    );
  }
  const records = await Promise.all((await listCases(legacy)).map((item) => getCase(legacy, item.id)));
  legacy.close();
  return records;
}

describe('first launch', () => {
  it('creates a verified encrypted database with a newly generated, stored key', async () => {
    const opened = await open();

    expect(generateKey).toHaveBeenCalledTimes(1);
    expect(keyStore.value).toBe(KEY_A);
    expect(opened.cipherVersion).toBe('4.17.0 community');
    expect(opened.migratedFromLegacy).toBe(false);
    expect(driver.isEncrypted(SECURE_DATABASE_NAME)).toBe(true);
    expect(await driver.exists(LEGACY_DATABASE_NAME)).toBe(false);
    const marker = await opened.db.getFirstAsync<{ application_id: number }>('PRAGMA application_id', []);
    expect(marker?.application_id).toBe(VERIFIED_MARKER);

    const created = await createCase(opened.db, caseInput(), { generateId });
    expect(await getCase(opened.db, created.id)).toEqual(created);
    await opened.close();
  });

  it('reuses a key that survived an app reinstall when there is no database', async () => {
    keyStore.value = KEY_B;
    const opened = await open();
    expect(generateKey).not.toHaveBeenCalled();
    expect(keyStore.writes).toBe(0);
    await opened.close();
  });
});

describe('reopening', () => {
  it('keeps records across restarts with the same key and never makes a new one', async () => {
    const first = await open();
    const created = await createCase(first.db, caseInput({ reference: 'R-1' }), { generateId });
    await first.close();

    const second = await open();
    expect(await getCase(second.db, created.id)).toEqual(created);
    expect(generateKey).toHaveBeenCalledTimes(1);
    expect(keyStore.writes).toBe(1);
    await second.close();
  });

  it('supports transactions on the keyed connection', async () => {
    const opened = await open();
    await expect(
      opened.db.transaction(async (tx) => {
        await tx.runAsync(
          "INSERT INTO cases (id, surgery_date, procedure, status, created_at, updated_at) VALUES ('x', '2026-10-01', 'T', 'draft', 'n', 'n')",
          [],
        );
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await listCases(opened.db)).toEqual([]);
    await opened.close();
  });
});

describe('failing closed', () => {
  it('refuses to open anything when SQLCipher is not in the build', async () => {
    driver.cipherVersionValue = null;
    await expectSecureError(open(), 'encryptionUnavailable');
    expect(await driver.exists(SECURE_DATABASE_NAME)).toBe(false);
    expect(generateKey).not.toHaveBeenCalled();
    expect(keyStore.writes).toBe(0);
  });

  it('does not replace a missing key when an encrypted database exists', async () => {
    (await open()).close();
    keyStore.value = null;

    await expectSecureError(open(), 'keyMissing');

    expect(generateKey).toHaveBeenCalledTimes(1); // only the original key
    expect(keyStore.value).toBeNull();
    expect(driver.isEncrypted(SECURE_DATABASE_NAME)).toBe(true);
  });

  it('does not touch the database when the stored key is wrong', async () => {
    const first = await open();
    const created = await createCase(first.db, caseInput(), { generateId });
    await first.close();
    keyStore.value = KEY_B;

    await expectSecureError(open(), 'keyRejected');

    keyStore.value = KEY_A;
    const reopened = await open();
    expect(await getCase(reopened.db, created.id)).toEqual(created);
    await reopened.close();
  });

  it('rejects a damaged stored key', async () => {
    keyStore.value = 'not-a-key';
    await expectSecureError(open(), 'keyInvalid');
    expect(await driver.exists(SECURE_DATABASE_NAME)).toBe(false);
  });

  it('reports secure storage that cannot be read', async () => {
    keyStore.failRead = true;
    await expectSecureError(open(), 'secureStorageUnavailable');
    expect(await driver.exists(SECURE_DATABASE_NAME)).toBe(false);
  });

  it('never encrypts with a key that did not persist', async () => {
    keyStore.dropWrites = true;
    await expectSecureError(open(), 'secureStorageUnavailable');
    expect(await driver.exists(SECURE_DATABASE_NAME)).toBe(false);

    keyStore.dropWrites = false;
    keyStore.failWrite = true;
    await expectSecureError(open(), 'secureStorageUnavailable');
    expect(await driver.exists(SECURE_DATABASE_NAME)).toBe(false);
  });

  it('does not migrate when the key cannot be saved, leaving the original intact', async () => {
    const records = await createLegacyDatabase();
    keyStore.failWrite = true;

    await expectSecureError(open(), 'secureStorageUnavailable');

    const legacy = await openTestDatabase(driver.filePath(LEGACY_DATABASE_NAME));
    expect(await getCase(legacy, records[0]!.id)).toEqual(records[0]);
    legacy.close();
  });
});

describe('migrating the unencrypted Milestone 3 database', () => {
  it('copies every record, verifies it and only then removes the original', async () => {
    const records = await createLegacyDatabase(3);

    const opened = await open();

    expect(opened.migratedFromLegacy).toBe(true);
    expect(await driver.exists(LEGACY_DATABASE_NAME)).toBe(false);
    expect(driver.isEncrypted(SECURE_DATABASE_NAME)).toBe(true);
    for (const record of records) {
      expect(await getCase(opened.db, record!.id)).toEqual(record);
    }
    expect(await listCases(opened.db)).toHaveLength(3);
    await opened.close();
  });

  it('keeps the original and discards the copy when the export fails, then succeeds on retry', async () => {
    const records = await createLegacyDatabase();
    driver.failExport = true;

    const error = await expectSecureError(open(), 'migrationFailed');

    expect(error.stage).toBe('export');
    expect(await driver.exists(SECURE_DATABASE_NAME)).toBe(false);
    expect(await driver.exists(LEGACY_DATABASE_NAME)).toBe(true);

    driver.failExport = false;
    const opened = await open();
    expect(await getCase(opened.db, records[1]!.id)).toEqual(records[1]);
    expect(generateKey).toHaveBeenCalledTimes(1); // the same key is reused on retry
    await opened.close();
  });

  it('refuses a copy whose content differs from the original', async () => {
    const records = await createLegacyDatabase();
    driver.afterExport = async (copy) => {
      await copy.runAsync('DELETE FROM case_sections WHERE section = ?', ['ot']);
    };

    const error = await expectSecureError(open(), 'migrationFailed');

    expect(error.stage).toBe('verify-copy');
    expect(await driver.exists(SECURE_DATABASE_NAME)).toBe(false);
    const legacy = await openTestDatabase(driver.filePath(LEGACY_DATABASE_NAME));
    expect(await getCase(legacy, records[0]!.id)).toEqual(records[0]);
    legacy.close();
  });

  it('refuses a copy whose records were changed', async () => {
    await createLegacyDatabase();
    driver.afterExport = async (copy) => {
      await copy.runAsync('UPDATE cases SET diagnosis = ? WHERE reference = ?', ['altered', 'T-1']);
    };
    await expectSecureError(open(), 'migrationFailed');
    expect(await driver.exists(LEGACY_DATABASE_NAME)).toBe(true);
  });

  it('refuses a copy that fails the encryption check', async () => {
    await createLegacyDatabase();
    driver.failVerifyEncryption = true;
    await expectSecureError(open(), 'migrationFailed');
    expect(await driver.exists(LEGACY_DATABASE_NAME)).toBe(true);
    expect(await driver.exists(SECURE_DATABASE_NAME)).toBe(false);
  });

  it('redoes a migration that was interrupted before verification', async () => {
    const records = await createLegacyDatabase();
    // Simulate a crash after export but before the copy was marked verified.
    keyStore.value = KEY_A;
    const partial = await driver.openEncrypted(SECURE_DATABASE_NAME, KEY_A);
    await partial.execAsync('CREATE TABLE junk (x TEXT)');
    await partial.close();

    const opened = await open();

    expect(opened.migratedFromLegacy).toBe(true);
    expect(await getCase(opened.db, records[0]!.id)).toEqual(records[0]);
    const junk = await opened.db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'junk'", []);
    expect(junk).toBeNull();
    await opened.close();
  });

  it('finishes a migration that stopped after verification, keeping the encrypted data', async () => {
    const first = await open();
    const created = await createCase(first.db, caseInput({ procedure: 'Encrypted copy' }), { generateId });
    await first.close();
    // A leftover original with different content must not replace the verified copy.
    await createLegacyDatabase(1);

    const opened = await open();

    expect(await driver.exists(LEGACY_DATABASE_NAME)).toBe(false);
    expect((await listCases(opened.db)).map((item) => item.id)).toEqual([created.id]);
    expect(opened.migratedFromLegacy).toBe(false);
    await opened.close();
  });

  it('leaves an unverified encrypted database with records untouched when there is no original', async () => {
    keyStore.value = KEY_A;
    const unverified = await driver.openEncrypted(SECURE_DATABASE_NAME, KEY_A);
    await migrate({ ...unverified, transaction: (task) => task(unverified) });
    await unverified.runAsync(
      "INSERT INTO cases (id, surgery_date, procedure, status, created_at, updated_at) VALUES ('kept', '2026-10-01', 'T', 'draft', 'n', 'n')",
      [],
    );
    await unverified.close();

    await expectSecureError(open(), 'unverifiedDatabase');

    const check = await driver.openEncrypted(SECURE_DATABASE_NAME, KEY_A);
    expect(await check.getFirstAsync('SELECT id FROM cases', [])).toEqual({ id: 'kept' });
    await check.close();
  });

  it('recreates an interrupted first-time setup that never held cases', async () => {
    keyStore.value = KEY_A;
    await (await driver.openEncrypted(SECURE_DATABASE_NAME, KEY_A)).close();
    // An empty file counts as "no database", so give it a table to make it non-empty.
    const partial = await driver.openEncrypted(SECURE_DATABASE_NAME, KEY_A);
    await partial.execAsync('CREATE TABLE half_done (x TEXT)');
    await partial.close();

    const opened = await open();
    expect(await listCases(opened.db)).toEqual([]);
    await opened.close();
  });
});
