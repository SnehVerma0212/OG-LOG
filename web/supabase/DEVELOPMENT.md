# Verifying the database on a Supabase development project

This links a **separate, free development project** (never a production one),
applies the migration without resetting anything, and runs the two-user
integration tests. Use **fictional data only**.

Never paste passwords, access tokens or keys into chat, commit them, or put
them in any file except `web/.env.integration.local` (git-ignored).

## 0. Before you start

- Create a new Supabase project used only for OG-LOG development (Free plan is
  fine; it pauses after 7 days without activity).
- Pick the region you would eventually use; note it for the data-residency decision.
- Keep the database password in your password manager. You will type it into
  the CLI prompt only.

## 1. Check the project's API settings (dashboard)

- **Project Settings → Data API → Exposed schemas**: should be `public` (and
  `graphql_public`). `private` must **not** be listed.
- **"Automatically expose new tables"** may be on or off: the migration grants
  exactly what it needs either way (both cases are tested locally).

## 2. Link and apply the migration (terminal, inside `web/`)

The CLI is run with a pinned version through npx (nothing installed globally):

```bash
cd web
npx supabase@2.122.0 login                         # opens the browser; token stays in the CLI's own storage
npx supabase@2.122.0 init                          # creates supabase/config.toml and supabase/.gitignore (no secrets)
npx supabase@2.122.0 link --project-ref <ref>      # <ref> is in the project URL; type the DB password at the prompt
npx supabase@2.122.0 db push --dry-run             # must list exactly 20261031120000_case_logbook_schema.sql
npx supabase@2.122.0 db push                       # applies it; confirm when asked
npx supabase@2.122.0 migration list                # local and remote should both show the migration
```

`db push` only applies migrations missing from
`supabase_migrations.schema_migrations`; it does not reset or drop data.

**Never run** against a linked project: `supabase db reset --linked`,
`db push --include-all` without reviewing the list, or the SQL in
`supabase/tests/` (test-only stand-ins for Supabase internals). Do not edit a
migration once it has been applied; add a new one instead. Do not paste the
migration into the SQL editor: it would not be recorded as applied.

## 3. Check the result (dashboard)

- **Advisors → Security Advisor**: no "RLS disabled" or exposed-function warnings
  for `profiles`, `cases`, `case_attachments`.
- **Table Editor**: the three tables show RLS enabled.
- **Project Settings → Infrastructure**: note the PostgreSQL version. OG-LOG-DEV runs
  17.11; the local tests use 18.6 (see "PostgreSQL versions" below).

## 4. Create two synthetic test users (after step 2)

The migration's trigger creates profiles, so create users **after** applying it.

**Authentication → Users → Add user → Create new user**, twice:

- email such as `oglog-test-a@example.com` / `oglog-test-b@example.com`
  (fictional; `example.com` never receives mail)
- a strong password from your password manager
- tick **Auto Confirm User**

Email/password sign-in must be enabled (Authentication → Sign In / Providers → Email).

## 5. Run the integration tests

```bash
cd web
cp .env.integration.example .env.integration.local    # then fill it in with your editor
npm run test:integration
```

Use the **publishable key** (`sb_publishable_…`) or the legacy **anon** key.
The tests refuse secret/service-role keys, because those bypass RLS and would
make the results meaningless. `OGLOG_IT_CONFIRM` must be `synthetic-dev-project`.

Share only the pass/fail summary, never the `.env` file.

### How each run's data is isolated and cleaned up

- Each run gets a unique marker such as `ITEST-MH3K2Q1A-4F9C02BD` (time plus
  random). Every case the run writes, or tries to write, has a `procedure`
  starting with that marker. The marker uses only letters, digits and hyphens,
  so it is safe in a `LIKE` pattern.
- Cleanup (`afterAll`) runs as each test user, so RLS limits it to that user's
  own rows. It deletes only cases whose procedure starts with **this run's**
  marker; attachment records go with their case (`on delete cascade`). Rows
  from other runs, and any case not carrying the marker, are never touched.
  User A's original display name, read before the tests, is put back.
- Cleanup then **verifies**, as each user, that no case with the marker, no
  case whose ID the run recorded, and no attachment record the run attempted
  (by ID or by case) remains, and that A's display name equals the original.
  Every row the run could write is owned by A or B, so the two users' checks
  together cover the whole run.
- Both sessions are then signed out (`scope: 'local'`: this run's sessions only).
- Every cleanup step checks the API result. All steps run even if one fails, and
  any failure fails the run with an `afterAll` error naming the failed steps
  ("synthetic rows may remain"). Vitest reports it **in addition to** any test
  failures, so it never hides the original failure.
- If a run is killed before `afterAll`, its rows remain. Find them read-only in
  the SQL editor with `select id, procedure from public.cases where procedure like 'ITEST-%';`
  and remove them by signing in as the owning test user, or delete them in the
  Table Editor after checking each one is an `ITEST` row.

Sign-in itself still leaves Supabase Auth records (sessions, audit log, last
sign-in time); those are not test data and are not removed.

## Integration test plan (`integration/rls.integration.test.ts`)

Runs through Supabase Auth and the Data API, signed in as A and B with the
publishable key, exactly as browsers will be. "Empty, no error" means RLS
filtered the rows out; a `42501` there would mean a missing grant instead, so
the two are asserted separately.

| # | Scenario | Expected |
|---|---|---|
| 1 | A and B sign in; A creates a case without `owner_id` | Two distinct users; `owner_id` = A (taken from the session) |
| 2 | Profiles | Each user has a trigger-created profile and sees only their own |
| 3 | B selects A's case by ID, lists, counts, searches A's text | Empty / count 0, no error; A's own search finds it |
| 4 | B updates/deletes A's case (with and without returning rows) | No error, no rows; A's case unchanged |
| 5 | B inserts a case with `owner_id` = A | Rejected, `42501` |
| 6 | A sets `owner_id` = B on own case | Rejected, `42501`; still owned by A |
| 7 | Same reference twice for A; same reference for B | `23505` for A; allowed for B |
| 8 | B attaches to A's case (as B / as A); A attaches to own case; A edits attachment | `23503` / `42501`; A's starts `pending`; edit rejected `42501` |
| 9 | B reads, counts, lists and deletes (with and without returning rows) A's attachment | Empty / count 0, no error; A's attachment still exists, unchanged |
| 10 | Procedure 300 / 301 characters; diagnosis 1000 / 1001 | Allowed / `23514` |
| 11 | Completed case without diagnosis, with blank diagnosis, without role; complete one; complete a draft without role | `23514` ×3; allowed; `23514` and still a draft |
| 12 | Anonymous (no session) reads each table | Rejected, `42501` |
| 13 | Call `handle_new_user` via the API in the `private` schema / in `public` | `PGRST106` (schema not exposed) / `PGRST202` (no such function) |
| 14 | A renames own profile; B renames A's (with and without returning rows) | Allowed / no error, no rows; A re-reads the name unchanged |

If any test fails, stop and share the test names and error codes only.

## What has been verified where

Verified against the real OG-LOG-DEV project (14/14 on 2026-11-01): every row
in the table above, which covers the RLS policies and grants for all three
tables through real Auth sessions and PostgREST, the profile trigger on
`auth.users`, the attachment owner/case foreign key and `pending` status, the
length limits and completed-case rule, and that `private` is not exposed.

Local PGlite only (`npm test`): malformed, empty and stale JWT claims; server
timestamps and per-section update times; immutable IDs; unfiltered
update/delete; profile insert/delete denial; section JSON shape and 32 KB size;
reference format; attachment path, file-type and size checks; `service_role`
grants; behaviour under both "expose new tables" settings.

Not tested anywhere yet: forged or expired tokens against the real API, token
refresh, whether sign-out revokes sessions server-side, the project's Security
Advisor results and settings, GraphQL and Realtime access, Storage.

### PostgreSQL versions

The OG-LOG-DEV project runs **PostgreSQL 17.11**; the local tests run in
PGlite, which is **PostgreSQL 18.6**. Passing local tests therefore shows the
SQL behaves as intended on 18.6, not that it behaves the same on the remote
database. The integration suite confirms the scenarios above on 17.11, but the
"Local PGlite only" items have not been run on 17.11 and still need verifying
against the remote database (or a matching 17.x local stack) before they are
relied on. Re-check the version after any Supabase platform upgrade.
