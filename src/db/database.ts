// The small slice of a SQLite connection the app needs. expo-sqlite provides
// it on devices; the tests provide it with Node's built-in SQLite, so the
// same SQL runs against a real database engine in both places.

export type SqlParam = string | number | null;

export interface SqlExecutor {
  // Runs trusted SQL from the codebase only. Never pass user input here.
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlParam[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, params: SqlParam[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params: SqlParam[]): Promise<T[]>;
}

export interface Database extends SqlExecutor {
  // Runs `task` in an exclusive transaction: every statement on `tx` commits
  // together, or all are rolled back if the task throws.
  transaction<T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}
