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

// Supabase project defaults the migration must work under:
// - 'exposed': current default. New public tables are granted to the API
//   roles automatically, so the migration's REVOKEs must take effect.
// - 'hardened': "Automatically expose new tables" off and EXECUTE on new
//   functions revoked from PUBLIC, as Supabase recommends and plans to make
//   the platform default. The migration's explicit GRANTs must suffice.
export type SupabaseDefaults = 'exposed' | 'hardened';

export const SUPABASE_DEFAULTS: SupabaseDefaults[] = ['exposed', 'hardened'];

export class TestDatabase {
  private constructor(readonly db: PGlite) {}

  static async create(defaults: SupabaseDefaults = 'exposed'): Promise<TestDatabase> {
    const db = new PGlite();
    if (defaults === 'exposed') {
      await db.exec(shim);
    } else {
      await db.exec(shim.replace(/^alter default privileges in schema public grant[^;]*;$/gm, ''));
      await db.exec('alter default privileges revoke execute on functions from public;');
    }
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

  // Simulates Supabase Auth creating an account. By default the account has
  // already replaced its initial password, like any account in normal use;
  // first-login tests pass `initialPasswordPending: true` to keep the flag the
  // database sets on new accounts.
  async createUser(email: string, { initialPasswordPending = false } = {}): Promise<string> {
    const [row] = await this.admin<{ id: string }>(
      "insert into auth.users (email, encrypted_password) values ($1, 'initial-hash') returning id",
      [email],
    );
    if (!initialPasswordPending && (await this.hasColumn('profiles', 'password_change_required'))) {
      await this.setPassword(row!.id, 'changed-hash');
    }
    return row!.id;
  }

  // Simulates Supabase Auth storing a new password hash for the user.
  async setPassword(userId: string, hash: string): Promise<void> {
    await this.admin('update auth.users set encrypted_password = $2 where id = $1', [userId, hash]);
  }

  private async hasColumn(table: string, column: string): Promise<boolean> {
    const rows = await this.admin(
      "select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2",
      [table, column],
    );
    return rows.length > 0;
  }

  // A normal session (assurance level aal1: password only).
  asUser<T>(userId: string, work: (query: Query) => Promise<T>): Promise<T> {
    return this.withRole('authenticated', { sub: userId, role: 'authenticated', aal: 'aal1' }, work);
  }

  // A session that has also completed two-step verification.
  asUserWithSecondStep<T>(userId: string, work: (query: Query) => Promise<T>): Promise<T> {
    return this.withRole('authenticated', { sub: userId, role: 'authenticated', aal: 'aal2' }, work);
  }

  // A signed-in role with arbitrary claims, e.g. a malformed or stale `sub`.
  // (Supabase verifies JWT signatures before claims reach Postgres; this only
  // checks how the database treats unusual claim values.)
  asAuthenticatedWithClaims<T>(claims: Record<string, string>, work: (query: Query) => Promise<T>): Promise<T> {
    return this.withRole('authenticated', { role: 'authenticated', ...claims }, work);
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
