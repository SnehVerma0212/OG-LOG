import type { Database } from './database';

// Each entry upgrades the schema by one version. Never edit a migration that
// has shipped; append a new one instead. The version is kept in SQLite's
// built-in `user_version` header field.
const MIGRATIONS: string[] = [
  // Version 1: cases and their three sections.
  `
  CREATE TABLE cases (
    id TEXT PRIMARY KEY NOT NULL,
    reference TEXT COLLATE NOCASE,
    surgery_date TEXT NOT NULL,
    procedure TEXT NOT NULL,
    diagnosis TEXT NOT NULL DEFAULT '',
    role TEXT CHECK (role IN ('primary', 'assistant', 'supervisor', 'observer')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'completed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX cases_reference_unique ON cases (reference) WHERE reference IS NOT NULL;
  CREATE INDEX cases_surgery_date ON cases (surgery_date);
  CREATE INDEX cases_updated_at ON cases (updated_at);

  CREATE TABLE case_sections (
    case_id TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('preop', 'ot', 'postop')),
    fields TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (case_id, section)
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: Database): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let version = row?.user_version ?? 0;

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `The saved database uses schema version ${version}, but this app only supports up to ${SCHEMA_VERSION}. Update the app before opening it.`,
    );
  }

  while (version < SCHEMA_VERSION) {
    const next = version + 1;
    const migration = MIGRATIONS[version];
    await db.transaction(async (tx) => {
      await tx.execAsync(migration);
      // PRAGMA values cannot be bound as parameters; `next` is an integer from this file.
      await tx.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}
