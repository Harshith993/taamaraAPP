#!/usr/bin/env bash
# Rebuilds the local development database with the demo seed, so each take starts from the same data.
# Development only: it refuses any database whose name doesn't end in _dev.
set -euo pipefail
cd "$(dirname "$0")/../.."
url=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
db=$(basename "${url%%\?*}")
[[ "$db" == *_dev ]] || { echo "Refusing to reset $db (not a _dev database)"; exit 1; }
su postgres -c "dropdb --if-exists --force $db && createdb -O taamara $db" 2>/dev/null || {
  psql "${url%%\?*}" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
}
npx prisma migrate deploy >/dev/null
npm run --silent db:seed >/dev/null
echo "Reset $db with the demo seed."
