#!/usr/bin/env bash
# Encrypted backup of the linked Supabase project: database data, a schema
# copy for reference, every photo file, the migrations applied to the
# project, and a checksum manifest. The finished archive is decrypted and
# checked before the backup is reported as successful.
#
#   cd web && npm run backup
#
# Read-only against Supabase. Needs: the linked project (supabase link), Docker
# (the CLI runs pg_dump in a container), gpg. The passphrase is asked for
# interactively, or read from the file named by OGLOG_BACKUP_PASSPHRASE_FILE.
# Plaintext exists only in a private temporary folder that is always removed.
set -euo pipefail
umask 077

CLI=(npx --yes supabase@2.122.0)
source "$(dirname "$0")/backup-common.sh"
OUT_DIR="${OGLOG_BACKUP_DIR:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v gpg >/dev/null || { echo "gpg is required." >&2; exit 1; }
PROJECT_REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
[[ "$PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || { echo "No linked Supabase project (run: npx supabase@2.122.0 link)." >&2; exit 1; }
echo "Backing up Supabase project $PROJECT_REF"
mkdir -p "$OUT_DIR" "$WORK/backup/storage"

# Versions recorded in the project's migration history (read-only query).
# Non-interactive output is JSON; the table form is accepted as a fallback.
"${CLI[@]}" migration list --linked </dev/null 2>/dev/null | node -e '
  let text = "";
  process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
    let versions;
    try {
      versions = JSON.parse(text).migrations.map((m) => m.remote).filter(Boolean);
    } catch {
      versions = text.split("\n").map((line) => line.split("|")[1]?.trim()).filter((v) => /^\d{14}$/.test(v ?? ""));
    }
    if (versions.some((v) => !/^\d{14}$/.test(v)) || versions.length === 0) process.exit(1);
    process.stdout.write(versions.sort().join("\n") + "\n");
  });
' >"$WORK/backup/REMOTE_MIGRATIONS.txt" || {
  rm -f "$WORK/backup/REMOTE_MIGRATIONS.txt"
  echo "WARNING: could not read the project's migration history; restores will compare with the local migration files instead." >&2
}

echo "1/5 Database data (sessions and one-time tokens left out)…"
"${CLI[@]}" db dump --linked --data-only \
  -x auth.sessions,auth.refresh_tokens,auth.flow_state,auth.one_time_tokens,auth.mfa_challenges,auth.mfa_amr_claims,auth.audit_log_entries,storage.objects,storage.buckets,storage.s3_multipart_uploads,storage.s3_multipart_uploads_parts \
  -f "$WORK/backup/data.sql" >/dev/null

echo "2/5 Schema copy (reference only; restores use the migrations)…"
"${CLI[@]}" db dump --linked -f "$WORK/backup/schema.sql" >/dev/null

echo "3/5 Photo files…"
"${CLI[@]}" storage cp -r "ss:///$BUCKET" "$WORK/backup/storage" --linked --experimental >/dev/null

echo "4/5 Manifest and encryption…"
(
  cd "$WORK/backup"
  {
    echo "created_utc=$STAMP"
    echo "project_ref=$PROJECT_REF"
    echo "cli=supabase@2.122.0"
    echo "photo_files=$(find storage -type f | wc -l | tr -d ' ')"
  } >INFO.txt
  find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum >MANIFEST.sha256
)
ls supabase/migrations >"$WORK/backup/MIGRATIONS.txt"
(cd "$WORK/backup" && sha256sum MIGRATIONS.txt >>MANIFEST.sha256)

TARGET="$OUT_DIR/oglog-backup-$STAMP.tar.gpg"
GPG=(gpg --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 --output "$TARGET")
if [[ -n "${OGLOG_BACKUP_PASSPHRASE_FILE:-}" ]]; then
  GPG=(gpg --batch --yes --pinentry-mode loopback --passphrase-file "$OGLOG_BACKUP_PASSPHRASE_FILE" "${GPG[@]:1}")
fi
tar -C "$WORK" -cf - backup | "${GPG[@]}"

echo "5/5 Checking the encrypted archive (enter the passphrase again if asked)…"
CHECK="$WORK/check"
mkdir "$CHECK"
if ! decrypt_archive "$TARGET" "$CHECK" || ! check_contents "$CHECK"; then
  mv "$TARGET" "$TARGET.UNVERIFIED"
  echo "BACKUP FAILED: the archive did not pass its check and was renamed to $TARGET.UNVERIFIED. Do not rely on it." >&2
  exit 1
fi
if ! summarize "$CHECK"; then
  echo "Encrypted backup: $TARGET ($(du -h "$TARGET" | cut -f1)), decrypted and checked, BUT the photo counts differ (see above)." >&2
  exit 2
fi

echo "Encrypted backup: $TARGET ($(du -h "$TARGET" | cut -f1)), decrypted and checked."
echo "Store it off this computer as well, and keep the passphrase separately. Test a restore regularly (npm run restore:local)."
