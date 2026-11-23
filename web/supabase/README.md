# OG-LOG database (Supabase / PostgreSQL)

Status: the first three migrations are **applied to the OG-LOG-DEV
development project** and must no longer be edited (add new migrations
instead). `20261103120000_account_security.sql` is written, tested in PGlite
and on a local Supabase stack, and **not applied yet**. See
[DEVELOPMENT.md](DEVELOPMENT.md) for setup and for what is verified on the real
project, what is local-only, and what is untested. Use synthetic data only until
security testing and legal/institutional review are complete. Nothing here is
a compliance claim.

## Contents

| Path | Purpose |
|---|---|
| `migrations/20261031120000_case_logbook_schema.sql` | Tables, constraints, triggers, privileges and Row Level Security. Creates objects only; drops nothing. **Applied to OG-LOG-DEV.** |
| `migrations/20261101120000_case_photo_storage.sql` | Private `case-photos` Storage bucket and its three access policies. **Applied to OG-LOG-DEV** (its real-Storage integration tests pass). |
| `migrations/20261102120000_initial_password_change.sql` | First-login password change: `profiles.password_change_required`, a trigger clearing it when the password changes, and restrictive policies blocking case data until then. **Applied to OG-LOG-DEV.** |
| `migrations/20261103120000_account_security.sql` | Activity log (`audit_events`), self-service account deletion (`delete_my_account()`), and two-step-verification enforcement via `access_checks.second_step_satisfied()`. **Not applied yet** (needs approval). |
| `tests/supabase-auth-shim.sql` | **Test-only** stand-in for Supabase's `auth` schema, API roles, default privileges and Storage tables. Never apply it to a real project. |
| `tests/harness.ts` | Runs the shim and migrations in PGlite (real PostgreSQL in WebAssembly) and executes queries as user A, user B, `anon` or `service_role`. |
| `tests/rls.test.ts` | Two-user authorization, claims and limit tests, run under both Supabase default modes. |
| `tests/caseRows.test.ts` | Checks the shared domain model and the schema agree. |
| `tests/passwordChange.test.ts` | First-login flag: set for new accounts, unchangeable by users, cleared only by a new password, blocks case data while set. |
| `tests/accountSecurity.test.ts` | Activity log, account deletion and two-step enforcement. |
| `tests/storage.test.ts` | Storage policies for case photos: owner-only read, upload and delete; no overwrite; under both default modes. |
| `tests/caseLimits.test.ts` | The website's length and size checks measure exactly as PostgreSQL does. |
| `tests/integrationConfig.test.ts` | Checks the integration-test safety guard (secret keys refused, values never printed). |
| `tests/integrationCleanup.test.ts` | Checks the integration run marker and that cleanup failures are reported, not swallowed. |
| `integration/` | Two-user scenarios against a **real** Supabase project via Auth and the Data API (`npm run test:integration`; skipped unless configured). Each run's rows carry a unique marker and are deleted and verified afterwards. |
| `DEVELOPMENT.md` | How to link a development project, apply the migration without resetting anything, and run the integration tests. |

`npm test` in `web/` runs everything except `integration/` (no credentials, no
network, no Docker).

## Tables

- `profiles`: one per Auth user, created by a trigger on `auth.users`. Display name, plus the server-controlled first-login flag `password_change_required`.
- `cases`: one surgical case. Same fields and rules as the app (`src/domain/cases.ts`); sections are JSON objects of text. `owner_id` defaults to the signed-in user and can never change. Timestamps are set by the server. References are unique per owner, case-insensitively.
- `case_attachments`: one record per photo (section `preop`, `ot` or `postop`); the file lives in the private `case-photos` bucket at the record's `storage_path`. A composite foreign key `(case_id, owner_id) → cases (id, owner_id)` guarantees an attachment's owner is its case's owner. The storage path must be `<owner>/<case>/<attachment>`. Users cannot set `status` past `pending`.

## Authorization

Two layers. **Privileges**: `anon` gets nothing; `authenticated` gets only the
commands listed below; `service_role` (trusted server code only) gets row
access explicitly. **RLS** then limits `authenticated` to the caller's own
rows, using `auth.uid()` from the verified JWT, never a client-supplied ID.

| Table | Policy | Effect |
|---|---|---|
| profiles | read own / update own | See and rename only your profile. No insert (trigger creates it), no delete (future server-side account deletion). |
| cases | read own | Other doctors' cases are invisible: not listed, counted, searched or found by ID. |
| cases | insert own (`WITH CHECK`) | New cases must name you as owner. |
| cases | update own (`USING` + `WITH CHECK`) | Only your cases can be changed, and never re-assigned (a trigger also blocks owner changes, even for the service role). |
| cases | delete own | Only your cases can be deleted. |
| case_attachments | read own / insert own / delete own | No update at all: attachments are replaced, not edited. |

The **service role / secret key bypasses RLS**. It must only ever be used in
trusted server code, never in the browser, tests or the repo.

CHECK constraints use only built-in functions: PostgreSQL checks EXECUTE
permission on functions inside constraints at write time, and hardened
Supabase projects do not grant EXECUTE on new functions to `PUBLIC`.

## Supabase project defaults covered locally

The suite runs twice:

- **exposed** (current default): new public tables are granted to the API roles automatically; the migration's REVOKEs must take effect.
- **hardened** ("Automatically expose new tables" off, function EXECUTE revoked from `PUBLIC`, as Supabase recommends): the migration's explicit GRANTs must be sufficient.

## What the local tests prove, and what they do not

They prove the SQL behaves as intended in real PostgreSQL under the
`authenticated` role: user B cannot read, list, count, update, delete, re-own or
attach to user A's records (by ID and with unfiltered statements, with and
without `RETURNING`); malformed, empty or stale user IDs fail closed; private
functions are not callable; and the length/size limits are exact. Each security
rule was deliberately weakened once to confirm a test fails.

They do **not** cover Supabase's real Auth service and JWT verification, the
PostgREST Data API, Supabase's exact roles and grants, whether triggers on
`auth.users` run as expected on the platform, which schemas the project
exposes, Storage, or the PostgreSQL version Supabase runs (PGlite is 18.x).
`integration/` covers the API, grants, trigger and schema exposure on the
development project; DEVELOPMENT.md lists exactly what remains PGlite-only.
