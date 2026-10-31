# OG-LOG database (Supabase / PostgreSQL)

Status: **design and local tests only.** This migration has not been applied to
any Supabase project. Use synthetic data only until security testing and
legal/institutional review are complete. Nothing here is a compliance claim.

## Contents

| Path | Purpose |
|---|---|
| `migrations/20261031120000_case_logbook_schema.sql` | Tables, constraints, triggers, privileges and Row Level Security. Creates objects only; drops nothing. |
| `tests/supabase-auth-shim.sql` | **Test-only** stand-in for Supabase's `auth` schema, API roles and default privileges. Never apply it to a real project. |
| `tests/harness.ts` | Runs the shim and migrations in PGlite (real PostgreSQL in WebAssembly) and executes queries as user A, user B, `anon` or `service_role`. |
| `tests/rls.test.ts` | Two-user authorization tests. |
| `tests/caseRows.test.ts` | Checks the shared domain model and the schema agree. |

Run with `npm test` in `web/` (no credentials, no network, no Docker).

## Tables

- `profiles`: one per Auth user, created by a trigger on `auth.users`. Display name only.
- `cases`: one surgical case. Same fields and rules as the app (`src/domain/cases.ts`); sections are JSON objects of text. `owner_id` defaults to the signed-in user and can never change. Timestamps are set by the server. References are unique per owner, case-insensitively.
- `case_attachments`: metadata for future private photos. A composite foreign key `(case_id, owner_id) → cases (id, owner_id)` guarantees an attachment's owner is its case's owner. The storage path must be `<owner>/<case>/<attachment>`. Users cannot set `status` past `pending`.

## Authorization

Two layers. **Privileges**: `anon` gets nothing; `authenticated` gets only the
commands listed below. **RLS** then limits those commands to the caller's own
rows, using `auth.uid()` from the verified JWT, never a client-supplied ID.

| Table | Policy | Effect |
|---|---|---|
| profiles | read own / update own | See and rename only your profile. No insert (trigger creates it), no delete (future server-side account deletion). |
| cases | read own | Other doctors' cases are invisible: not listed, counted, searched or found by ID. |
| cases | insert own (`WITH CHECK`) | New cases must name you as owner. |
| cases | update own (`USING` + `WITH CHECK`) | Only your cases can be changed, and never re-assigned (a trigger also blocks owner changes, even for the service role). |
| cases | delete own | Only your cases can be deleted. |
| case_attachments | read own / insert own / delete own | No update at all: attachments are replaced, not edited. |

The **service-role key bypasses RLS**. It must only ever be used in trusted
server code (e.g. a future Edge Function), never in the browser or the repo.

## What the local tests prove, and what they do not

They prove the SQL in the migration behaves as intended in real PostgreSQL
under the `authenticated` role, including attempts by user B to read, list,
count, update, delete, re-own and attach to user A's records (by ID and with
unfiltered statements, with and without `RETURNING`). Each security rule was
deliberately weakened once to confirm a test fails.

They do **not** cover: Supabase's real Auth service and JWT verification, the
PostgREST Data API in front of the database, Supabase's exact role and grant
setup, Storage, or the PostgreSQL version Supabase runs (PGlite is 18.x).
Those need a Supabase test project or the Supabase local stack.
