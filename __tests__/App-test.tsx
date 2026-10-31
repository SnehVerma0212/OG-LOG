import { fireEvent, render, screen } from '@testing-library/react-native';

import App from '../App';
import type { Database } from '../src/db/database';
import { openTestDatabase, type TestDatabase } from '../test-utils/nodeDatabase';

let mockDatabase: () => Promise<Database>;
let mockNextId = 0;
jest.mock('../src/db/client', () => ({
  getDatabase: () => mockDatabase(),
  generateCaseId: () => `case-${++mockNextId}`,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// App lock off (the default), so these tests cover navigation; see AppLockGate-test.
jest.mock('../src/security/expoAppLock', () => ({
  expoAppLockServices: {
    loadPolicy: async () => ({ enabled: false, timeoutSeconds: 0 }),
    savePolicy: async () => undefined,
    authenticate: async () => ({ ok: true }),
    getCapability: async () => ({ available: true, description: 'Device PIN' }),
    enablePrivacyProtection: async () => undefined,
  },
}));

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
  mockDatabase = () => Promise.resolve(db);
});

afterEach(() => db.close());

it('returns to a refreshed My Cases after saving a new draft from Home', async () => {
  await render(<App />);
  expect(await screen.findByLabelText('Total Cases: 0')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'New Case' }));
  await fireEvent.changeText(screen.getByLabelText('Procedure'), 'Test procedure A');
  await fireEvent.press(screen.getByRole('button', { name: 'Save Draft' }));

  // Back on My Cases, with the new draft listed as a draft and a brief confirmation.
  expect(await screen.findByRole('button', { name: /^Test procedure A, .*, Draft$/ })).toBeTruthy();
  expect(screen.getByRole('header', { name: 'My Cases' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'My Cases', selected: true })).toBeTruthy();
  expect(screen.getByText('Draft saved.')).toBeTruthy();
  expect(screen.getByText('1 case')).toBeTruthy();

  // Home counts reflect the saved case too.
  await fireEvent.press(screen.getByRole('tab', { name: 'Home' }));
  expect(await screen.findByLabelText('Total Cases: 1')).toBeTruthy();
  expect(screen.getByLabelText('Drafts: 1')).toBeTruthy();
});

it('returns to the original tab without a confirmation when cancelled', async () => {
  await render(<App />);
  await screen.findByLabelText('Total Cases: 0');

  await fireEvent.press(screen.getByRole('button', { name: 'New Case' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));

  expect(await screen.findByLabelText('Total Cases: 0')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Home', selected: true })).toBeTruthy();
  expect(screen.queryByText('Draft saved.')).toBeNull();
});
