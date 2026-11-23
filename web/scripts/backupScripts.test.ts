// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { env as processEnv } from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';

// The backup scripts (scripts/), run against synthetic dumps and archives in a
// private temporary folder. Nothing here touches Supabase.
const SCRIPTS = resolve(import.meta.dirname);
const work = mkdtempSync(join(tmpdir(), 'oglog-backup-test-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function counts(sql: string): Record<string, number> {
  const file = join(work, `dump-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, sql);
  const out = execFileSync('node', [join(SCRIPTS, 'dump-counts.mjs'), file], { encoding: 'utf8' });
  return Object.fromEntries(out.trim().split('\n').filter(Boolean).map((line: string) => [line.split(' ')[0], Number(line.split(' ')[1])]));
}

describe('dump-counts.mjs', () => {
  it('counts rows, not statements, in multi-row INSERTs', () => {
    const sql = [
      '--',
      '-- Data for Name: cases; Type: TABLE DATA; Schema: public; Owner: postgres',
      '--',
      '',
      'INSERT INTO "public"."cases" ("id", "notes") VALUES',
      "\t('1', 'plain'),",
      "\t('2', 'x'),",
      "\t('3', NULL);",
      '',
      'INSERT INTO "auth"."users" ("id") VALUES',
      "\t('u1');",
      'INSERT INTO "public"."cases" ("id", "notes") VALUES',
      "\t('4', 'later');",
    ].join('\n');
    expect(counts(sql)).toEqual({ 'auth.users': 1, 'public.cases': 4 });
  });

  it('counts tables with identity columns (OVERRIDING SYSTEM VALUE)', () => {
    const sql = 'INSERT INTO "public"."audit_events" ("id", "action") OVERRIDING SYSTEM VALUE VALUES\n\t(1, \'case.created\'),\n\t(2, \'photo.added\');\n';
    expect(counts(sql)).toEqual({ 'public.audit_events': 2 });
  });

  it('fails on an INSERT form it does not recognise instead of skipping its rows', () => {
    const file = join(work, 'unknown.sql');
    writeFileSync(file, 'INSERT INTO public.cases VALUES (1);\n');
    expect(spawnSync('node', [join(SCRIPTS, 'dump-counts.mjs'), file]).status).toBe(1);
  });

  it('is not misled by brackets, quotes, semicolons or line breaks inside text', () => {
    const tricky = "it''s (left) side; then\n\t('not', 'a row'),\nINSERT INTO \"public\".\"cases\" (\"id\") VALUES ('x');\n-- not a comment";
    const sql = `INSERT INTO "public"."cases" ("id", "notes") VALUES\n\t('1', '${tricky}'),\n\t('2', '(((');\n`;
    expect(counts(sql)).toEqual({ 'public.cases': 2 });
  });

  it('fails on a truncated dump instead of reporting a smaller count', () => {
    const file = join(work, 'truncated.sql');
    writeFileSync(file, 'INSERT INTO "public"."cases" ("id") VALUES\n\t(\'1\'),\n\t(\'2');
    const result = spawnSync('node', [join(SCRIPTS, 'dump-counts.mjs'), file], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });
});

const hasGpg = spawnSync('gpg', ['--version']).status === 0;

describe.skipIf(!hasGpg)('verify-backup.sh', () => {
  const passphrase = join(work, 'passphrase');
  const wrong = join(work, 'wrong-passphrase');
  writeFileSync(passphrase, `synthetic-${Math.random()}`, { mode: 0o600 });
  writeFileSync(wrong, `other-${Math.random()}`, { mode: 0o600 });

  // A synthetic backup with one case, one photo record and `photos` files.
  function archive(name: string, options: { photos?: number; tamper?: boolean } = {}): string {
    const root = join(work, name);
    const dir = join(root, 'backup');
    mkdirSync(join(dir, 'storage/case-photos/u/c'), { recursive: true });
    writeFileSync(
      join(dir, 'data.sql'),
      'INSERT INTO "public"."cases" ("id") VALUES\n\t(\'c\');\nINSERT INTO "public"."case_attachments" ("id") VALUES\n\t(\'a\');\n',
    );
    writeFileSync(join(dir, 'schema.sql'), '-- schema\n');
    writeFileSync(join(dir, 'MIGRATIONS.txt'), '20261031120000_case_logbook_schema.sql\n');
    writeFileSync(join(dir, 'INFO.txt'), 'created_utc=20260101T000000Z\nproject_ref=abcdefghijklmnopqrst\n');
    for (let n = 0; n < (options.photos ?? 1); n += 1) {
      writeFileSync(join(dir, `storage/case-photos/u/c/p${n}`), `synthetic photo ${n}`);
    }
    execFileSync('bash', ['-c', 'find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256'], { cwd: dir });
    if (options.tamper) {
      writeFileSync(join(dir, 'schema.sql'), '-- changed\n');
    }
    const target = join(work, `${name}.tar.gpg`);
    execFileSync('bash', [
      '-c',
      `tar -C "${root}" -cf - backup | gpg --batch --yes --pinentry-mode loopback --passphrase-file "${passphrase}" --symmetric --cipher-algo AES256 -o "${target}"`,
    ], { stdio: 'ignore' });
    return target;
  }

  function verify(file: string, pass = passphrase) {
    const result = spawnSync('bash', [join(SCRIPTS, 'verify-backup.sh'), file], {
      encoding: 'utf8',
      env: { ...processEnv, OGLOG_BACKUP_PASSPHRASE_FILE: pass },
    });
    return { status: result.status, output: result.stdout + result.stderr };
  }

  it('verifies a complete archive and shows the project and row counts', () => {
    const { status, output } = verify(archive('good'));
    expect(status).toBe(0);
    expect(output).toMatch(/project_ref: abcdefghijklmnopqrst/);
    expect(output).toMatch(/public\.cases\s+1/);
    expect(output).toMatch(/Backup verified\./);
  });

  it('names a wrong passphrase', () => {
    const { status, output } = verify(archive('wrong'), wrong);
    expect(status).toBe(1);
    expect(output).toMatch(/Wrong passphrase/);
  });

  it('reports a damaged or truncated archive', () => {
    const file = archive('damaged');
    const bytes = readFileSync(file);
    writeFileSync(file, bytes.subarray(0, bytes.length - 40));
    const { status, output } = verify(file);
    expect(status).toBe(1);
    expect(output, output).toMatch(/damaged or incomplete/);
  });

  it('reports a file that does not match its checksum', () => {
    const { status, output } = verify(archive('tampered', { tamper: true }));
    expect(status).toBe(1);
    expect(output).toMatch(/Checksum mismatch/);
  });

  it('flags photo records and photo files that do not match', () => {
    const { status, output } = verify(archive('photos', { photos: 2 }));
    expect(status).toBe(1);
    expect(output).toMatch(/1 photo records but 2 photo files/);
  });
});
