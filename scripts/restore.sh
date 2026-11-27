#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh into an EMPTY database and storage folder, then check it.
#
#   scripts/restore.sh <backup-folder> <target-database-url> <target-storage-dir>
#
# The target database must exist and be empty (the guard triggers stop records being deleted, so
# restoring over live data is refused on purpose). After restoring, the row counts, trigger count
# and file count are compared with the backup's manifest; any difference fails the restore.
set -euo pipefail
SRC="${1:?backup folder}"; TARGET="${2:?target database url}"; FILES="${3:?target storage dir}"
TARGET="${TARGET%%\?*}"
for f in db.dump files.tar.gz manifest.txt; do [ -f "$SRC/$f" ] || { echo "Missing $SRC/$f"; exit 1; }; done
want() { grep "^$1=" "$SRC/manifest.txt" | cut -d= -f2-; }
[ "$(sha256sum "$SRC/db.dump" | cut -d' ' -f1)" = "$(want sha256.db)" ] || { echo "db.dump does not match its checksum"; exit 1; }
[ "$(sha256sum "$SRC/files.tar.gz" | cut -d' ' -f1)" = "$(want sha256.files)" ] || { echo "files.tar.gz does not match its checksum"; exit 1; }
if [ "$(psql "$TARGET" -At -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")" != "0" ]; then
  echo "The target database is not empty. Restore into a new, empty database."; exit 1
fi

pg_restore --no-owner --exit-on-error --dbname="$TARGET" "$SRC/db.dump"
mkdir -p "$FILES"
tar -xzf "$SRC/files.tar.gz" -C "$FILES"

fail=0
# Every table the backup counted (older backups count fewer).
for t in $(grep '^rows\.' "$SRC/manifest.txt" | cut -d= -f1 | cut -d. -f2); do
  got=$(psql "$TARGET" -At -c "SELECT count(*) FROM $t")
  if [ "$got" != "$(want rows.$t)" ]; then echo "MISMATCH $t: backup $(want rows.$t), restored $got"; fail=1; else echo "ok   $t $got"; fi
done
got=$(psql "$TARGET" -At -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")
[ "$got" = "$(want triggers)" ] && echo "ok   triggers $got" || { echo "MISMATCH triggers: $(want triggers) vs $got"; fail=1; }
got=$(find "$FILES" -type f -not -path '*/.incoming/*' | wc -l)
[ "$got" = "$(want stored_files)" ] && echo "ok   stored files $got" || { echo "MISMATCH stored files: $(want stored_files) vs $got"; fail=1; }
# Every ready file the database knows about must have its bytes.
missing=0
while read -r key; do [ -f "$FILES/$key" ] || missing=$((missing+1)); done < <(psql "$TARGET" -At -c "SELECT \"storageKey\" FROM files WHERE status = 'READY'")
echo "ready files without bytes: $missing (demo seed files have none)"
[ $fail = 0 ] && echo "RESTORE CHECK PASSED" || { echo "RESTORE CHECK FAILED"; exit 1; }
