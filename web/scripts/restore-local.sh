#!/usr/bin/env bash
# Restores an encrypted backup into the LOCAL Supabase stack (Docker) to prove
# the backup is complete. Never touches a hosted project.
#
#   cd web && npx supabase@2.122.0 start      # local stack (once)
#   npm run restore:local -- backups/oglog-backup-<time>.tar.gpg
#
# Steps: decrypt, verify every checksum, reset the LOCAL database to the
# migrations, load the data, upload the photo files, then compare every count
# (and every photo file's bytes) with the backup.
set -euo pipefail
umask 077

ARCHIVE="${1:?Usage: npm run restore:local -- <backup.tar.gpg>}"
CLI=(npx --yes supabase@2.122.0)
source "$(dirname "$0")/backup-common.sh"
PROJECT_ID="$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || {
  echo "The local Supabase stack is not running (start it with: npx supabase@2.122.0 start)." >&2
  exit 1
}
psql_local() { docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "1/6 Decrypting and checking every file against the manifest…"
decrypt_archive "$ARCHIVE" "$WORK"
check_contents "$WORK"
count_dump "$WORK" || { echo "The database dump could not be parsed; it may be damaged." >&2; exit 1; }
summarize "$WORK" || echo "Continuing: the restore will show exactly what the backup contains." >&2
# The local migrations must be the ones the project had when it was backed up.
if [[ -s "$WORK/backup/REMOTE_MIGRATIONS.txt" ]]; then
  EXPECTED="$WORK/backup/REMOTE_MIGRATIONS.txt"
  LOCAL_VERSIONS="$(ls supabase/migrations | sed -n 's/^\([0-9]\{14\}\)_.*\.sql$/\1/p' | sort)"
else
  EXPECTED="$WORK/backup/MIGRATIONS.txt"
  LOCAL_VERSIONS="$(ls supabase/migrations)"
fi
diff <(echo "$LOCAL_VERSIONS") "$EXPECTED" >/dev/null || {
  echo "This backup was taken with a different set of migrations than this checkout has; check out the matching version first." >&2
  exit 1
}

echo "2/6 Resetting the LOCAL database to the migrations…"
"${CLI[@]}" db reset --local >/dev/null

echo "3/6 Loading the data…"
psql_local <"$WORK/backup/data.sql" >/dev/null

echo "4/6 Uploading the photo files…"
if [[ "$(photo_file_count "$WORK")" -gt 0 ]]; then
  "${CLI[@]}" storage cp -r "$WORK/backup/storage/$BUCKET/." "ss:///$BUCKET" --local --experimental >/dev/null
fi

echo "5/6 Comparing the restored database with the backup…"
FAILED=0
for table in "${COUNTED_TABLES[@]}"; do
  expected="$(dump_count "$WORK" "$table")"
  restored="$(psql_local -At -c "select count(*) from $table")"
  status=ok
  [[ "$expected" == "$restored" ]] || { status=MISMATCH; FAILED=1; }
  printf '  %-24s backup %-6s restored %-6s %s\n' "$table" "$expected" "$restored" "$status"
done
expected="$(photo_file_count "$WORK")"
restored="$(psql_local -At -c "select count(*) from storage.objects where bucket_id = '$BUCKET'")"
status=ok
[[ "$expected" == "$restored" ]] || { status=MISMATCH; FAILED=1; }
printf '  %-24s backup %-6s restored %-6s %s\n' "photo files" "$expected" "$restored" "$status"
# Every photo record must have its file.
orphans="$(psql_local -At -c "select count(*) from public.case_attachments a where not exists (select 1 from storage.objects o where o.bucket_id = '$BUCKET' and o.name = a.storage_path)")"
[[ "$orphans" == 0 ]] || { echo "  $orphans photo record(s) have no restored file" >&2; FAILED=1; }
# Authenticator factors: stored secrets are either plain (usable by any Auth
# server) or encrypted with the original project's key (unusable elsewhere).
psql_local -At -F ' ' -c "select count(*) filter (where secret ~ '^[A-Z2-7]+=*\$'), count(*) filter (where secret is not null and secret !~ '^[A-Z2-7]+=*\$') from auth.mfa_factors where factor_type = 'totp'" |
  while read -r plain other; do
    echo "  authenticator secrets: $plain in a portable form, $other in another form (e.g. encrypted with the old project's key)"
  done

echo "6/6 Downloading every restored photo and comparing its bytes…"
if [[ "$(photo_file_count "$WORK")" -gt 0 ]]; then
  mkdir "$WORK/download"
  "${CLI[@]}" storage cp -r "ss:///$BUCKET" "$WORK/download" --local --experimental >/dev/null
  if diff -rq "$WORK/backup/storage/$BUCKET" "$WORK/download/$BUCKET" >/dev/null; then
    echo "  all $(photo_file_count "$WORK") photo files identical"
  else
    echo "  restored photo files differ from the backup" >&2
    FAILED=1
  fi
else
  echo "  no photo files in this backup"
fi

if [[ "$FAILED" != 0 ]]; then
  echo "RESTORE CHECK FAILED: see the lines marked above." >&2
  exit 1
fi
echo "Restore check passed."
