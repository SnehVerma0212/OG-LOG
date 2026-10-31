import { createCase, getCase, listCases, updateCase } from '../src/db/caseRepository';
import { SCHEMA_VERSION } from '../src/db/schema';
import { caseInput } from '../test-utils/fixtures';
import { nodeBuiltin, openTestDatabase, testClock, testIds } from '../test-utils/nodeDatabase';

// Simulates closing and relaunching the app by reopening the same database
// file. This exercises SQLite file persistence and the launch-time migration;
// it is not a test of expo-sqlite on a physical device.

const fs = nodeBuiltin<{
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}>('node:fs');
const os = nodeBuiltin<{ tmpdir(): string }>('node:os');
const path = nodeBuiltin<{ join(...parts: string[]): string }>('node:path');

let directory: string;
let file: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oglog-test-'));
  file = path.join(directory, 'oglog.db');
});

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

it('restores saved cases after the database is closed and reopened', async () => {
  const now = testClock();
  const first = await openTestDatabase(file);
  const created = await createCase(
    first,
    caseInput({ reference: 'GS-010', sections: { preop: {}, ot: { duration: '75 minutes' }, postop: {} } }),
    { generateId: testIds(), now },
  );
  first.close();

  const second = await openTestDatabase(file);
  expect(await getCase(second, created.id)).toEqual(created);
  expect(await listCases(second)).toHaveLength(1);

  await updateCase(second, created.id, caseInput({ reference: 'GS-010', status: 'completed' }), { now });
  second.close();

  const third = await openTestDatabase(file);
  const reloaded = await getCase(third, created.id);
  expect(reloaded?.status).toBe('completed');
  const version = await third.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  expect(version?.user_version).toBe(SCHEMA_VERSION);
  third.close();
});
