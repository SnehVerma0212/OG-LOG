# OG-LOG production readiness: real surgical records

This is the status of every blocker identified for storing real professional
surgical records (which can identify patients and include clinical photos).
"Verified" means demonstrated by an automated test or a recorded check; the
evidence is named. Nothing here is a claim of compliance with any law or
standard.

**Current decision: not yet approved for real patient data.** The code-level
controls are in place; the remaining items need the owner's actions,
agreements and a human privacy/legal review (sections B and C).

## A. Controls implemented in the code

| Blocker | What exists now | Evidence |
|---|---|---|
| Shared initial password, weak passwords | No shared password. Accounts are created individually: an **invitation email** (doctor sets their own password via `/auth/confirm`) or a **random per-doctor initial password** (`npm run admin:initial-password`), followed by a forced change (server flag + RLS). New passwords: ≥ 6 characters (owner's decision, 2026-11-02), ≤ 72 bytes, not common, a keyboard/alphabet run or repetitive (including `doctor`, `123456`), not containing the email name. | `src/auth/firstLogin.test.tsx`, `emailLinks.test.tsx`, `supabase/tests/passwordChange.test.ts` |
| No MFA | Optional authenticator-app two-step verification (TOTP, free in Supabase). Once enrolled, the **database** withholds cases, photo records and the activity log from sessions without the second step (aal2). Password change and account deletion require password + code. | `supabase/tests/accountSecurity.test.ts`, `src/account/account.test.tsx`, `src/auth/supabaseAuthService.test.ts` |
| Photo EXIF metadata | JPEG/PNG/WebP are stripped **in the browser before upload**, losslessly: EXIF (GPS, time, device), XMP, IPTC, comments, thumbnails, trailing data. Only JPEG orientation is kept. Unparseable files are refused. | `src/photos/stripMetadata.test.ts`; real Storage: integration test "strips location and device metadata before the file reaches Storage" |
| Session tokens in localStorage | Session kept in **sessionStorage** (ends with the tab/browser; old localStorage sessions removed on load); only the PKCE verifier uses localStorage. **Automatic sign-out after 30 minutes** without activity, also after sleep. Strict CSP (no inline or third-party scripts). | `src/lib/supabaseClient.test.ts`, `src/auth/useIdleSignOut.test.tsx`, `src/test/deploymentConfig.test.ts` |
| Account deletion leaves photos | Settings → Delete Account: password (+ code), photo files removed through Storage first, then the server function `delete_my_account()` deletes the account (cascade: profile, cases, attachment records, activity log). The server **refuses** while any photo file remains, while an initial password is pending, or without the second step when enrolled. | `supabase/tests/accountSecurity.test.ts`, `src/account/account.test.tsx` |
| No export | Settings → Export Records (and Photos): one ZIP with `cases.json` (all cases and sections, photo list, activity log) and the photo files, named by ID only. Generated in the browser. | `src/account/account.test.tsx`, `src/lib/zip.test.ts`; real data: integration test "exports the owner's cases and photo files, and nothing of other users" |
| No audit trail | `audit_events`: case created/updated/deleted, photo added/removed, password changed, export downloaded. IDs and times only, no clinical text. Written by database triggers; users can read only their own and cannot forge, edit or delete entries. Sign-in events are in Supabase's own Auth logs. | `supabase/tests/accountSecurity.test.ts` |
| Isolation between doctors | RLS on every table with user data (`profiles`, `cases`, `case_attachments`, `audit_events`); composite foreign key binding photos to their case's owner; Storage policies requiring an owned record for every file; no UPDATE on files. | 158 PGlite tests (both Supabase default modes), real-project integration suite, deliberate-weakening checks on every migration |
| Backups | `npm run backup`: encrypted (GnuPG AES-256) archive of all data (including the activity log and two-step factors), a schema copy, every photo file, the project ID, the applied migrations and a SHA-256 manifest; sessions/tokens excluded. The archive is decrypted and checked before success is reported; photo records and files are compared. `npm run restore:local` restores into a **local** stack only and compares every count and photo with the backup. **Not automatic**, and restore into a new hosted project is **not drilled** (`DISASTER-RECOVERY.md`). | Live backup verified and restored locally on 2026-11-01: all counts equal, including 158 activity-log entries; photo byte-identical; integration suite 29/29 against the restored copy (`DEPLOYMENT.md` → Backups, status table); `scripts/backupScripts.test.ts` |

## B. Outstanding actions for the owner (outside the code)

1. **Apply migration `20261103120000_account_security.sql`** (audit trail,
   account deletion, MFA enforcement): `npx supabase@2.122.0 db push --dry-run`,
   check it lists only this file, then `db push`. Then run
   `npm run test:integration` (expect 0 skipped). Until then: no activity log,
   account deletion fails safely ("could not be deleted"), and MFA is
   checked by the app but not yet by the database.
2. **Email:** configure custom SMTP (Authentication → Emails → SMTP) with a
   provider you are allowed to send health-related account emails through,
   and replace the **Invite user** and **Reset password** templates with the
   `token_hash` links in `DEPLOYMENT.md` → Email. Without this, invitations
   and "Forgot password" do not reach doctors.
3. **Password policy on the server:** Authentication → Policies → minimum
   length **6**; enable leaked-password protection if your plan offers it.
   (The website enforces 6 already; the server is the authority.) A 6-character
   minimum is weak on its own: two-step verification (item 6) matters more.
4. **Supabase plan and backups:** the project has **no managed backups and
   no point-in-time recovery**. A verified encrypted backup exists
   (2026-11-01), but nothing runs automatically. Either upgrade to a plan with
   backups/PITR, or run `npm run backup` daily, keep a copy off the computer,
   keep the passphrase in two separate safe places, and run
   `npm run restore:local` monthly. Rehearse `DISASTER-RECOVERY.md` on a
   spare project once before relying on it (needs your approval: it is a
   remote change).
5. **Data location:** the database is in **ap-northeast-1 (Tokyo)**. Decide
   whether that is acceptable for your patients' data (see C); moving region
   means a new project and a restore.
6. **Turn on two-step verification** for every doctor account (Settings).
7. **Deploy the new build** only after 1–3 (DEPLOYMENT.md), then run the smoke test.

## C. Requirements needing human (legal/privacy/contractual) review

Not assessed here; each needs a qualified person's decision, documented:

- **Applicable law** for where the surgeon practises and where patients are:
  for India, the Digital Personal Data Protection Act 2023 and its Rules
  (consent, purpose limitation, security safeguards, breach notification,
  data-principal rights, cross-border transfer); any state or institutional
  rules; medical-council duties on records and confidentiality. Other
  jurisdictions (e.g. HIPAA, GDPR) only if they apply.
- **Who is the data fiduciary/controller** (the surgeon, the hospital, or
  both) and whether the hospital permits personal logbooks of its patients,
  with or without photos.
- **Patient consent** for clinical photographs and for recording cases in a
  personal logbook; whether records must be de-identified (the app asks for
  no patient identifiers and strips photo metadata, but free-text fields and
  photo content can still identify a patient).
- **Processor agreements:** Supabase (database, Auth, Storage) and Cloudflare
  (hosting) data-processing terms, sub-processors, and transfer mechanisms;
  the email/SMTP provider likewise.
- **Retention and deletion:** how long records and photos are kept, what
  happens when a doctor leaves, and how backups are expired.
- **Breach response:** who is notified, how fast, and how access is reviewed
  (Supabase Auth logs, `audit_events`).
- **Device policy:** shared hospital computers, phone photos (camera roll
  copies stay on the phone), and lost devices.

## D. Known limitations that remain by design

- The session token is still readable by JavaScript in the page (sessionStorage);
  HttpOnly cookies need a server component. The CSP and the absence of
  third-party scripts reduce, but do not remove, the impact of an XSS bug.
- Photo content and free-text fields can still identify a patient; the app
  cannot detect that.
- Reads are not logged per record (only changes); Supabase keeps API and Auth
  logs for a limited time on the free plan.
- Export ZIPs are limited to 4 GB and are built in browser memory.
- With two-step verification on, a password-reset link alone cannot set a new
  password: the authenticator code is also required (Supabase enforces this).
  A doctor who has lost both the password and the authenticator needs the
  administrator to remove the factor (Authentication → Users → the user →
  MFA factors) after confirming their identity by other means.
- The free Supabase plan pauses projects after about a week without activity.
