import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { countCases, createCase, getCase, listCases } from '../src/db/caseRepository';
import type { Database } from '../src/db/database';
import { CaseEditorScreen } from '../src/screens/CaseEditorScreen';
import { caseInput } from '../test-utils/fixtures';
import { openTestDatabase, testIds, type TestDatabase } from '../test-utils/nodeDatabase';

// The editor talks to a real SQLite database (Node's built-in engine) instead
// of expo-sqlite. `mockDatabase` can be swapped per test to simulate failures.
let mockDatabase: () => Promise<Database>;
let mockNextId = 0;
jest.mock('../src/db/client', () => ({
  getDatabase: () => mockDatabase(),
  generateCaseId: () => `case-${++mockNextId}`,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

let db: TestDatabase;
let alert: jest.SpyInstance;
const onClose = jest.fn();
const onSaved = jest.fn();

beforeEach(async () => {
  db = await openTestDatabase();
  mockDatabase = () => Promise.resolve(db);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  onClose.mockClear();
  onSaved.mockClear();
});

afterEach(() => {
  alert.mockRestore();
  db.close();
});

const saveDraftButton = () => screen.getByRole('button', { name: 'Save Draft' });

describe('CaseEditorScreen Save Draft', () => {
  it('saves a new case as a draft and then reports success', async () => {
    await render(<CaseEditorScreen caseId={null} onClose={onClose} onSaved={onSaved} />);
    await fireEvent.changeText(screen.getByLabelText('Procedure'), 'Test procedure A');

    await fireEvent.press(saveDraftButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Draft saved.'));
    expect(onClose).not.toHaveBeenCalled();
    const cases = await listCases(db);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ procedure: 'Test procedure A', status: 'draft' });
  });

  it('saves edits to an existing case and then reports success', async () => {
    const existing = await createCase(db, caseInput({ procedure: 'Before' }), { generateId: testIds() });
    await render(<CaseEditorScreen caseId={existing.id} onClose={onClose} onSaved={onSaved} />);
    const procedure = await screen.findByLabelText('Procedure');

    await fireEvent.changeText(procedure, 'After');
    await fireEvent.press(saveDraftButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Draft saved.'));
    expect(await countCases(db)).toBe(1);
    expect((await getCase(db, existing.id))?.procedure).toBe('After');
  });

  it('stays open and explains the problem when validation fails', async () => {
    await render(<CaseEditorScreen caseId={null} onClose={onClose} onSaved={onSaved} />);
    await fireEvent.changeText(screen.getByLabelText('Surgery date'), '2026-02-30');

    await fireEvent.press(saveDraftButton());

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Cannot save yet', expect.stringContaining('procedure')));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the procedure name.')).toBeTruthy();
    expect(await countCases(db)).toBe(0);
  });

  it('stays open and reports the error when the database fails', async () => {
    mockDatabase = () => Promise.reject(new Error('disk I/O error'));
    await render(<CaseEditorScreen caseId={null} onClose={onClose} onSaved={onSaved} />);
    await fireEvent.changeText(screen.getByLabelText('Procedure'), 'Test procedure A');

    await fireEvent.press(saveDraftButton());

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not save', expect.stringContaining('disk I/O error')));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeTruthy();
  });

  it('stays open when the reference is already used', async () => {
    await createCase(db, caseInput({ reference: 'GS-001' }), { generateId: testIds() });
    await render(<CaseEditorScreen caseId={null} onClose={onClose} onSaved={onSaved} />);
    await fireEvent.changeText(screen.getByLabelText('Case reference (optional)'), 'gs-001');
    await fireEvent.changeText(screen.getByLabelText('Procedure'), 'Test procedure A');

    await fireEvent.press(saveDraftButton());

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Reference already in use', expect.any(String)));
    expect(onSaved).not.toHaveBeenCalled();
    expect(await countCases(db)).toBe(1);
  });

  // Same-frame taps are covered by singleFlight-test; this checks taps made
  // while a save is still in progress.
  it('saves only once when Save Draft is tapped repeatedly during a save', async () => {
    let releaseDatabase!: () => void;
    const databaseReady = new Promise<void>((resolve) => (releaseDatabase = resolve));
    mockDatabase = async () => {
      await databaseReady;
      return db;
    };
    await render(<CaseEditorScreen caseId={null} onClose={onClose} onSaved={onSaved} />);
    await fireEvent.changeText(screen.getByLabelText('Procedure'), 'Test procedure A');

    await fireEvent.press(saveDraftButton());
    expect(screen.getByText('Saving…')).toBeTruthy();
    await fireEvent.press(saveDraftButton());
    await fireEvent.press(saveDraftButton());
    expect(onSaved).not.toHaveBeenCalled();

    releaseDatabase();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(await countCases(db)).toBe(1);
  });
});

describe('CaseEditorScreen status changes', () => {
  it('keeps the editor open after marking a case completed', async () => {
    await render(<CaseEditorScreen caseId={null} onClose={onClose} onSaved={onSaved} />);
    await fireEvent.changeText(screen.getByLabelText('Procedure'), 'Test procedure A');
    await fireEvent.changeText(screen.getByLabelText('Diagnosis'), 'Test diagnosis');
    await fireEvent.press(screen.getByRole('button', { name: 'Primary surgeon' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Save and Mark as Completed' }));

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Case marked as completed.'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((await listCases(db))[0].status).toBe('completed');
  });
});
