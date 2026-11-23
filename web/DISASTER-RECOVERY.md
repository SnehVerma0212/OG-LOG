# Disaster recovery: replacing a lost Supabase project

Use this when the hosted project is gone or unusable (deleted, corrupted,
locked out, region change). Day-to-day restores for checking a backup use
`npm run restore:local` instead (`DEPLOYMENT.md` → Backups).

**Status: not yet rehearsed on a hosted project.** Steps 1, 2, 6 and the
local equivalents of 5 and 7 are verified (2026-11-01). Rehearse the whole
procedure once on a spare free project before relying on it.

**Targets (proposed):** data loss of at most one day (daily backups);
service back within one working day.

## Keep ready, off this computer

- At least two copies of the latest archive (`oglog-backup-<time>.tar.gpg`).
- The backup passphrase (password manager **and** one offline copy).
- Logins for Supabase, Cloudflare and the SMTP provider (Brevo), and the SMTP
  credentials.
- This repository at the commit whose migrations match the backup
  (`npm run backup:verify` shows them).

## Steps

1. **Stop and record.** Note the time and what happened. Ask doctors to stop
   using the site. Do not delete the old project if it still exists.
2. **Check the archive.** `npm run backup:verify -- <archive>`. If it fails, use
   the other copy. Optionally run `npm run restore:local` to preview the
   contents.
3. **Create the replacement project** (Supabase dashboard → New project; free
   plan; decide the region first, see `PRODUCTION-READINESS.md` → data
   location). Store its new database password in the password manager.
4. **Link and apply the migrations** (inside `web/`):
   ```bash
   npx supabase@2.122.0 link --project-ref <new-ref>
   npx supabase@2.122.0 db push --dry-run   # must list exactly the backup's migrations
   npx supabase@2.122.0 db push
   ```
5. **Load the data.** Decrypt into a private folder and load `data.sql`. Use
   the new project's connection string (dashboard → Connect → session pooler);
   type it into the terminal only, never into chat or a file in the repo:
   ```bash
   umask 077; D="$(mktemp -d)"
   gpg --decrypt <archive> | tar -C "$D" -xf -
   (cd "$D/backup" && sha256sum --quiet --check MANIFEST.sha256)
   psql "<connection string>" -v ON_ERROR_STOP=1 --single-transaction -f "$D/backup/data.sql"
   ```
   `data.sql` switches triggers off while loading, as Supabase's own restore
   guide does. If the load fails, stop: do not disable security policies or
   edit the data to make it fit.
6. **Upload the photo files:**
   ```bash
   npx supabase@2.122.0 storage cp -r "$D/backup/storage/case-photos/." ss:///case-photos --linked --experimental
   ```
7. **Re-enter the Auth settings** (none are in the backup):
   - URL configuration: Site URL and the `/reset-password` redirect URL.
   - Sign-ups **off**; email provider on; email confirmation on; anonymous
     sign-in off.
   - SMTP settings (Brevo); **Invite user** and **Reset password** templates
     with the `token_hash` links (`DEPLOYMENT.md` → Email).
   - Multi-Factor: App Authenticator (TOTP) enrolment and verification on.
   - Policies: minimum password length 6; leaked-password protection if
     available.
8. **Point the website at the new project.** Put the new URL and publishable
   key in `.env.production.local`, then `npm run deploy:cloudflare`.
9. **Check the result.**
   - In the dashboard's SQL editor, count `auth.users`, `auth.mfa_factors`,
     `public.profiles`, `public.cases`, `public.case_attachments`,
     `public.audit_events` and the `case-photos` files, and compare them with
     `backup:verify`.
   - Sign in with a synthetic test account; open a case and a photo; complete
     the authenticator step for an account that uses it.
   - Point `.env.integration.local` at the new project and run
     `npm run test:integration` (0 failed, 0 skipped). Then run the smoke test
     in `DEPLOYMENT.md`.
10. **Clean up.** `shred -u` the decrypted files and `rm -rf "$D"`. Take a fresh
    backup of the new project at once.
11. **Tell the doctors.** Everyone signs in again (sessions are not restored).
    Changes made after the backup's time are lost and must be re-entered.

## Known limitations

- **Two-step verification:** factors are restored with their secrets.
  Verified on the local stack, where the secrets are stored unencrypted. If
  the hosted project stores them encrypted with a project-specific key, the
  factors will not work in the new project. Then delete each doctor's factor
  (Authentication → Users → the user) after confirming their identity by
  other means, and have them enrol again in Settings. (The 2026-11-01 live
  backup contained no factors, so the hosted form is not yet known;
  `restore:local` reports it.)
- **Supabase's own sign-in log** is not in the backup.
- **Lost passphrase:** the archives cannot be opened by anyone. Recovery is
  then impossible from those archives.
