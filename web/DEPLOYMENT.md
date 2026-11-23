# Deploying the OG-LOG website (development beta)

**Scope:** a free, static deployment of `web/` connected to the
**OG-LOG-DEV** Supabase project. It is not approved for real patient
information yet (see `PRODUCTION-READINESS.md`). Every remote step needs the
owner's go-ahead.

## What gets deployed

`npm run build` produces `web/dist/`: one HTML page, hashed JS/CSS files, the
favicon and `_headers`. There is no server code. The browser talks only to
Supabase (Auth, Data API, Storage) with the **publishable** key; Row Level
Security and Storage policies protect the data.

- **Routing (Cloudflare Workers static assets):** the app uses browser URLs
  such as `/cases/<id>`, `/reset-password?code=…` and
  `/auth/confirm?token_hash=…`. `wrangler.jsonc` sets
  `assets.not_found_handling = "single-page-application"`, so a page
  navigation to any such path is served `index.html` (200, query string kept)
  and React Router shows the right screen. Requests that are not page
  navigations and match no file (e.g. a missing `/assets/*.js`) reach the tiny
  Worker in `worker/index.ts`, which answers a plain-text **404**. Without
  this configuration Workers answers 404 for every route except `/`, which
  is what broke password-reset links.
- **Security headers** (`public/_headers`, copied into `dist/`): a strict
  Content-Security-Policy (only the site's own scripts; network and images
  only from the site and `*.supabase.co`), no framing, no referrer, HSTS, and
  long caching for hashed assets only.

## Environment variables (build time)

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the project's publishable key (`sb_publishable_…`) |

Both are compiled into the JavaScript and visible to anyone, which is expected
for these two. **Never** set a secret or service-role key: the app refuses to
start with one. If either is missing, the deployed site shows "OG-LOG is not
configured" instead of running. Placeholders are in `web/.env.example`; real
values go only in git-ignored `.env.production.local` (or `.env.local`).

## Host: Cloudflare Workers static assets (free)

The site runs as the Worker **`oglog-beta`**
(`https://oglog-beta.iamsnehh.workers.dev`), configured by `web/wrangler.jsonc`.
Deploy with Wrangler so that the routing configuration is applied; a plain
dashboard upload of `dist/` does not carry `wrangler.jsonc` and gives 404s on
every route except `/`.

1. **Build and check locally** (inside `web/`):
   ```bash
   cp .env.example .env.production.local   # once; fill in the two values in your editor
   npm ci
   npm test
   npm run build                           # type-checks, then builds dist/
   ```
   Check `dist/` contains only `index.html`, `favicon.svg`, `_headers` and
   `assets/` (no `.env` files).
2. **Sign in to Cloudflare once:** `npx --yes wrangler@4.151.1 login` (opens the
   browser; the token stays in Wrangler's own storage, never in the repo).
3. **Deploy:** `npm run deploy:cloudflare` (runs the build, then
   `wrangler deploy`, which uploads `dist/` and `worker/index.ts` to the
   existing Worker `oglog-beta`). Set `WRANGLER_SEND_METRICS=false` to turn
   off Wrangler's anonymous telemetry.
4. **Optional local preview of production routing:** `npm run build`, then
   `npx --yes wrangler@4.151.1 dev` and open the printed local address.

## Supabase configuration for the deployed URL (dashboard, owner approval)

Authentication → **URL Configuration**:

- **Site URL:** `https://oglog-beta.iamsnehh.workers.dev` (the deployed site).
- **Redirect URLs:** add exactly `https://oglog-beta.iamsnehh.workers.dev/reset-password`.
  Keep `http://localhost:5173/reset-password` only while developing locally.
  No wildcards, so reset links always return to the main site.

The website asks Supabase to send reset links back to
`<current site>/reset-password`; Supabase refuses any address not in this list.

Authentication → **Sign In / Providers** (verified on 2026-11-02 through the
public settings endpoint: sign-ups **disabled**, email confirmation on, email
the only provider, anonymous sign-in off). Keep it that way.

Authentication → **Policies**: minimum password length **6** to match the
website (the website also rejects common passwords, keyboard runs and
repeated characters, and passwords containing the email name); enable
leaked-password protection if your plan includes it.

Authentication → **Multi-Factor**: **App Authenticator (TOTP) enabled** for
enrolment and verification. Doctors turn on two-step verification in
Settings; the database then requires it (migration 20261103120000).

Database: apply `supabase/migrations/20261103120000_account_security.sql`
(activity log, account deletion, two-step enforcement) with `db push --dry-run`
then `db push`, **before** deploying a build that includes it.

### Accounts (invite-only, no shared passwords)

Public sign-up stays **off**. For each doctor, either:

- **Invite (preferred, needs SMTP below):** Authentication → Users → Invite
  user. The doctor opens the email link, lands on Set New Password, and
  chooses their own password. No password is ever shared.
- **Individual initial password:** run `npm run admin:initial-password` on your
  own computer (random, 20 characters, nothing stored), create the user with
  Add user → Auto Confirm, and give the password to the doctor by phone or in
  person. They must replace it at first sign-in (the server blocks all case
  data until they do). Never reuse an initial password.

After creating a user, check Table Editor → `profiles`:
`password_change_required` must be **true**. (Verified on the local Supabase
stack: accounts created through the admin API stay flagged until the user
sets a password.)

### Email: SMTP and link templates

Supabase's built-in sender only reaches members of your Supabase organisation
and is rate-limited. For doctors, configure Authentication → Emails → **SMTP
Settings** with a sender you are permitted to use for account emails.

The website uses PKCE, which cannot open Supabase's default invitation links.
Replace these templates (Authentication → Emails → Templates):

- **Invite user** link:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
- **Reset password** link:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`

These open `/auth/confirm`, which removes the token from the address bar and
uses it once. Reset links then work on any device (not only the browser that
asked). The Site URL must be the deployed site.

### Sessions

Sessions are kept per browser tab (sessionStorage) and end when the tab or
browser closes; opening the site in a new tab asks for sign-in again. After
**30 minutes without activity** the user is signed out automatically.

## Smoke test after each deployment (about 10 minutes, synthetic data)

1. Open the site; the sign-in page loads over HTTPS. Browser developer tools →
   Console: **no** "Content Security Policy" errors anywhere below.
   Open `https://<site>/reset-password` and `https://<site>/auth/confirm` in a
   new tab: each shows an OG-LOG screen, not a Cloudflare 404. A missing file
   such as `https://<site>/assets/missing.js` shows "Not found".
2. Visit `https://<site>/cases` directly while signed out → sign-in page.
3. Sign in with a synthetic account; refresh on `/cases` → still signed in.
4. Create a draft case, refresh, edit it, mark it completed; Dashboard and
   Statistics totals change accordingly.
5. Add a synthetic photo in each section, open the large view, remove one.
   Settings → Two-Step Verification → set up, sign out, sign in with the code.
   Settings → Export Records and Photos; the ZIP opens and contains cases.json.
6. Delete the case; it disappears from the list and statistics.
7. Settings → Change Password with the current password; sign out; sign in with the new one.
8. (If SMTP is configured) Forgot password → email → link opens
   `/reset-password` on the deployed site → new password works. Repeat with
   an account that has two-step verification on: the reset page also asks for
   the authenticator code (Supabase accepts a new password only after the
   second step), and the next sign-in still asks for the code.
9. Sign out; the browser's Back button does not show case data.

If step 1 shows CSP errors, note the blocked address and fix `_headers`
rather than removing the policy.

## Rollback

- **Website:** Cloudflare dashboard → Workers & Pages → `oglog-beta` →
  Deployments → an earlier version → **Rollback** (or
  `npx --yes wrangler@4.151.1 rollback`). Instant; no rebuild. Do not roll back
  to a version deployed before `wrangler.jsonc` existed: it has no route fallback.
- **Configuration:** changing the Supabase URL or key needs a new build and upload.
- **Database:** migrations are forward-only; there is no automatic rollback.
  All migrations so far are additive and the current website expects all three.
  Do not roll the website back to a build older than the first-login migration.

## Free-plan limits that affect a real deployment

- **Pausing:** a free Supabase project is paused after about a week without
  activity; the site then fails until the owner restores it from the dashboard.
- **Backups:** the project has **no managed backups and no point-in-time
  recovery** (`npx supabase@2.122.0 backups list`, checked 2026-11-01). See
  "Backups and restore" below.
- **Deletion:** deleting a case removes its photo files first, then its
  records. Doctors delete their own account in Settings (files first, then
  everything else; the server refuses while files remain). If an
  administrator deletes a **user** in the dashboard instead, the photo files
  are **not** removed: delete the folder `case-photos/<user id>/` in Storage first.

## Backups and restore

```bash
cd web
npm run backup                         # encrypted archive in web/backups/ (git-ignored), then checked
npm run backup:verify -- backups/oglog-backup-<time>.tar.gpg   # check any copy, any time
npx supabase@2.122.0 start             # local Supabase stack in Docker
npm run restore:local -- backups/oglog-backup-<time>.tar.gpg
npx supabase@2.122.0 stop              # when done
```

**What a backup contains:** all table data (users with password hashes,
two-step factors with their secrets, profiles, cases, photo records, the
activity log), a schema copy for reference, every photo file, the linked
project's ID, the migrations applied to it, and a SHA-256 manifest; encrypted
with GnuPG AES-256 under your passphrase. **Left out:** sessions, sign-in
tokens, pending links, Supabase's own sign-in log, and every dashboard
setting (re-entered from the checklist in `DISASTER-RECOVERY.md`).

**Status of each capability** (V = verified, C = in the code, not yet
exercised end to end, U = unverified):

| Capability | Status | Evidence |
|---|---|---|
| Backup of the live project decrypts; every checksum and expected file present | V | `backup:verify` on `oglog-backup-20261101T164241Z` (2026-11-01) |
| Restore into the local stack: users 4, profiles 4, cases 3, photo records 1, photo files 1, **activity log 158**: all equal to the backup | V | `restore:local`, same archive, 2026-11-01 |
| Restored photo byte-identical; opens for its owner; refused to another user | V | restore step 6; drill script |
| Restored test accounts sign in with their restored passwords; see only their own cases and activity | V | drill script; integration suite **29/29** against the restored copy |
| Two-step factors survive dump → reset → load, and the code is required again after sign-in | V (local stack only) | synthetic factor round trip, 2026-11-01. The live backup held **no** factors, so this was not shown with live data |
| Wrong passphrase, damaged or truncated archive, tampered file, missing file, photo count mismatch: each reported clearly | V | `scripts/backupScripts.test.ts` (synthetic archives) |
| `npm run backup` records the project ID and applied migrations and checks its own archive | C | parts exercised separately (migration reader against the live list, archive check on the live backup); run one new backup to confirm the whole script |
| Restore into a **new hosted** project | U | `DISASTER-RECOVERY.md`, not drilled |
| Two-step factors on a new hosted project | U | works only if the hosted secrets are stored unencrypted; the restore prints which form it found |
| Scheduled backups and off-site copies | U (manual) | nothing runs automatically |

- **Run** a backup daily while real data is stored, copy it off this
  computer, and run `restore:local` monthly. Delete expired archives under
  your retention decision.
- **Passphrase:** keep it in a password manager **and** one offline copy,
  separate from the archives. If it is lost, every archive made with it is
  permanently unreadable: make a new backup with a new passphrase at once,
  then destroy the old archives.
- A backup ending with "photo counts differ" means a photo was added or
  removed while it ran: take another one. A backup that fails its own check is
  renamed `*.UNVERIFIED`; do not rely on it.
- A lost hosted project is recovered with [`DISASTER-RECOVERY.md`](DISASTER-RECOVERY.md).

## Before real patient data

See [`PRODUCTION-READINESS.md`](PRODUCTION-READINESS.md) for what is
implemented, what is verified, and the owner and legal actions still open.
