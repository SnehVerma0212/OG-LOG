# OG-LOG

**A private surgical operation-theatre (OT) logbook, built for a practicing surgeon.**

OG-LOG records surgical cases in three structured stages: **preoperative**, **operative (OT)** and **postoperative**. It is built in two versions that share one TypeScript domain model:

| | Android app | Web app |
|---|---|---|
| Location | repository root | [`web/`](web/) |
| Stack | Expo SDK 58, React Native 0.88, TypeScript | React 19, Vite 8, React Router 7, TypeScript |
| Data | Encrypted on the device (SQLCipher), fully offline | Supabase (PostgreSQL, Auth, Storage) |
| Why | Local, offline, encrypted records on Android | Access from an iPhone and any browser |

> **Status: development beta.** OG-LOG has not completed a privacy, legal or security review and is **not approved for real patient data**. Use synthetic records only. See [`web/PRODUCTION-READINESS.md`](web/PRODUCTION-READINESS.md).

---

## Features

### Both versions
- Create, edit, view, search and delete cases (reference, surgery date, procedure, diagnosis, surgical role, draft/completed status).
- Structured preoperative, operative and postoperative sections, sharing one set of field definitions and validation rules.
- Dashboard and statistics: totals, drafts, most frequent procedures.

### Android app
- **Encrypted local database:** SQLCipher with a random 256-bit key kept in the platform's secure storage (Android Keystore-backed), on this device only and excluded from backups.
- **Safe upgrade from unencrypted storage:** the old plaintext database is copied into the encrypted one and verified before the original is deleted. The checks are page authentication, `integrity_check` and a full row-by-row comparison. Every interrupted state on the next launch is recovered.
- **App lock:** biometrics or the device PIN, pattern or password, with a configurable timeout. If its settings can't be read, the app stays locked.
- **Privacy screen:** hidden in the app switcher; screenshots blocked on Android.
- Works entirely offline; the app has no network code.

### Web app
- **Accounts:** invite-only sign-in with Supabase Auth (PKCE), forced password change on first sign-in, password reset by email.
- **Two-step verification (TOTP):** once a user turns it on, the **database** withholds their records from any session that hasn't completed the second step.
- **Per-user isolation:** PostgreSQL Row Level Security on every table and on photo storage.
- **Case photos:** location, device and time metadata (EXIF, XMP, IPTC) removed **in the browser before upload**, losslessly.
- **Activity log:** written by database triggers; it stores IDs and times only, never clinical text.
- **Exports:**
  - an Excel workbook (`.xlsx`) with Cases, Preoperative, Operative, Postoperative, Photos and Activity Log sheets;
  - a ZIP with the workbook, the photo files and a checksummed photo manifest.
- **Self-service account deletion:** removes every photo file, then the account and all its records.
- **Session safety:** sessions end with the browser tab, and there is an automatic sign-out after 30 minutes idle.
- **Strict Content Security Policy:** only the site's own scripts; no third-party scripts or analytics.

---

## Architecture

```
OG-LOG/
├── App.tsx, index.ts          Android app entry
├── src/
│   ├── domain/                Shared with the web app: case model, validation, dates
│   ├── utils/singleFlight.ts  Shared: ignores double taps / double submits
│   ├── db/                    SQLite schema, migrations, repository, serial transactions
│   ├── security/              SQLCipher driver, key storage, app lock
│   ├── screens/, components/  UI
│   └── navigation.ts          Reducer-based navigation
├── __tests__/, test-utils/    Android tests (real SQL via Node's built-in SQLite)
└── web/
    ├── src/                   Web app (auth, data, photos, account, pages)
    ├── supabase/migrations/   PostgreSQL schema, RLS policies, triggers, functions
    ├── supabase/tests/        Database and RLS tests (in-process Postgres via PGlite)
    ├── supabase/integration/  Tests against a real Supabase project
    ├── scripts/               Encrypted backup, verification and local restore
    ├── worker/, wrangler.jsonc  Cloudflare Workers deployment
    └── public/_headers        Security headers and CSP
```

**Shared code.**
- The web app imports `src/domain` and `src/utils/singleFlight.ts` directly through a Vite alias (`@og-log/domain`), so both apps use the same case types, section definitions and validation.
- A test (`web/src/test/sharedModules.test.ts`) fails if a shared module imports any package, keeping React Native and Expo out of the web bundle.

**Storage.**
- The two versions keep separate data stores, and there is **no sync** between them.
- The Android app is local-first and encrypts on the device.
- The web app relies on server-side authorization (Row Level Security) and server-enforced two-step verification.

### Notable engineering details

- **Transactions on an encrypted connection.** expo-sqlite's exclusive transactions open a second connection, which wouldn't have the encryption key. `src/db/serialTransactions.ts` runs `BEGIN IMMEDIATE … COMMIT/ROLLBACK` transactions one at a time, in order, on the single keyed connection.
- **Fail-closed encryption.** If the SQLite build lacks SQLCipher, `PRAGMA key` silently does nothing. The driver checks `cipher_version` and refuses to open rather than fall back to plaintext. A new key is saved and read back before any data is encrypted with it.
- **Owner-bound photos.** A composite foreign key `(case_id, owner_id)` and a storage-path constraint ensure a photo can only belong to its owner's case. Storage policies require an owned record for every file.
- **Two-step verification in SQL.** Restrictive RLS policies call one `SECURITY DEFINER` function, which answers only about the caller, because signed-in users cannot read Supabase's factor table directly.
- **Data-layer safety on the web.** Optimistic concurrency on updates (an `updated_at` precondition), idempotent case creation on retry, and errors mapped so raw database messages are never shown.

---

## Getting started

Requirements: Node.js 22+ and npm. The web app's local database also needs Docker.

### Android app

```bash
npm install
npm test                 # Jest
npm run typecheck
npx expo start           # then open the development build
```

The encrypted database needs a **development build** with SQLCipher (`useSQLCipher: true` in `app.json`); **Expo Go cannot open it**. Build one with EAS (`eas.json` has `development` and `preview` APK profiles):

```bash
npx eas-cli@latest build --profile development --platform android
```

### Web app

```bash
cd web
npm install
cp .env.example .env.local   # add your Supabase project URL and *publishable* key
npm run dev
```

- **Keys:** never use a secret or service-role key; the app refuses to start with one.
- **Database:** apply the migrations in `web/supabase/migrations/` to your Supabase project. See [`web/supabase/DEVELOPMENT.md`](web/supabase/DEVELOPMENT.md) for setting up a project, the local Supabase stack and test accounts.

---

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Android | `npm test` | Repository and schema against a real SQLite engine, the encrypted-database open and migration state machine, app-lock logic, screens |
| Web | `cd web && npm test` | UI and flows, auth, photos (metadata stripping), exports, deployment config, backup scripts; **database and RLS tests** in PGlite |
| Web integration | `cd web && npm run test:integration` | Two synthetic users against a real Supabase project: isolation, storage, exports |

Type checking: `npm run typecheck` (root and `web/`).

---

## Deployment and operations (web)

- **Hosting:** Cloudflare Workers static assets, deployed with `npm run deploy:cloudflare`. See [`web/DEPLOYMENT.md`](web/DEPLOYMENT.md).
- **Backups:**
  - `npm run backup` creates a GnuPG AES-256 encrypted archive of the database data, photo files and a checksum manifest, then verifies it.
  - `npm run restore:local` restores it into a local Supabase stack and compares every count and photo.
- **Disaster recovery:** see [`web/DISASTER-RECOVERY.md`](web/DISASTER-RECOVERY.md).

---

## Limitations and roadmap

- **Android:**
  - no backup or export yet, so a lost or reset phone loses its records;
  - no photo attachments;
  - not yet built or tested on iOS.
- **Web:**
  - needs a network connection; it isn't an offline app or PWA;
  - application-level encryption isn't implemented (data protection relies on Supabase and Row Level Security);
  - scheduled backups aren't automated.
- **Both:** no sync between the Android and web versions.
- **Real patient data:** not approved until the privacy and legal review in [`web/PRODUCTION-READINESS.md`](web/PRODUCTION-READINESS.md) is complete.

---

## Security

Please don't open public issues for security problems; contact the maintainer privately instead.

Never commit `.env` files, Supabase secret or service-role keys, database passwords or backup archives. All of these are git-ignored by default.

## License

See [`LICENSE`](LICENSE).
