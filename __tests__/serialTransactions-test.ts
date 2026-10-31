import { withSerialTransactions } from '../src/db/serialTransactions';
import { openRawTestDatabase } from '../test-utils/nodeDatabase';

describe('withSerialTransactions', () => {
  it('commits, rolls back, and runs overlapping transactions one after another', async () => {
    const raw = openRawTestDatabase();
    await raw.execAsync('CREATE TABLE log (value TEXT)');
    const db = withSerialTransactions(raw);
    const order: string[] = [];
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

    const first = db.transaction(async (tx) => {
      order.push('first:start');
      await tx.runAsync('INSERT INTO log VALUES (?)', ['a']);
      await pause();
      order.push('first:end');
    });
    const failing = db.transaction(async (tx) => {
      order.push('failing:start');
      await tx.runAsync('INSERT INTO log VALUES (?)', ['rolled back']);
      throw new Error('boom');
    });
    const third = db.transaction(async (tx) => {
      order.push('third:start');
      await tx.runAsync('INSERT INTO log VALUES (?)', ['c']);
    });

    await first;
    await expect(failing).rejects.toThrow('boom');
    await third;

    expect(order).toEqual(['first:start', 'first:end', 'failing:start', 'third:start']);
    expect(await db.getAllAsync('SELECT value FROM log ORDER BY rowid', [])).toEqual([{ value: 'a' }, { value: 'c' }]);
    raw.close();
  });
});
