import { countCases } from '../src/db/caseRepository';
import { saveCase } from '../src/db/saveCase';
import { createSingleFlight } from '../src/utils/singleFlight';
import { caseInput } from '../test-utils/fixtures';
import { openTestDatabase, testIds } from '../test-utils/nodeDatabase';

describe('createSingleFlight', () => {
  it('ignores calls made while a task is running', async () => {
    const guard = createSingleFlight();
    const task = jest.fn(async () => 'done');

    const results = await Promise.all([guard.run(task), guard.run(task), guard.run(task)]);

    expect(task).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['done', undefined, undefined]);
  });

  it('allows a new task once the previous one finished or failed', async () => {
    const guard = createSingleFlight();
    await expect(guard.run(() => Promise.reject(new Error('failed')))).rejects.toThrow('failed');
    expect(guard.isRunning()).toBe(false);
    await expect(guard.run(async () => 2)).resolves.toBe(2);
  });

  it('turns rapid repeated saves of a new case into a single case', async () => {
    const db = await openTestDatabase();
    const guard = createSingleFlight();
    const generateId = testIds();
    const attemptSave = jest.fn(() =>
      saveCase(() => Promise.resolve(db), { caseId: null, input: caseInput(), generateId }),
    );
    const tap = () => guard.run(attemptSave);

    const outcomes = await Promise.all([tap(), tap(), tap()]);

    expect(attemptSave).toHaveBeenCalledTimes(1);
    expect(outcomes[0]?.ok).toBe(true);
    expect(await countCases(db)).toBe(1);
    db.close();
  });
});
