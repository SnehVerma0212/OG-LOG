# Running OG-LOG on a Supabase development project

This links a **separate, free development project** (never a production one),
applies the migrations without resetting anything, configures sign-in and
photo storage, runs the website, and runs the two-user integration tests. Use
**fictional data and synthetic images only**.

Never paste passwords, access tokens or keys into chat, commit them, or put
them in any file except the git-ignored `web/.env.local` and
`web/.env.integration.local`.

| Variable | File | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `web/.env.local` | Project URL, built into the website |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `web/.env.local` | Publishable key, built into the website (never a secret key; the app refuses one) |
| `OGLOG_IT_SUPABASE_URL`, `OGLOG_IT_SUPABASE_PUBLISHABLE_KEY` | `web/.env.integration.local` | Same two values, for the integration tests |
| `OGLOG_IT_USER_A_EMAIL` / `_PASSWORD`, `OGLOG_IT_USER_B_EMAIL` / `_PASSWORD` | `web/.env.integration.local` | Two synthetic test accounts |
| `OGLOG_IT_CONFIRM` | `web/.env.integration.local` | Must be `synthetic-dev-project` |

Placeholders: `web/.env.example` and `web/.env.integration.example`.

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

`integration/` holds two files: `rls.integration.test.ts` (database rules,
table below) and `app.integration.test.ts` (the website's own case repository
and photo store, signed in as A and B). Its four photo tests report
**skipped** until step 6 is done: they first make one real upload and skip
only if Storage answers "Bucket not found".

## 6. Photo storage: the second migration (applied to OG-LOG-DEV)

`migrations/20261101120000_case_photo_storage.sql` creates the private
`case-photos` bucket (10 MB per file; JPEG, PNG and WebP only) and three
policies on `storage.objects`. A user can read, upload or delete a file only
if a `case_attachments` record with exactly that path exists **and belongs to
them**; there is no update policy, so files can never be overwritten or moved.
It changes no table and no existing policy, and is tested locally in
`tests/storage.test.ts`.

```bash
cd web
npx supabase@2.122.0 db push --dry-run    # must list exactly 20261101120000_case_photo_storage.sql
npx supabase@2.122.0 db push              # only after approval
npx supabase@2.122.0 migration list       # both migrations local and remote
```

If the push fails with a permission error on `storage.objects` or
`storage.buckets`, stop and share the error code; do not work around it in the
SQL editor. Then check in the dashboard:

- **Storage → Buckets**: `case-photos` is **private**, 10 MB limit, the three image types.
- **Storage → Policies**: the three "Case photos: …" policies on `objects`; nothing public.
- `npm run test:integration` now runs the photo tests (none skipped).

## 7. Sign-in settings and running the website

**Authentication settings (dashboard; change only after approval):**

- **Sign In / Providers → Email**: enabled; **Confirm email** on.
- **Allow new users to sign up: off.** OG-LOG is invite-only and has no sign-up
  screen; with this off, nobody can create an account through the API with the
  publishable key. Create accounts in **Authentication → Users → Add user** (or
  Invite).
- **URL Configuration**: Site URL `http://localhost:5173` for development. Add
  the exact redirect URL `http://localhost:5173/reset-password` (and later the
  deployed site's `https://<domain>/reset-password`). Avoid wildcards.
- **Password minimum length**: 6, to match the website (the minimum the website accepts for new passwords).
- The built-in email service is rate-limited and, on new projects, only sends
  to members of your Supabase organisation. Test password resets with an
  account using such an address, or configure your own SMTP later.

The website uses the PKCE flow: a reset link only works in the browser where
the reset was requested, once, before it expires.

**Run it:**

```bash
cd web
cp .env.example .env.local      # fill in the URL and publishable key in your editor
npm install
npm run dev                     # http://localhost:5173
```

Without `.env.local` the site shows a "not configured" page naming the missing
variables. Sign in with one of the synthetic test accounts.

| Command (in `web/`) | What it runs |
|---|---|
| `npm test` | Unit and screen tests plus PGlite database/Storage-policy tests (no network) |
| `npm run test:integration` | Real development project (needs `.env.integration.local`) |
| `npm run typecheck` / `npm run build` | Type checks / production build into `dist/` (git-ignored) |

## 8. First-login password change: the third migration (applied to OG-LOG-DEV)

`migrations/20261102120000_initial_password_change.sql` makes a new account
change its administrator-issued initial password before it can use the
logbook. It is additive:

- adds `profiles.password_change_required`: **true for accounts created after
  the migration**, false for accounts that already exist (including the two
  integration-test accounts). Users can read their own flag but not write it;
- adds a trigger on `auth.users` that clears the flag only when Supabase Auth
  stores a **different password hash** (Set New Password screen, Settings, or a
  reset link). Sign-ins and other row updates do not clear it;
- adds two **restrictive** RLS policies: while the flag is set, the user's
  case and attachment rows are hidden and cannot be written (photo files
  follow, because the Storage policies need a visible attachment record). This
  holds even for direct API calls made with the initial password.

The website reads the flag after every sign-in and page load and sends a
flagged user to **Set New Password** (`/set-password`). If the flag cannot be
read (for example, **before this migration is applied**), the website keeps
the logbook closed and shows "Your account could not be checked". So apply
this migration before using the updated website.

```bash
cd web
npx supabase@2.122.0 db push --dry-run    # must list exactly the pending migration(s), ending with 20261102120000_initial_password_change.sql
npx supabase@2.122.0 db push              # only after approval
```

**Creating a doctor's account (after the migration):**

1. Authentication → Users → **Add user** → Create new user; enter the email and
   the initial password; tick Auto Confirm User.
2. Table Editor → `profiles`: check the new user's `password_change_required`
   is **true** before sharing the password. If it is false, do not share the
   password; set it to true with
   `update public.profiles set password_change_required = true where id = '<user id>';`
   in the SQL editor and report it (it would mean account creation changed the
   password hash after insert).
3. To force a new password again later (e.g. after resetting it for someone),
   run the same `update` for that user.

Do not use a shared initial password. Invite doctors, or give each one a
random password from `npm run admin:initial-password`; see
`../DEPLOYMENT.md` → Accounts.

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

Verified against the real OG-LOG-DEV project (2026-11-01):

- every row in the table above (14 tests): RLS policies and grants for all
  three tables through real Auth sessions and PostgREST, the profile trigger
  on `auth.users`, the attachment owner/case foreign key and `pending` status,
  the length limits and completed-case rule, and that `private` is not exposed;
- the website's `SupabaseCaseRepository` (5 tests): create, read, edit, list,
  count, statistics and delete as the owner; B cannot see, list, count, edit
  or delete A's case; stale edits are refused; a repeated create with the same
  ID gives one case; duplicate references are reported.

- the website's `SupabasePhotoStore` against real private Storage (4 tests,
  passing since the step-6 migration was applied): upload to a case and
  section, viewing through a signed URL, removal; B cannot list, view,
  download, overwrite or delete A's photo; uploads without a record or of the
  wrong type are refused; a case's files are removed before the case.

Written but **not yet run** against the real project: the first-login flag
(own flag readable, other users' hidden, cannot be set or cleared directly;
skipped until step 8).

Local only (`npm test`):

- PGlite: malformed, empty and stale JWT claims; server timestamps and
  per-section update times; immutable IDs; unfiltered update/delete; profile
  insert/delete denial; section JSON shape and 32 KB size; reference format;
  attachment path, file-type and size checks; the first-login flag (set for
  new accounts, unchangeable by users, cleared only by a new password hash,
  blocking case and attachment access while set, failing closed without a
  profile); `service_role` grants; behaviour
  under both "expose new tables" settings; the Storage policies on
  `storage.objects` (PostgreSQL only, not the Storage API); the website's
  length and size checks measure exactly as PostgreSQL does.
- Screens with test doubles: sign-in, sign-out, protected routes, session
  restore and expiry, first-login Set New Password (direct URLs, reloads,
  failures, success, recovery interplay), Settings password change, password
  reset screens, case CRUD screens, and the photo
  screens (upload, retry, partial failures, removal, viewer).

Checked read-only on 2026-11-02 through Auth's public settings endpoint:
public sign-up is **disabled** on the server, email confirmation is required,
email is the only provider and anonymous sign-in is off.

Reported by the owner as tested manually in a browser (not by the automated
suites): sign-in, the forced first-login change (flag true → false), password
recovery, and photo isolation between doctors.

Not tested anywhere yet: the bucket's 10 MB limit against real Storage,
forged or expired tokens against the real API, token refresh, whether
sign-out revokes sessions server-side, the Security Advisor, GraphQL and
Realtime access, and the deployed site with its security headers (see
`web/DEPLOYMENT.md`, smoke test).

For deployment, free-plan limits and what is still required before real
patient data, see [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

### PostgreSQL versions

The OG-LOG-DEV project runs **PostgreSQL 17.11**; the local tests run in
PGlite, which is **PostgreSQL 18.6**. Passing local tests therefore shows the
SQL behaves as intended on 18.6, not that it behaves the same on the remote
database. The integration suite confirms the scenarios above on 17.11, but the
"Local PGlite only" items have not been run on 17.11 and still need verifying
against the remote database (or a matching 17.x local stack) before they are
relied on. Re-check the version after any Supabase platform upgrade.
