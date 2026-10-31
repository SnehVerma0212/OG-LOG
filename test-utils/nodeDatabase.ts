import type { Database, SqlExecutor, SqlParam } from '../src/db/database';
import { migrate } from '../src/db/schema';

// Test-only Database backed by Node's built-in SQLite engine (node:sqlite,
// Node.js 22.13+). It runs the app's real SQL, so tests exercise the actual
// schema, constraints and queries rather than a mock.
//
// Foreign keys are deliberately left OFF, matching expo-sqlite's exclusive
// transaction connections, so tests prove deletes do not rely on CASCADE.

interface NodeStatement {
  run(...params: SqlParam[]): { changes: number | bigint };
  get(...params: SqlParam[]): unknown;
  all(...params: SqlParam[]): unknown[];
}

interface NodeDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}

interface NodeSqlite {
  DatabaseSync: new (path: string) => NodeDatabaseSync;
}

export interface TestDatabase extends Database {
  close(): void;
}

// Loaded through getBuiltinModule so Jest's module resolver is not involved.
export function nodeBuiltin<T>(id: string): T {
  const nodeProcess = (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process;
  const loaded = nodeProcess?.getBuiltinModule?.(id);
  if (!loaded) {
    throw new Error(`The tests need Node.js 22.13 or newer (missing ${id}).`);
  }
  return loaded as T;
}

// Opens a database without running migrations.
export function openRawTestDatabase(path = ':memory:'): TestDatabase {
  const { DatabaseSync } = nodeBuiltin<NodeSqlite>('node:sqlite');
  const sqlite = new DatabaseSync(path);
  // node:sqlite enables foreign keys by default; turn them off (see note above).
  sqlite.exec('PRAGMA foreign_keys = OFF');

  const executor: SqlExecutor = {
    execAsync: async (sql) => {
      sqlite.exec(sql);
    },
    runAsync: async (sql, params) => ({ changes: Number(sqlite.prepare(sql).run(...params).changes) }),
    getFirstAsync: async <T>(sql: string, params: SqlParam[]) => (sqlite.prepare(sql).get(...params) ?? null) as T | null,
    getAllAsync: async <T>(sql: string, params: SqlParam[]) => sqlite.prepare(sql).all(...params) as T[],
  };

  return {
    ...executor,
    async transaction<T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await task(executor);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => sqlite.close(),
  };
}

// Opens a database and migrates it, as the app does on launch.
export async function openTestDatabase(path = ':memory:'): Promise<TestDatabase> {
  const db = openRawTestDatabase(path);
  await migrate(db);
  return db;
}

// Deterministic ids and a clock that moves forward one minute per call.
export function testIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
  };
}

export function testClock(start = '2026-10-22T09:00:00.000Z'): () => Date {
  let current = new Date(start).getTime();
  return () => {
    const value = new Date(current);
    current += 60_000;
    return value;
  };
}
