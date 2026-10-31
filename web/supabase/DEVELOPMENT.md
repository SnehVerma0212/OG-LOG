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
npx supabase@2.122.0 init                          # creates supabase/config.toml only (no secrets)
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
- **Project Settings → Infrastructure**: note the PostgreSQL version (local tests use 18.x).

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

Every row the tests write is fictional (`ITEST…`) and is deleted by its owner
at the end. Share only the pass/fail summary, never the `.env` file.

## Integration test plan (`integration/rls.integration.test.ts`)

Runs through Supabase Auth and the Data API, signed in as A and B with the
publishable key, exactly as browsers will be:

| # | Scenario | Expected |
|---|---|---|
| 1 | A and B sign in; A creates a case without `owner_id` | Two distinct users; `owner_id` = A (taken from the session) |
| 2 | Profiles | Each user has a trigger-created profile and sees only their own |
| 3 | B selects A's case by ID, lists all cases, searches A's text | Empty results, no error |
| 4 | B updates/deletes A's case (with and without returning rows) | No change to A's case |
| 5 | B inserts a case with `owner_id` = A | Rejected, `42501` |
| 6 | A sets `owner_id` = B on own case | Rejected, `42501`; still owned by A |
| 7 | Same reference twice for A; same reference for B | `23505` for A; allowed for B |
| 8 | B attaches to A's case (as B / as A); A attaches to own case; A edits attachment | `23503` / `42501`; A's starts `pending`; edit rejected `42501` |
| 9 | Anonymous (no session) reads each table | Rejected, `42501` |
| 10 | Call `private.handle_new_user` via the API (`private` schema and `public`) | Error, no data |
| 11 | A renames own profile; B renames A's | Allowed / no rows changed |

If any test fails, stop and share the test names and error codes only.
