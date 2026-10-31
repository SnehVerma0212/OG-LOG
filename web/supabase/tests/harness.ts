import { PGlite, type Transaction } from '@electric-sql/pglite';

import shim from './supabase-auth-shim.sql?raw';

// Real PostgreSQL (PGlite: Postgres compiled to WebAssembly) with the test
// stand-in for Supabase's auth schema and roles, then every migration in order.
// Queries can run as the database owner, as a signed-in user (role
// `authenticated` with that user's JWT claims), as `anon`, or as
// `service_role`, so Row Level Security is enforced by Postgres itself.

const migrations = import.meta.glob('../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface QueryFailure {
  code: string;
  message: string;
}

export class TestDatabase {
  private constructor(readonly db: PGlite) {}

  static async create(): Promise<TestDatabase> {
    const db = new PGlite();
    await db.exec(shim);
    for (const name of Object.keys(migrations).sort()) {
      await db.exec(migrations[name]!);
    }
    return new TestDatabase(db);
  }

  migrationNames(): string[] {
    return Object.keys(migrations).sort();
  }

  // Runs as the database owner (bypasses RLS), for setup and inspection only.
  async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.db.query<T>(sql, params)).rows;
  }

  // Simulates Supabase Auth creating an account.
  async createUser(email: string): Promise<string> {
    const [row] = await this.admin<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
    return row!.id;
  }

  asUser<T>(userId: string, work: (query: Query) => Promise<T>): Promise<T> {
    return this.withRole('authenticated', { sub: userId, role: 'authenticated' }, work);
  }

  // A signed-in role whose token has no user ID: must still see nothing.
  asAuthenticatedWithoutUser<T>(work: (query: Query) => Promise<T>): Promise<T> {
    return this.withRole('authenticated', { role: 'authenticated' }, work);
  }

  asAnon<T>(work: (query: Query) => Promise<T>): Promise<T> {
    return this.withRole('anon', { role: 'anon' }, work);
  }

  asServiceRole<T>(work: (query: Query) => Promise<T>): Promise<T> {
    return this.withRole('service_role', { role: 'service_role' }, work);
  }

  // Each call is one transaction, like one API request. If `work` throws, the
  // transaction rolls back and the error propagates.
  private withRole<T>(role: string, claims: Record<string, string>, work: (query: Query) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx: Transaction) => {
      await tx.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify(claims)]);
      await tx.exec(`set local role ${role}`);
      const query: Query = async (sql, params = []) => (await tx.query(sql, params)).rows as never;
      return work(query);
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

// Captures the PostgreSQL error code and message of a rejected operation.
export async function failure(promise: Promise<unknown>): Promise<QueryFailure> {
  try {
    await promise;
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return { code: code ?? 'unknown', message: message ?? String(error) };
  }
  throw new Error('Expected the operation to be rejected, but it succeeded.');
}
