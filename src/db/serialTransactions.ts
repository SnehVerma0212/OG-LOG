import type { Database, SqlExecutor } from './database';

// Adds transactions to a single connection. Transactions run one at a time in
// the order they were requested, on the same connection as everything else.
//
// The encrypted database must use this instead of expo-sqlite's exclusive
// transactions, which open a second connection that would not have the key.
// A task must use `tx` and must not start another transaction from inside
// itself (that would wait forever for the queue).
export function withSerialTransactions(connection: SqlExecutor): Database {
  let queue: Promise<unknown> = Promise.resolve();

  return {
    execAsync: (sql) => connection.execAsync(sql),
    runAsync: (sql, params) => connection.runAsync(sql, params),
    getFirstAsync: (sql, params) => connection.getFirstAsync(sql, params),
    getAllAsync: (sql, params) => connection.getAllAsync(sql, params),
    transaction<T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const run = async () => {
        await connection.execAsync('BEGIN IMMEDIATE');
        try {
          const result = await task(connection);
          await connection.execAsync('COMMIT');
          return result;
        } catch (error) {
          try {
            await connection.execAsync('ROLLBACK');
          } catch {
            // SQLite may already have rolled back; keep the original error.
          }
          throw error;
        }
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
