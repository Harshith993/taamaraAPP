#!/usr/bin/env bash
# Back up Taamara Taamara: the database (pg_dump custom format) and uploaded files (local storage).
#
#   scripts/backup.sh [backup-folder]        default: ./backups/<date-time>
#
# Reads DATABASE_URL and STORAGE_DIR from the environment or .env. Writes:
#   db.dump        the whole database, including the guard triggers
#   files.tar.gz   every stored file (originals, viewing copies, thumbnails)
#   manifest.txt   when, row counts of the main tables, file count, and SHA-256 of both archives
# With S3 (Phase 10) the files part is S3 versioning instead; the database part stays the same.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
STORAGE_DIR="${STORAGE_DIR:-./data/storage}"
OUT="${1:-./backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"
DB_URL="${DATABASE_URL%%\?*}"   # pg_dump does not take Prisma's ?schema= option

pg_dump --format=custom --no-owner --file="$OUT/db.dump" "$DB_URL"
if [ -d "$STORAGE_DIR" ]; then
  tar -czf "$OUT/files.tar.gz" -C "$STORAGE_DIR" --exclude=.incoming .
else
  tar -czf "$OUT/files.tar.gz" --files-from /dev/null
fi

{
  echo "taken_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  psql "$DB_URL" -At -F= -c "
    SELECT 'rows.' || t, n FROM (
      SELECT 'events' t, count(*) n FROM events UNION ALL
      SELECT 'payments', count(*) FROM payments UNION ALL
      SELECT 'client_invoices', count(*) FROM client_invoices UNION ALL
      SELECT 'vendor_invoices', count(*) FROM vendor_invoices UNION ALL
      SELECT 'expenses', count(*) FROM expenses UNION ALL
      SELECT 'cash_advances', count(*) FROM cash_advances UNION ALL
      SELECT 'inventory_items', count(*) FROM inventory_items UNION ALL
      SELECT 'inventory_allocations', count(*) FROM inventory_allocations UNION ALL
      SELECT 'files', count(*) FROM files UNION ALL
      SELECT 'messages', count(*) FROM messages UNION ALL
      SELECT 'audit_log', count(*) FROM audit_log UNION ALL
      SELECT 'users', count(*) FROM users
    ) x ORDER BY t;"
  echo "triggers=$(psql "$DB_URL" -At -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")"
  echo "stored_files=$(tar -tzf "$OUT/files.tar.gz" | grep -vc '/$' || true)"
  echo "sha256.db=$(sha256sum "$OUT/db.dump" | cut -d' ' -f1)"
  echo "sha256.files=$(sha256sum "$OUT/files.tar.gz" | cut -d' ' -f1)"
} > "$OUT/manifest.txt"
echo "Backup written to $OUT"
cat "$OUT/manifest.txt"
