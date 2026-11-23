# Shared by backup.sh, verify-backup.sh and restore-local.sh (sourced, not run).
# Prints names, counts and checksums only: never passphrases, keys or row data.

BUCKET=case-photos
REQUIRED_FILES=(data.sql schema.sql MIGRATIONS.txt INFO.txt MANIFEST.sha256)

# Tables counted in the backup and again after a restore.
COUNTED_TABLES=(auth.users auth.mfa_factors public.profiles public.cases public.case_attachments public.audit_events)

# decrypt_archive <archive.tar.gpg> <directory>
# Decrypts and unpacks into <directory>/backup, explaining the usual failures.
# The passphrase comes from gpg's own prompt, or from the file named by
# OGLOG_BACKUP_PASSPHRASE_FILE.
decrypt_archive() {
  local archive="$1" dest="$2" log="$2/gpg.log"
  if [[ ! -f "$archive" ]]; then
    echo "Backup not found: $archive" >&2
    return 1
  fi
  if [[ ! -s "$archive" ]]; then
    echo "Backup is empty (0 bytes): $archive" >&2
    return 1
  fi
  local gpg=(gpg --decrypt)
  if [[ -n "${OGLOG_BACKUP_PASSPHRASE_FILE:-}" ]]; then
    gpg=(gpg --batch --yes --pinentry-mode loopback --passphrase-file "$OGLOG_BACKUP_PASSPHRASE_FILE" --decrypt)
  fi
  # Decrypted to a private file first, so gpg always finishes its integrity
  # check before anything is unpacked. Its messages go to a private log, so
  # only a classified reason is shown.
  if ! "${gpg[@]}" --output "$dest/backup.tar" "$archive" 2>"$log"; then
    rm -f "$dest/backup.tar"
    if grep -qiE 'bad session key|bad passphrase|wrong passphrase' "$log"; then
      echo "Wrong passphrase: the backup could not be decrypted. Nothing was changed." >&2
    elif grep -qiE 'timeout|cancel|no pinentry|inappropriate ioctl' "$log"; then
      echo "No passphrase was entered (the prompt was cancelled or timed out). Run the command again." >&2
    elif grep -qiE 'no valid openpgp|invalid packet|unexpected eof|mdc|modification detected|manipulated|checksum error|crc error|read error|pending bytes|decryption failed|packet' "$log"; then
      echo "The backup file is damaged or incomplete (it failed gpg's integrity check). Use another copy." >&2
    else
      echo "The backup could not be decrypted; it is damaged, or not an OG-LOG backup." >&2
    fi
    rm -f "$log"
    return 1
  fi
  rm -f "$log"
  if ! tar -C "$dest" -xf "$dest/backup.tar" 2>/dev/null; then
    rm -f "$dest/backup.tar"
    echo "The backup decrypted, but its contents could not be unpacked; it is damaged or not an OG-LOG backup." >&2
    return 1
  fi
  rm -f "$dest/backup.tar"
  [[ -d "$dest/backup" ]] || { echo "The archive does not contain an OG-LOG backup." >&2; return 1; }
}

# check_contents <directory containing backup/>
# Every required file present, every checksum correct, and nothing extra.
check_contents() {
  local dir="$1/backup" name
  for name in "${REQUIRED_FILES[@]}"; do
    [[ -s "$dir/$name" ]] || { echo "The backup is incomplete: $name is missing or empty." >&2; return 1; }
  done
  [[ -d "$dir/storage" ]] || { echo "The backup is incomplete: the photo folder is missing." >&2; return 1; }
  if ! (cd "$dir" && sha256sum --quiet --strict --check MANIFEST.sha256 >/dev/null 2>&1); then
    echo "Checksum mismatch: at least one file in the backup is damaged." >&2
    return 1
  fi
  local listed actual
  listed="$(cd "$dir" && sed -E 's/^[0-9a-f]{64} [ *]//' MANIFEST.sha256 | sed 's#^\./##' | sort)"
  actual="$(cd "$dir" && find . -type f ! -name MANIFEST.sha256 | sed 's#^\./##' | sort)"
  if [[ "$listed" != "$actual" ]]; then
    echo "The backup's files do not match its manifest (missing or unexpected files)." >&2
    return 1
  fi
  echo "Checksums: $(wc -l <"$dir/MANIFEST.sha256" | tr -d ' ') files, all correct."
}

# count_dump <directory containing backup/>: counts the rows per table in the
# data dump once (dump-counts.mjs counts rows, not INSERT statements). Fails
# if the dump cannot be parsed. The result sits next to backup/, not inside it.
count_dump() {
  node "$(dirname "${BASH_SOURCE[0]}")/dump-counts.mjs" "$1/backup/data.sql" >"$1/counts.txt"
}

# dump_count <directory containing backup/> <schema.table>: rows from count_dump.
dump_count() {
  awk -v t="$2" '$1 == t { n = $2 } END { print n + 0 }' "$1/counts.txt"
}

# photo_file_count <directory containing backup/>
photo_file_count() {
  if [[ -d "$1/backup/storage/$BUCKET" ]]; then
    find "$1/backup/storage/$BUCKET" -type f | wc -l | tr -d ' '
  else
    echo 0
  fi
}

# summarize <directory containing backup/>: counts, and photo records vs files.
# Returns 1 if the numbers of photo records and photo files differ.
summarize() {
  local dir="$1/backup" table records files
  count_dump "$1" || { echo "The database dump could not be parsed; it may be damaged." >&2; return 1; }
  sed -n -E 's/^(created_utc|project_ref|cli)=/  \1: /p' "$dir/INFO.txt"
  echo "  rows in the backup:"
  for table in "${COUNTED_TABLES[@]}"; do
    printf '    %-24s %s\n' "$table" "$(dump_count "$1" "$table")"
  done
  records="$(dump_count "$1" public.case_attachments)"
  files="$(photo_file_count "$1")"
  printf '    %-24s %s\n' "photo files" "$files"
  if [[ "$records" != "$files" ]]; then
    echo "WARNING: $records photo records but $files photo files. A photo was added or removed while the backup ran, or files are missing in Storage. Take another backup and compare." >&2
    return 1
  fi
}
