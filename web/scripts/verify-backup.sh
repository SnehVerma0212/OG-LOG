#!/usr/bin/env bash
# Checks an encrypted backup without restoring it: decrypts into a private
# temporary folder, verifies every checksum and the expected files, and
# compares photo records with photo files. Prints names and counts only.
#
#   cd web && npm run backup:verify -- backups/oglog-backup-<time>.tar.gpg
set -euo pipefail
umask 077

ARCHIVE="${1:?Usage: npm run backup:verify -- <backup.tar.gpg>}"
source "$(dirname "$0")/backup-common.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Checking $ARCHIVE ($(du -h "$ARCHIVE" 2>/dev/null | cut -f1 || echo '?'))…"
decrypt_archive "$ARCHIVE" "$WORK"
check_contents "$WORK"
if [[ -s "$WORK/backup/REMOTE_MIGRATIONS.txt" ]]; then
  echo "  migrations applied to the project: $(wc -l <"$WORK/backup/REMOTE_MIGRATIONS.txt" | tr -d ' ') (latest $(tail -1 "$WORK/backup/REMOTE_MIGRATIONS.txt"))"
else
  echo "  migrations: only the local file list was recorded (backup made before REMOTE_MIGRATIONS.txt existed)"
fi
summarize "$WORK"
echo "Backup verified."
